# Submission

**Project:** Inkwell, a collaborative document editor
**Live demo:** https://sujaychandrakoyyalamudi.github.io/inkwell-docs/
**Repository:** https://github.com/sujaychandrakoyyalamudi/inkwell-docs (branch `main`)

This file lists exactly what this submission includes, where each requirement is implemented, and what is
intentionally left out.

---

## 1. Deliverables

| # | Deliverable | Location |
| --- | --- | --- |
| 1 | A working full-stack application (React client, Node.js/Express API, SQLite storage) | [`client/`](client), [`server/`](server), [`shared/`](shared) |
| 2 | A live product URL, deployed with GitHub Pages | https://sujaychandrakoyyalamudi.github.io/inkwell-docs/ (browser-only edition; see section 2.6) |
| 3 | README with local setup and run instructions | [`README.md`](README.md): *Quick start*, *Local setup*, *Running the app*, *Troubleshooting*, and *Deployment* sections |
| 4 | Architecture note | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 5 | AI workflow note | [`AI_WORKFLOW.md`](AI_WORKFLOW.md) |
| 6 | Automated tests (31 tests) | [`tests/`](tests): 24 server API tests and 7 browser-backend tests, run with `npm test` |
| 7 | Deployment pipeline | [`.github/workflows/pages.yml`](.github/workflows/pages.yml): tests, build, and deploy on every push to `main` |
| 8 | Sample files for trying the upload feature | [`samples/`](samples): one each of `.docx`, `.md`, and `.txt` |
| 9 | Screenshots of the running app | [`docs/screenshots/`](docs/screenshots) |
| 10 | This submission summary | [`SUBMISSION.md`](SUBMISSION.md) |

## 2. Requirements coverage

All four required areas are implemented in both editions.

### 2.1 Document creation and editing

| Requirement | Where to see it | Implemented in |
| --- | --- | --- |
| Create a new document | Dashboard → **New document** | `Dashboard.jsx`, `POST /api/documents` |
| Rename a document | Click the title in the editor | `EditorPage.jsx`, `PATCH /api/documents/:id` |
| Edit content in the browser | Editor page | `EditorPage.jsx` (TipTap editor) |
| Save and reopen documents | Saves automatically; reopen from the dashboard or by refreshing | Autosave queue in `EditorPage.jsx`; `GET /api/documents/:id` |
| Bold, italic, underline | Toolbar, or ⌘/Ctrl+B, I, U | `Toolbar.jsx` |
| Headings or text sizes | Toolbar style menu: Normal, Heading 1–3 | `Toolbar.jsx` (`BlockStyleMenu`) |
| Bulleted and numbered lists | Toolbar list buttons | `Toolbar.jsx` |

### 2.2 File upload

| Requirement | Where to see it | Implemented in |
| --- | --- | --- |
| Upload a file into the product workflow | Dashboard → **Import file**, or drag a file onto the dashboard: the file becomes a new editable document | `Dashboard.jsx`, `POST /api/documents/import`, `shared/content.js` |
| Import into an existing draft | Editor toolbar → **Insert file** puts the content at the cursor | `Toolbar.jsx`, `POST /api/convert` |
| Supported types stated in the UI and README | The dashboard hint and the Insert file tooltip read ".txt, .md or .docx (max 5 MB)"; the README has a *File import* section | `client/src/lib.js` (`ACCEPTED_LABEL`), `README.md` |

### 2.3 Sharing

| Requirement | Where to see it | Implemented in |
| --- | --- | --- |
| A document owner | "Owned by …" under the title; an *Owner* badge | `documents.owner_id` in `shared/schema.js` |
| Grant access to another user | Editor → **Share**, then add by email as Editor or Viewer; roles can be changed or access revoked | `ShareDialog.jsx`, `share` and `unshare` in `shared/core.js` |
| Visible distinction between owned and shared documents | Dashboard sections *Owned by me* and *Shared with me*, plus role badges | `Dashboard.jsx` |
| Simulated users | Three seeded demo accounts, mock sign-in, and real sessions; switch users from the avatar menu | `shared/schema.js`, `Login.jsx`, `AccountMenu.jsx` |

