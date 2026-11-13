// Database schema and demo seed data, shared by the Node server (node:sqlite)
// and the browser-only build (sql.js). Both expose the same exec/prepare API.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  version         INTEGER NOT NULL DEFAULT 1,
  source_filename TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

CREATE TABLE IF NOT EXISTS document_shares (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id);
`;

export const SEED_USERS = [
  { email: 'alice@example.com', name: 'Alice Chen', color: '#2563eb' },
  { email: 'bob@example.com', name: 'Bob Martinez', color: '#16a34a' },
  { email: 'carol@example.com', name: 'Carol Singh', color: '#c026d3' },
];

/** Run fn inside a transaction; rolls back if it throws. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Apply the schema, then seed demo users (always) and demo documents (first run only). */
export function initDatabase(db, { seedDemoDocs = true } = {}) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (email, name, color) VALUES (?, ?, ?)');
  for (const u of SEED_USERS) insertUser.run(u.email, u.name, u.color);
  if (seedDemoDocs) seedDocuments(db);
  return db;
}

function seedDocuments(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM documents').get();
  if (n > 0) return;

  const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  const alice = userId('alice@example.com');
  const bob = userId('bob@example.com');
  const now = new Date().toISOString();
  const newId = () => globalThis.crypto.randomUUID();

  const insertDoc = db.prepare(`
    INSERT INTO documents (id, owner_id, title, content, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertShare = db.prepare(`
    INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`);

  transaction(db, () => {
    const welcome = newId();
    insertDoc.run(
      welcome,
      alice,
      'Welcome to Inkwell',
      [
        '<h1>Welcome to Inkwell</h1>',
        '<p>This document is <strong>owned by Alice</strong> and shared with <em>Bob</em> as an <u>editor</u>.</p>',
        '<h2>Things to try</h2>',
        '<ul><li><p>Format text with the toolbar or keyboard shortcuts (⌘B, ⌘I, ⌘U).</p></li>',
        '<li><p>Rename this document by clicking its title.</p></li>',
        '<li><p>Click <strong>Share</strong> to give Carol access.</p></li></ul>',
        '<h2>Numbered steps</h2>',
        '<ol><li><p>Sign in as Bob from the account menu.</p></li>',
        '<li><p>Open this document from <em>Shared with me</em>.</p></li>',
        '<li><p>Edit it — changes save automatically.</p></li></ol>',
      ].join(''),
      now,
      now,
      alice,
    );
    insertShare.run(welcome, bob, 'editor', now);

    const plan = newId();
    insertDoc.run(
      plan,
      bob,
      'Q3 planning notes',
      [
        '<h1>Q3 planning notes</h1>',
        '<p>Owned by Bob. Alice has <strong>view-only</strong> access, so she cannot change this text.</p>',
        '<h3>Goals</h3>',
        '<ol><li><p>Ship the import flow</p></li><li><p>Improve sharing UX</p></li></ol>',
      ].join(''),
      now,
      now,
      bob,
    );
    insertShare.run(plan, alice, 'viewer', now);
  });
}
