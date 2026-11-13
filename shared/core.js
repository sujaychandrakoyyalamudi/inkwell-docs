// Inkwell's domain logic: sessions, documents, sharing and authorization.
// Framework-free and synchronous, so the same rules run in the Node server (behind
// Express, with node:sqlite) and in the browser-only build (with sql.js).
import { HttpError } from './errors.js';
import { normalizeTitle } from './content.js';

const ROLES = ['viewer', 'editor'];
const RANK = { viewer: 1, editor: 2, owner: 3 };

export const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, color: u.color };

const randomToken = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/**
 * @param {{ prepare(sql: string): { get(...p): any, all(...p): any[], run(...p): { changes: number|bigint } } }} db
 * @param {{ sanitize: (html: string) => string }} options
 */
export function createCore(db, { sanitize }) {
  const now = () => new Date().toISOString();

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
    shareRole: db.prepare('SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?'),
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

  /**
   * Resolve a document and the caller's role on it. Documents the caller cannot
   * see are reported as 404 so their existence is not leaked.
   */
  function loadDoc(user, id, minRole = 'viewer') {
    const doc = q.docById.get(id);
    if (!doc) throw new HttpError(404, 'Document not found.');
    const role =
      doc.owner_id === user.id ? 'owner' : (q.shareRole.get(doc.id, user.id)?.role ?? null);
    if (!role) throw new HttpError(404, 'Document not found.');
    if (RANK[role] < RANK[minRole]) {
      throw new HttpError(
        403,
        minRole === 'owner' ? 'Only the owner can do that.' : 'You have view-only access to this document.',
      );
    }
    return { doc, role };
  }

  function serializeDoc(doc, role) {
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      role,
      owner: publicUser(q.userById.get(doc.owner_id)),
      updatedBy: doc.updated_by ? publicUser(q.userById.get(doc.updated_by)) : null,
      sourceFilename: doc.source_filename,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }

  function collaboratorsOf(docId) {
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

  // ---------- sessions (mock login: pick a seeded account) ----------

  function listUsers() {
    return q.allUsers.all().map(publicUser);
  }

  function login(rawEmail) {
    const email = String(rawEmail ?? '').trim().toLowerCase();
    const user = q.userByEmail.get(email);
    if (!user) throw new HttpError(404, `No account for "${email}".`);
    const token = randomToken();
    q.insertSession.run(token, user.id, now());
    return { user: publicUser(user), token };
  }

  function logout(token) {
    if (token) q.deleteSession.run(token);
  }

  function userForToken(token) {
    return (token && q.sessionUser.get(token)) || null;
  }

  function requireUser(token) {
    const user = userForToken(token);
    if (!user) throw new HttpError(401, 'Please sign in.');
    return user;
  }

  // ---------- documents ----------

  function listDocuments(user) {
    const owned = q.ownedDocs.all(user.id).map((d) => ({
      id: d.id,
      title: d.title,
      role: 'owner',
      owner: publicUser(user),
      shareCount: Number(d.share_count),
      sourceFilename: d.source_filename,
      updatedByName: d.updated_by_name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
    const shared = q.sharedDocs.all(user.id).map((d) => ({
      id: d.id,
      title: d.title,
      role: d.role,
      owner: { id: d.owner_id, name: d.owner_name, email: d.owner_email, color: d.owner_color },
      sourceFilename: d.source_filename,
      updatedByName: d.updated_by_name,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
    return { owned, shared };
  }

  function createDocument(user, { title, content, sourceFilename = null } = {}) {
    if (content !== undefined && typeof content !== 'string') {
      throw new HttpError(400, '"content" must be an HTML string.');
    }
    const id = globalThis.crypto.randomUUID();
    const ts = now();
    q.insertDoc.run(
      id,
      user.id,
      normalizeTitle(title),
      sanitize(content ?? ''),
      sourceFilename,
      ts,
      ts,
      user.id,
    );
    return serializeDoc(q.docById.get(id), 'owner');
  }

  function getDocument(user, id) {
    const { doc, role } = loadDoc(user, id);
    return serializeDoc(doc, role);
  }

  function updateDocument(user, id, body) {
    const { doc, role } = loadDoc(user, id, 'editor');
    const { title, content, version } = body ?? {};

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
    const result = q.updateDoc.run(
      title !== undefined ? normalizeTitle(title) : doc.title,
      content !== undefined ? sanitize(content) : doc.content,
      now(),
      user.id,
      doc.id,
      version ?? doc.version,
    );
    if (Number(result.changes) === 0) {
      throw new HttpError(409, 'This document was changed by someone else.', {
        document: serializeDoc(q.docById.get(doc.id), role),
      });
    }
    return serializeDoc(q.docById.get(doc.id), role);
  }

  function deleteDocument(user, id) {
    const { doc } = loadDoc(user, id, 'owner');
    q.deleteDoc.run(doc.id);
  }

  // ---------- sharing ----------

  function getCollaborators(user, id) {
    const { doc } = loadDoc(user, id);
    return collaboratorsOf(doc.id);
  }

  function share(user, id, body) {
    const { doc } = loadDoc(user, id, 'owner');
    const email = String(body?.email ?? '').trim().toLowerCase();
    const role = body?.role ?? 'viewer';
    if (!email) throw new HttpError(400, 'Enter an email address.');
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}.`);

    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, `No user with email "${email}".`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'The owner already has full access.');

    q.upsertShare.run(doc.id, target.id, role, now());
    return collaboratorsOf(doc.id);
  }

  function unshare(user, id, targetUserId) {
    const { doc, role } = loadDoc(user, id);
    const targetId = Number(targetUserId);
    // Owners can remove anyone; collaborators can only remove themselves ("leave").
    if (role !== 'owner' && targetId !== user.id) {
      throw new HttpError(403, 'Only the owner can do that.');
    }
    q.deleteShare.run(doc.id, targetId);
    return collaboratorsOf(doc.id);
  }

  return {
    listUsers,
    login,
    logout,
    userForToken,
    requireUser,
    listDocuments,
    createDocument,
    getDocument,
    updateDocument,
    deleteDocument,
    getCollaborators,
    share,
    unshare,
  };
}