### 2.4 Persistence

| Requirement | How it is met | Implemented in |
| --- | --- | --- |
| Documents survive a refresh | SQLite: a file on the server (`data/inkwell.db`), or the browser's `localStorage` in the live demo | `server/db.js`, `client/src/static/backend.js` |
| Formatting is preserved | Content is stored as sanitized HTML, the editor's native format | `server/convert.js`, `client/src/static/sanitize.js` |
| Shared access can be demonstrated | Seed data includes one document shared as editor and one as viewer, and shares are stored in the `document_shares` table | `shared/schema.js` |

### 2.5 Beyond the requirements

- **Conflict detection.** Two people saving at the same time can never silently overwrite each other. The
  second person is offered *Load their version* or *Keep mine*.
- **Live updates.** Open documents pick up collaborators' saves and changes in access level within a few
  seconds.
- **Read-only mode.** Viewers get a read-only editor with no toolbar; collaborators can leave a shared
  document.
- **Safe storage.** All stored content is sanitized against an allow-list, and users without access get
  `404`, so they can't tell whether a document exists.
- **Mobile.** The layout works on phone-sized screens.

### 2.6 The live demo

GitHub Pages hosts static files only, so the live URL serves a **browser-only edition**. It is the same
React app running the same business rules (`shared/core.js`), but the API runs inside the browser on
SQLite compiled to WebAssembly.

- Documents are saved in each visitor's browser.
- Sharing works between accounts signed in on the same browser: share as Alice, then switch to Bob or
  Carol from the avatar menu.
- **Reset demo data**, in the avatar menu, starts over.

The README's *Deployment* section and section 7 of `ARCHITECTURE.md` compare the two editions.

## 3. File manifest

The repository contains exactly these 45 files.

### Documentation (8)

| File | Purpose |
| --- | --- |
| `README.md` | Overview, live demo, setup and run instructions, troubleshooting, deployment, API reference |
| `ARCHITECTURE.md` | Architecture note: components, data model, key flows, security, trade-offs, the two editions |
| `AI_WORKFLOW.md` | AI workflow note: how the project was built and verified |
| `SUBMISSION.md` | This file |
| `docs/screenshots/dashboard.png` | Screenshot: dashboard with owned and shared sections |
| `docs/screenshots/editor.png` | Screenshot: editor with toolbar |
| `docs/screenshots/share-dialog.png` | Screenshot: share dialog |
| `docs/screenshots/view-only.png` | Screenshot: a viewer's read-only page |

### Client: `client/` (17)

| File | Purpose |
| --- | --- |
| `index.html` | HTML entry point |
| `src/main.jsx` | React root and toast notifications |
| `src/App.jsx` | Session check and routing |
| `src/api.js` | API client; in the static build it calls the in-browser backend |
| `src/lib.js` | Hash router, date helpers, accepted file types |
| `src/styles.css` | All styles, including the responsive layout |
| `src/components/Login.jsx` | Demo account sign-in, plus the live-demo notice |
| `src/components/Dashboard.jsx` | Owned and shared document lists, create, import, drag-and-drop |
| `src/components/EditorPage.jsx` | Editor, autosave, conflict handling, live refresh |
| `src/components/Toolbar.jsx` | Formatting toolbar, style menu, insert from file |
| `src/components/ShareDialog.jsx` | Grant, change, and revoke access |
| `src/components/AccountMenu.jsx` | Switch demo user, sign out, reset demo data (live demo) |
| `src/components/ui.jsx` | Avatar, badges, modal, toasts |
| `src/static/backend.js` | In-browser backend: the API's routes running on the shared core |
| `src/static/index.js` | Starts sql.js and wires up storage, the sanitizer, and `.docx` import |
| `src/static/sanitize.js` | Browser sanitizer (DOMPurify) using the server's allow-list |
| `src/static/sqljs-db.js` | Adapter that gives sql.js the same API as `node:sqlite` |

