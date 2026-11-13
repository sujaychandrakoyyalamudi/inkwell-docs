# Inkwell — a small collaborative document editor

A full-stack document editor: create and edit rich-text documents in the browser, import files, share
documents with other users as editors or viewers, and keep everything in SQLite.

**Stack:** React 19 + [TipTap 3](https://tiptap.dev) (ProseMirror) on Vite · Node + Express 5 ·
SQLite through Node's built-in `node:sqlite`. No native modules, no external services.

---

## Quick start

Requires **Node.js 22.13 or newer** (built-in `node:sqlite`). Tested on Node 26.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The API runs on port 3001 and Vite proxies `/api` to it.

On first start the server creates `data/inkwell.db` and seeds three demo users and two shared documents.
Pick an account on the sign-in screen; there is no password.

| Command | What it does |
| --- | --- |
| `npm run dev` | API (auto-restarts on server changes) + Vite dev server with hot reload |
| `npm test` | API test suite (`node:test` + supertest, in-memory DB) |
| `npm run build && npm start` | Production build; one Node process serves the app and API on `PORT` (default 3001) |
| `npm run seed:reset` | Delete the local database so the next start re-seeds demo data (stop the server first) |

## Try the sharing flow (2 minutes)

1. Sign in as **Alice**. *Owned by me* lists "Welcome to Inkwell" (shared with Bob as an editor).
   *Shared with me* lists Bob's "Q3 planning notes" marked **View only**.
2. Open "Welcome to Inkwell", edit some text, and rename it by clicking the title. The status next to the
   title goes from *Unsaved changes* to *Saving…* to *Saved*. Refresh the page and the changes are still there.
3. Click **Share**, pick **Carol**, choose **Viewer**, then click **Share**.
4. From the avatar menu (top right), **switch to Carol**. You stay on the same document. It is now
   read-only: no toolbar, a view-only banner, and it appears under *Shared with me* on her dashboard.
5. Switch to **Bob** (an editor) and make a change. Switch back to Carol and the change is there. An open
   tab also picks up collaborators' saves within about 4 seconds.
6. Back as Alice, open **Share** again to change Bob's role or remove someone. Removed users get a
   "Document unavailable" page if they open the link.

## Features

### Document creation and editing
- Create, rename (click the title), edit, delete (owner only), and reopen documents.
- Toolbar and keyboard shortcuts for **bold**, *italic*, <u>underline</u>, strikethrough,
  Normal text / Heading 1–3, bulleted and numbered lists, block quotes, horizontal lines, text
  alignment, clear formatting, and undo/redo.
- **Autosave** runs 0.8 s after you stop typing, and also when the title field loses focus and on ⌘/Ctrl+S.
  A status indicator shows the save state. Unsaved changes are flushed before you navigate away, and the
  browser warns before you close a tab with a save still pending.

### File upload
Supported types: **`.txt`, `.md` / `.markdown`, `.docx`. Max 5 MB.** The UI lists these next to every
upload control. The server enforces them and rejects anything else with a clear message.

- **Import as a new document.** Click **Import file** on the dashboard, or drag a file onto the page. The
  file becomes a new editable document named after the file, and the dashboard shows the source filename
  as a chip.
- **Insert into an existing draft.** **Insert file** in the editor toolbar puts the converted content at
  the cursor.

How files are converted:

| Type | Converter | What is kept |
| --- | --- | --- |
| `.docx` | [mammoth](https://github.com/mwilliamson/mammoth.js) | Headings, bold, italic, underline, strikethrough, bulleted and numbered lists, links |
| `.md` | [marked](https://marked.js.org) (GFM) | Headings, emphasis, lists, quotes, code, links |
| `.txt` | built in | A blank line starts a new paragraph; single line breaks are kept |

Images, tables, comments, and fonts are not imported. Table cells come through as plain text. Legacy
`.doc`, PDF, and other formats are rejected.

### Sharing
- Every document has one **owner**: the user who created or imported it.
- The owner shares by email with a role:
  - **Editor**: can read, edit, and rename.
  - **Viewer**: read-only. The editor is not editable and the toolbar is hidden.
- The owner can change roles or revoke access at any time. Collaborators can see who has access and can
  remove themselves (**Leave**). Only the owner can delete the document or manage access.
- The dashboard splits documents into **Owned by me** and **Shared with me**. Each row shows a role badge,
  the owner, and how many people the document is shared with.
- The server enforces all of this; the UI only reflects it. A user with no access gets **404** (not 403),
  so the API does not reveal whether a document exists.

### Persistence
- SQLite file at `data/inkwell.db` (WAL mode). Documents, shares, users, and sessions survive refreshes
  and server restarts.
- Document content is stored as **sanitized HTML**, which is also what the editor produces. Formatting
  round-trips exactly, and you can inspect the data with any SQLite client:
  `sqlite3 data/inkwell.db 'select title, content from documents'`.

## Architecture

```
client/                 React app (Vite root)
  src/api.js            fetch wrapper for the REST API
  src/components/
    Dashboard.jsx       owned / shared lists, new doc, import (button + drag-and-drop)
    EditorPage.jsx      TipTap editor, autosave queue, conflict handling, live refresh
    Toolbar.jsx         formatting controls, "Insert file"
    ShareDialog.jsx     grant / change / revoke access
    AccountMenu.jsx     switch demo user, sign out
server/
  index.js              entry point (env config, listen)
  app.js                Express app: auth, documents, sharing, import routes
  db.js                 schema, seed data
  convert.js            .txt/.md/.docx → HTML, HTML sanitizer
tests/api.test.js       24 API tests
samples/                example .docx / .md / .txt files for trying the import
```

### Data model

```
users(id, email, name, color)
sessions(token, user_id → users, created_at)
documents(id uuid, owner_id → users, title, content html, version, source_filename,
          created_at, updated_at, updated_by → users)
document_shares(document_id → documents, user_id → users, role 'viewer'|'editor', created_at)
                PRIMARY KEY (document_id, user_id)
```

Foreign keys cascade: deleting a document deletes its shares.

### API

| Method & path | Who | Purpose |
| --- | --- | --- |
| `GET /api/users` | anyone | Demo accounts (sign-in screen, share suggestions) |
| `POST /api/auth/login` `{email}` | anyone | Start a session (httpOnly cookie) |
| `POST /api/auth/logout` · `GET /api/auth/me` | | |
| `GET /api/documents` | signed in | `{ owned: [...], shared: [...] }` |
| `POST /api/documents` `{title?, content?}` | signed in | Create a document |
| `POST /api/documents/import` (multipart `file`) | signed in | Create a document from a file |
| `GET /api/documents/:id` | owner, editor, viewer | Document with content and the caller's role |
| `PATCH /api/documents/:id` `{title?, content?, version}` | owner, editor | Save; returns **409** with the latest copy if `version` is stale |
| `DELETE /api/documents/:id` | owner | Delete |
| `GET /api/documents/:id/shares` | owner, editor, viewer | Owner and collaborators |
| `POST /api/documents/:id/shares` `{email, role}` | owner | Grant access or change a role (upsert) |
| `DELETE /api/documents/:id/shares/:userId` | owner, or that user | Revoke access / leave |
| `POST /api/convert` (multipart `file`) | signed in | File → HTML, for inserting into a draft |

## Design decisions and trade-offs

- **Mock auth.** Picking a seeded user creates a real server-side session: a random token in an httpOnly,
  SameSite=Lax cookie. Every authorization check runs on the server against that session, so swapping in
  real authentication (passwords, OAuth) would only change the login route.
- **HTML as the storage format.** File imports produce HTML, the editor reads and writes HTML, and the
  stored data is easy to read. The server sanitizes every write and import against an allow-list that
  matches the editor's schema (no scripts, event handlers, or styles other than `text-align`). That makes
  stored XSS impossible even if a client skips the editor. The cost is that structure is only as strict as
  the allow-list. TipTap's JSON format would be stricter but harder to inspect.
- **Optimistic concurrency, not real-time co-editing.** Each document has a `version`. A save sends the
  version it was based on, and the server updates only if that version is still current. When two editors
  collide, nobody's work is silently overwritten: the second editor sees a banner with **Load their
  version** or **Keep mine**. Open tabs poll every 4 s and apply collaborators' saves while idle. True
  simultaneous editing (Yjs/CRDT with WebSockets) was out of scope for this size of project.
- **`node:sqlite` instead of `better-sqlite3`.** Nothing native to compile, so `npm install` works on any
  machine with a recent Node.
- **Single package, two processes in dev.** Vite handles the frontend with hot reload. Production builds
  to `dist/`, which Express serves, so you deploy one process.

## Testing

```bash
npm test
```

The 24 API tests cover:

- authentication
- create, rename, edit, and reopen with formatting intact
- sanitization (scripts, event handlers, `javascript:` URLs)
- version conflicts (409)
- every sharing rule: viewer is read-only, editor can edit but not manage access, revoke, leave, 404 for
  outsiders, input validation, cascade on delete
- `.docx`, `.md`, and `.txt` import using the files in `samples/`
- unsupported, oversized, and corrupt uploads
- data surviving a database reopen

The UI flows (editing, toolbar, autosave, sharing, switching users, the view-only mode, conflict
resolution, drag-and-drop import, insert-from-file, and mobile layout) were checked by hand in the browser.
There are no automated browser tests yet.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `API_PORT` | `3001` | API port in development (Vite proxies to it) |
| `PORT` | `3001` | Port in production (`npm start`) |
| `DB_PATH` | `data/inkwell.db` | SQLite file location |
| `SEED_DEMO` | on | Set to `0` to skip seeding the two demo documents (users are always seeded) |
| `COOKIE_SECURE` | off | Set to `1` behind HTTPS to mark the session cookie `Secure` |

## Known limitations / next steps

- No real-time co-editing or presence. Next step: Yjs plus a WebSocket provider (TipTap has bindings).
- No version history. The `version` column is there; snapshotting each save into a `document_revisions`
  table would add history and restore.
- Sharing works only with existing accounts. There are no invite emails, link sharing, or groups.
- Sessions never expire, and there is no CSRF token (SameSite=Lax covers the demo).
- Imports skip images and tables.
- No browser-level tests (Playwright) yet.
