import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  fileToHtml,
  sanitizeContent,
  MAX_UPLOAD_BYTES,
  SUPPORTED_EXTENSIONS,
  UnsupportedFileError,
} from './convert.js';

const SESSION_COOKIE = 'sid';
const ROLES = ['viewer', 'editor'];
const MAX_TITLE_LENGTH = 200;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const now = () => new Date().toISOString();

function normalizeTitle(raw) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  return title || 'Untitled document';
}

const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, color: u.color };

/**
 * Build the Express app around an open database handle.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ staticDir?: string, secureCookies?: boolean }} [options]
 */
export function createApp(db, { staticDir, secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    allUsers: db.prepare('SELECT * FROM users ORDER BY name'),
    sessionUser: db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    ),
    insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),

    docById: db.prepare('SELECT * FROM documents WHERE id = ?'),
    shareRole: db.prepare(
      'SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?',
    ),
    insertDoc: db.prepare(`
      INSERT INTO documents (id, owner_id, title, content, source_filename, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    updateDoc: db.prepare(`
      UPDATE documents
         SET title = ?, content = ?, version = version + 1, updated_at = ?, updated_by = ?
       WHERE id = ? AND version = ?`),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    ownedDocs: db.prepare(`
      SELECT d.id, d.title, d.created_at, d.updated_at, d.source_filename,
             ub.name AS updated_by_name,
             (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS share_count
        FROM documents d
        LEFT JOIN users ub ON ub.id = d.updated_by
       WHERE d.owner_id = ?
       ORDER BY d.updated_at DESC`),
    sharedDocs: db.prepare(`
      SELECT d.id, d.title, d.created_at, d.updated_at, d.source_filename, s.role,
             ub.name AS updated_by_name,
             o.id AS owner_id, o.name AS owner_name, o.email AS owner_email, o.color AS owner_color
        FROM document_shares s
        JOIN documents d ON d.id = s.document_id
        JOIN users o ON o.id = d.owner_id
        LEFT JOIN users ub ON ub.id = d.updated_by
       WHERE s.user_id = ?
       ORDER BY d.updated_at DESC`),

    sharesForDoc: db.prepare(`
      SELECT u.id, u.email, u.name, u.color, s.role, s.created_at
        FROM document_shares s JOIN users u ON u.id = s.user_id
       WHERE s.document_id = ?
       ORDER BY s.created_at`),
    upsertShare: db.prepare(`
      INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`),
    deleteShare: db.prepare('DELETE FROM document_shares WHERE document_id = ? AND user_id = ?'),
  };

  // ---------- helpers ----------

  function requireUser(req, _res, next) {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? q.sessionUser.get(token) : null;
    if (!user) return next(new HttpError(401, 'Please sign in.'));
    req.user = user;
    next();
  }

  /**
   * Resolve a document and the caller's role on it. Documents the caller cannot
   * see are reported as 404 so their existence is not leaked.
   */
  function loadDoc(req, minRole = 'viewer') {
    const doc = q.docById.get(req.params.id);
    if (!doc) throw new HttpError(404, 'Document not found.');
    let role = null;
    if (doc.owner_id === req.user.id) role = 'owner';
    else role = q.shareRole.get(doc.id, req.user.id)?.role ?? null;
    if (!role) throw new HttpError(404, 'Document not found.');

    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[minRole]) {
      const msg =
        minRole === 'owner'
          ? 'Only the owner can do that.'
          : 'You have view-only access to this document.';
      throw new HttpError(403, msg);
    }
    return { doc, role };
  }

  function serializeDoc(doc, role) {
    const owner = q.userById.get(doc.owner_id);
    const updatedBy = doc.updated_by ? q.userById.get(doc.updated_by) : null;
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      role,
      owner: publicUser(owner),
      updatedBy: publicUser(updatedBy),
      sourceFilename: doc.source_filename,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }

  function collaborators(docId) {
    const doc = q.docById.get(docId);
    return {
      owner: publicUser(q.userById.get(doc.owner_id)),
      shares: q.sharesForDoc.all(docId).map((r) => ({
        user: publicUser(r),
        role: r.role,
        sharedAt: r.created_at,
      })),
    };
  }

  function createDocument(ownerId, { title, content, sourceFilename = null }) {
    const id = randomUUID();
    const ts = now();
    q.insertDoc.run(
      id,
      ownerId,
      normalizeTitle(title),
      sanitizeContent(content ?? ''),
      sourceFilename,
      ts,
      ts,
      ownerId,
    );
    return q.docById.get(id);
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    // Browsers send multipart filenames as UTF-8; multer defaults to latin1.
    defParamCharset: 'utf8',
    fileFilter(_req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) return cb(new UnsupportedFileError(file.originalname));
      cb(null, true);
    },
  });

  function requireFile(req) {
    if (!req.file) throw new HttpError(400, 'Attach a file in the "file" field.');
    return req.file;
  }

  // ---------- auth (mocked: pick a seeded account, no password) ----------

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/users', (_req, res) => {
    res.json({ users: q.allUsers.all().map(publicUser) });
  });

  api.post('/auth/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const user = q.userByEmail.get(email);
    if (!user) throw new HttpError(404, `No account for "${email}".`);
    const token = randomBytes(32).toString('hex');
    q.insertSession.run(token, user.id, now());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    res.json({ user: publicUser(user) });
  });

  api.post('/auth/logout', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) q.deleteSession.run(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? q.sessionUser.get(token) : null;
    res.json({ user: publicUser(user) ?? null });
  });

  // ---------- documents ----------

  api.use('/documents', requireUser);
  api.use('/convert', requireUser);

  api.get('/documents', (req, res) => {
    const owned = q.ownedDocs.all(req.user.id).map((d) => ({
      id: d.id,
      title: d.title,
      role: 'owner',
      owner: publicUser(req.user),
      shareCount: d.share_count,
      sourceFilename: d.source_filename,
      updatedByName: d.updated_by_name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
    const shared = q.sharedDocs.all(req.user.id).map((d) => ({
      id: d.id,
      title: d.title,
      role: d.role,
      owner: { id: d.owner_id, name: d.owner_name, email: d.owner_email, color: d.owner_color },
      sourceFilename: d.source_filename,
      updatedByName: d.updated_by_name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
    res.json({ owned, shared });
  });

  api.post('/documents', (req, res) => {
    const { title, content } = req.body ?? {};
    if (content !== undefined && typeof content !== 'string') {
      throw new HttpError(400, '"content" must be an HTML string.');
    }
    const doc = createDocument(req.user.id, { title, content });
    res.status(201).json({ document: serializeDoc(doc, 'owner') });
  });

  api.post('/documents/import', upload.single('file'), async (req, res) => {
    const file = requireFile(req);
    const { html, title, warnings } = await fileToHtml(file);
    const doc = createDocument(req.user.id, {
      title,
      content: html,
      sourceFilename: file.originalname,
    });
    res.status(201).json({ document: serializeDoc(doc, 'owner'), warnings });
  });

  api.get('/documents/:id', (req, res) => {
    const { doc, role } = loadDoc(req);
    res.json({ document: serializeDoc(doc, role) });
  });

  api.patch('/documents/:id', (req, res) => {
    const { doc, role } = loadDoc(req, 'editor');
    const { title, content, version } = req.body ?? {};

    if (title === undefined && content === undefined) {
      throw new HttpError(400, 'Nothing to update: send "title" and/or "content".');
    }
    if (title !== undefined && typeof title !== 'string') {
      throw new HttpError(400, '"title" must be a string.');
    }
    if (content !== undefined && typeof content !== 'string') {
      throw new HttpError(400, '"content" must be an HTML string.');
    }
    if (version !== undefined && !Number.isInteger(version)) {
      throw new HttpError(400, '"version" must be an integer.');
    }

    // Optimistic concurrency: if the client says which version it edited, refuse
    // to overwrite a newer one (e.g. a collaborator saved in the meantime).
    const expected = version ?? doc.version;
    const result = q.updateDoc.run(
      title !== undefined ? normalizeTitle(title) : doc.title,
      content !== undefined ? sanitizeContent(content) : doc.content,
      now(),
      req.user.id,
      doc.id,
      expected,
    );
    if (result.changes === 0) {
      const latest = q.docById.get(doc.id);
      throw new HttpError(409, 'This document was changed by someone else.', {
        document: serializeDoc(latest, role),
      });
    }
    res.json({ document: serializeDoc(q.docById.get(doc.id), role) });
  });

  api.delete('/documents/:id', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    q.deleteDoc.run(doc.id);
    res.status(204).end();
  });

  // ---------- sharing ----------

  api.get('/documents/:id/shares', (req, res) => {
    const { doc } = loadDoc(req);
    res.json(collaborators(doc.id));
  });

  api.post('/documents/:id/shares', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role = req.body?.role ?? 'viewer';
    if (!email) throw new HttpError(400, 'Enter an email address.');
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}.`);

    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, `No user with email "${email}".`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'The owner already has full access.');

    q.upsertShare.run(doc.id, target.id, role, now());
    res.status(201).json(collaborators(doc.id));
  });

  api.delete('/documents/:id/shares/:userId', (req, res) => {
    const { doc, role } = loadDoc(req);
    const userId = Number(req.params.userId);
    // Owners can remove anyone; collaborators can only remove themselves ("leave").
    if (role !== 'owner' && userId !== req.user.id) {
      throw new HttpError(403, 'Only the owner can do that.');
    }
    q.deleteShare.run(doc.id, userId);
    res.json(collaborators(doc.id));
  });

  // ---------- import into an existing draft ----------

  api.post('/convert', upload.single('file'), async (req, res) => {
    const file = requireFile(req);
    const { html, warnings } = await fileToHtml(file);
    res.json({ html, warnings, filename: file.originalname });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  app.use('/api', api);

  // ---------- built client (production) ----------

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // ---------- errors ----------

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status ?? err.statusCode ?? 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = `File is too large. Max size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
      }
    }
    if (status >= 500) {
      console.error(err);
      message = 'Something went wrong on the server.';
    }
    res.status(status).json({ error: message, ...(err.extra ?? {}) });
  });

  return app;
}
