// In-browser stand-in for the Express API, used by the static (GitHub Pages) build.
// It answers the same routes with the same JSON shapes and status codes, by running
// the shared core (shared/core.js) against SQLite compiled to WebAssembly (sql.js).
// The database is snapshotted into a storage area (localStorage in the browser).
import { createCore, publicUser } from '../../../shared/core.js';
import { initDatabase } from '../../../shared/schema.js';
import { HttpError } from '../../../shared/errors.js';
import {
  MAX_UPLOAD_BYTES,
  UnsupportedFileError,
  convertFile,
  fileTooLargeError,
  isSupportedFile,
} from '../../../shared/content.js';
import { wrapSqlJs } from './sqljs-db.js';

export const STORAGE_KEYS = {
  db: 'inkwell:db',
  revision: 'inkwell:rev',
  session: 'inkwell:session',
};

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {{ SQL: any, storage: Storage, sanitize: (html: string) => string,
 *           docxToHtml: (bytes: Uint8Array) => Promise<{ value: string, messages: any[] }> }} deps
 */
export function createLocalBackend({ SQL, storage, sanitize, docxToHtml }) {
  let sqlDb;
  let core;
  let loadedRevision;

  /** (Re)load the database from storage, creating and seeding it on first use. */
  function load() {
    sqlDb?.close();
    const saved = storage.getItem(STORAGE_KEYS.db);
    sqlDb = null;
    if (saved) {
      try {
        sqlDb = new SQL.Database(base64ToBytes(saved));
        sqlDb.exec('SELECT count(*) FROM sqlite_master'); // throws if the snapshot is corrupt
      } catch {
        sqlDb = null;
      }
    }
    const fresh = !sqlDb;
    if (fresh) sqlDb = new SQL.Database();
    const db = wrapSqlJs(sqlDb);
    initDatabase(db, { seedDemoDocs: fresh });
    core = createCore(db, { sanitize });
    loadedRevision = storage.getItem(STORAGE_KEYS.revision);
    if (fresh) persist();
  }

  /** Snapshot the database into storage and bump the revision so other tabs reload. */
  function persist() {
    try {
      storage.setItem(STORAGE_KEYS.db, bytesToBase64(sqlDb.export()));
    } catch {
      throw new HttpError(507, 'Browser storage is full. Delete some documents or reset the demo data.');
    }
    loadedRevision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.setItem(STORAGE_KEYS.revision, loadedRevision);
  }

  /** Pick up writes made by another tab since this one last loaded. */
  function sync() {
    if (storage.getItem(STORAGE_KEYS.revision) !== loadedRevision) load();
  }

  const token = () => storage.getItem(STORAGE_KEYS.session);
  const currentUser = () => core.requireUser(token());

  /** Run a write against the latest data, then persist it. */
  function mutate(fn) {
    sync();
    const result = fn();
    persist();
    return result;
  }

  async function readUpload(body) {
    const file = body?.get?.('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new HttpError(400, 'Attach a file in the "file" field.');
    }
    if (!isSupportedFile(file.name)) throw new UnsupportedFileError(file.name);
    if (file.size > MAX_UPLOAD_BYTES) throw fileTooLargeError();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const converted = await convertFile({ filename: file.name, bytes, sanitize, docxToHtml });
    return { file, ...converted };
  }

  /**
   * Handle one API request. Resolves with the JSON body (or null for 204) and
   * rejects with an HttpError carrying the same status the server would send.
   */
  async function handle(method, url, body) {
    sync();
    const path = url.split('?')[0];
    let m;

    if (path === '/health') return { ok: true };
    if (path === '/users' && method === 'GET') return { users: core.listUsers() };
    if (path === '/auth/me' && method === 'GET') {
      return { user: publicUser(core.userForToken(token())) ?? null };
    }
    if (path === '/auth/login' && method === 'POST') {
      return mutate(() => {
        const { user, token: sid } = core.login(body?.email);
        storage.setItem(STORAGE_KEYS.session, sid);
        return { user };
      });
    }
    if (path === '/auth/logout' && method === 'POST') {
      return mutate(() => {
        core.logout(token());
        storage.removeItem(STORAGE_KEYS.session);
        return { ok: true };
      });
    }

    if (path === '/documents') {
      if (method === 'GET') return core.listDocuments(currentUser());
      if (method === 'POST') {
        return mutate(() => ({
          document: core.createDocument(currentUser(), { title: body?.title, content: body?.content }),
        }));
      }
    }

    if (path === '/documents/import' && method === 'POST') {
      currentUser();
      const { file, html, title, warnings } = await readUpload(body);
      return mutate(() => ({
        document: core.createDocument(currentUser(), {
          title,
          content: html,
          sourceFilename: file.name,
        }),
        warnings,
      }));
    }

    if (path === '/convert' && method === 'POST') {
      currentUser();
      const { file, html, warnings } = await readUpload(body);
      return { html, warnings, filename: file.name };
    }

    if ((m = path.match(/^\/documents\/([\w-]+)$/))) {
      const id = m[1];
      if (method === 'GET') return { document: core.getDocument(currentUser(), id) };
      if (method === 'PATCH') {
        return mutate(() => ({ document: core.updateDocument(currentUser(), id, body) }));
      }
      if (method === 'DELETE') {
        mutate(() => core.deleteDocument(currentUser(), id));
        return null;
      }
    }

    if ((m = path.match(/^\/documents\/([\w-]+)\/shares$/))) {
      if (method === 'GET') return core.getCollaborators(currentUser(), m[1]);
      if (method === 'POST') return mutate(() => core.share(currentUser(), m[1], body));
    }

    if ((m = path.match(/^\/documents\/([\w-]+)\/shares\/(\d+)$/)) && method === 'DELETE') {
      return mutate(() => core.unshare(currentUser(), m[1], m[2]));
    }

    throw new HttpError(404, 'Not found.');
  }

  /** Remove every trace of the demo from storage; the next request re-seeds it. */
  function reset() {
    for (const key of Object.values(STORAGE_KEYS)) storage.removeItem(key);
    load();
  }

  load();
  return { handle, reset };
}