### Shared: `shared/` (4)

| File | Purpose |
| --- | --- |
| `core.js` | Sessions, documents, sharing, authorization, and version checks |
| `schema.js` | SQLite schema and demo seed data |
| `content.js` | File conversion, the HTML allow-list, upload limits, title rules |
| `errors.js` | `HttpError`, an error type that carries an HTTP status |

### Server: `server/` (5)

| File | Purpose |
| --- | --- |
| `index.js` | Entry point: ports, database path, production mode |
| `app.js` | Express routes on top of `shared/core.js`: cookies, uploads, static files, errors |
| `db.js` | Opens the SQLite file with `node:sqlite` |
| `convert.js` | Server sanitizer (sanitize-html) and `.docx` conversion (mammoth) |
| `reset.js` | Deletes the local database (`npm run seed:reset`) |

### Tests and samples (5)

| File | Purpose |
| --- | --- |
| `tests/api.test.js` | 24 server API tests: auth, documents, sanitization, conflicts, sharing rules, import, persistence |
| `tests/static-backend.test.js` | 7 browser-backend tests: sharing rules, conflicts, persistence, syncing between tabs, import, reset |
| `samples/kickoff-memo.docx` | Word file with headings, bold, italic, underline, and lists |
| `samples/meeting-notes.md` | Markdown file with headings, lists, a quote, and inline code |
| `samples/plain-text.txt` | Plain-text file with paragraphs and line breaks |

### Configuration and deployment (6)

| File | Purpose |
| --- | --- |
| `package.json` | Dependencies and npm scripts, including `build:static` for the live demo |
| `package-lock.json` | Exact dependency versions, for reproducible installs |
| `vite.config.js` | Dev server, API proxy, build output, and the static build mode |
| `.github/workflows/pages.yml` | GitHub Actions: test, build the static edition, deploy to GitHub Pages |
| `render.yaml` | Optional Render Blueprint for hosting the server-backed edition |
| `.gitignore` | Excludes generated files (see below) |

## 4. Not included, by design

| Item | Why it isn't in the repository | How it is created |
| --- | --- | --- |
| `node_modules/` | Installed dependencies | `npm install` |
| `dist/` | Build output | `npm run build`, or `npm run build:static`; GitHub Actions builds the live demo |
| `data/inkwell.db` | Local database containing user data | Created and seeded automatically on first start |
| Environment or secrets files | None are needed. All configuration is optional; see *Change the ports or the database location* in the README | — |

## 5. How to evaluate (about 5 minutes)

**Option A: the live demo.** No setup needed.

1. Open https://sujaychandrakoyyalamudi.github.io/inkwell-docs/ and sign in as **Alice**.
2. Open *Welcome to Inkwell*, format some text, rename the document, and refresh the page.
3. Click **Share**, add **Carol** as a **Viewer**, then switch to Carol from the avatar menu to see the
   read-only view.
4. Back on the dashboard, import `samples/kickoff-memo.docx`.

**Option B: run it locally** (server-backed; needs Node.js 22.13 or later).

```bash
git clone https://github.com/sujaychandrakoyyalamudi/inkwell-docs.git
cd inkwell-docs
npm install
npm test        # expect: 31 passing
npm run dev     # then open http://localhost:5173
```

Then follow the same steps. The README's *Walkthrough* section covers the full tour.

## 6. Known limitations

These are listed, with suggested next steps, in the README's *Limitations and roadmap* section and in
sections 5 and 6 of `ARCHITECTURE.md`. In short:

- no real-time co-editing (concurrent edits are detected and resolved instead);
- mock authentication;
- no version history;
- imports drop images and tables;
- no automated browser tests;
- the live demo keeps data in each visitor's browser.
