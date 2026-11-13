import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createCore } from '../shared/core.js';
import { HttpError } from '../shared/errors.js';
import { fileTooLargeError, isSupportedFile } from '../shared/content.js';
import { fileToHtml, sanitizeContent, MAX_UPLOAD_BYTES, UnsupportedFileError } from './convert.js';

const SESSION_COOKIE = 'sid';

/**
 * Build the Express app around an open database handle. All document, sharing and
 * authorization rules live in shared/core.js; this file only maps them onto HTTP.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ staticDir?: string, secureCookies?: boolean }} [options]
 */
export function createApp(db, { staticDir, secureCookies = false } = {}) {
  const core = createCore(db, { sanitize: sanitizeContent });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const token = (req) => req.cookies?.[SESSION_COOKIE];

  function requireUser(req, _res, next) {
    try {
      req.user = core.requireUser(token(req));
      next();
    } catch (err) {
      next(err);
    }
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    // Browsers send multipart filenames as UTF-8; multer defaults to latin1.
    defParamCharset: 'utf8',
    fileFilter(_req, file, cb) {
      if (!isSupportedFile(file.originalname)) return cb(new UnsupportedFileError(file.originalname));
      cb(null, true);
    },
  });

  function requireFile(req) {
    if (!req.file) throw new HttpError(400, 'Attach a file in the "file" field.');
    return req.file;
  }

  const api = express.Router();

  // ---------- auth (mocked: pick a seeded account, no password) ----------

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/users', (_req, res) => res.json({ users: core.listUsers() }));

  api.post('/auth/login', (req, res) => {
    const { user, token: sid } = core.login(req.body?.email);
    res.cookie(SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    res.json({ user });
  });

  api.post('/auth/logout', (req, res) => {
    core.logout(token(req));
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => {
    const user = core.userForToken(token(req));
    res.json({ user: user ? { id: user.id, email: user.email, name: user.name, color: user.color } : null });
  });

  // ---------- documents ----------

  api.use('/documents', requireUser);
  api.use('/convert', requireUser);

  api.get('/documents', (req, res) => res.json(core.listDocuments(req.user)));

  api.post('/documents', (req, res) => {
    const { title, content } = req.body ?? {};
    res.status(201).json({ document: core.createDocument(req.user, { title, content }) });
  });

  api.post('/documents/import', upload.single('file'), async (req, res) => {
    const file = requireFile(req);
    const { html, title, warnings } = await fileToHtml(file);
    const document = core.createDocument(req.user, {
      title,
      content: html,
      sourceFilename: file.originalname,
    });
    res.status(201).json({ document, warnings });
  });

  api.get('/documents/:id', (req, res) => {
    res.json({ document: core.getDocument(req.user, req.params.id) });
  });

  api.patch('/documents/:id', (req, res) => {
    res.json({ document: core.updateDocument(req.user, req.params.id, req.body) });
  });

  api.delete('/documents/:id', (req, res) => {
    core.deleteDocument(req.user, req.params.id);
    res.status(204).end();
  });

  // ---------- sharing ----------

  api.get('/documents/:id/shares', (req, res) => {
    res.json(core.getCollaborators(req.user, req.params.id));
  });

  api.post('/documents/:id/shares', (req, res) => {
    res.status(201).json(core.share(req.user, req.params.id, req.body));
  });

  api.delete('/documents/:id/shares/:userId', (req, res) => {
    res.json(core.unshare(req.user, req.params.id, req.params.userId));
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
    if (err instanceof multer.MulterError) {
      err = err.code === 'LIMIT_FILE_SIZE' ? fileTooLargeError() : new HttpError(400, err.message);
    }
    const status = err.status ?? err.statusCode ?? 500;
    let message = err.message;
    if (status >= 500) {
      console.error(err);
      message = 'Something went wrong on the server.';
    }
    res.status(status).json({ error: message, ...(err.extra ?? {}) });
  });

  return app;
}
