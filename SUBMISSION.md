# Submission

**Project:** Inkwell, a collaborative document editor
**Repository:** https://github.com/sujaychandrakoyyalamudi/inkwell-docs (branch `main`)

This file lists exactly what this submission includes, where each requirement is implemented, and what is
intentionally left out.

---

## 1. Deliverables

| # | Deliverable | Location |
| --- | --- | --- |
| 1 | A working full-stack application (React client, Node.js/Express API, SQLite storage) | [`client/`](client), [`server/`](server) |
| 2 | README with local setup and run instructions | [`README.md`](README.md): *Quick start*, *Local setup*, *Running the app*, and *Troubleshooting* sections |
| 3 | Architecture note | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 4 | AI workflow note | [`AI_WORKFLOW.md`](AI_WORKFLOW.md) |
| 5 | Automated tests (24 API tests) | [`tests/api.test.js`](tests/api.test.js), run with `npm test` |
| 6 | Sample files for trying the upload feature | [`samples/`](samples): one each of `.docx`, `.md`, and `.txt` |
| 7 | Screenshots of the running app | [`docs/screenshots/`](docs/screenshots) |
| 8 | This submission summary | [`SUBMISSION.md`](SUBMISSION.md) |

## 2. Requirements coverage

All four required areas are implemented.

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
| Upload a file into the product workflow | Dashboard → **Import file**, or drag a file onto the dashboard: the file becomes a new editable document | `Dashboard.jsx`, `POST /api/documents/import`, `server/convert.js` |
| Import into an existing draft | Editor toolbar → **Insert file** puts the content at the cursor | `Toolbar.jsx`, `POST /api/convert` |
| Supported types stated in the UI and README | The dashboard hint and the Insert file tooltip read ".txt, .md or .docx (max 5 MB)"; the README has a *File import* section | `client/src/lib.js` (`ACCEPTED_LABEL`), `README.md` |

### 2.3 Sharing

| Requirement | Where to see it | Implemented in |
| --- | --- | --- |
| A document owner | "Owned by …" under the title; an *Owner* badge | `documents.owner_id` in `server/db.js` |
| Grant access to another user | Editor → **Share**, then add by email as Editor or Viewer; roles can be changed or access revoked | `ShareDialog.jsx`, `POST` and `DELETE /api/documents/:id/shares` |
| Visible distinction between owned and shared documents | Dashboard sections *Owned by me* and *Shared with me*, plus role badges | `Dashboard.jsx` |
| Simulated users | Three seeded demo accounts, mock sign-in, and real server-side sessions; switch users from the avatar menu | `server/db.js`, `Login.jsx`, `AccountMenu.jsx` |

### 2.4 Persistence

| Requirement | How it is met | Implemented in |
| --- | --- | --- |
| Documents survive a refresh | Stored in a SQLite file, `data/inkwell.db` | `server/db.js` |
| Formatting is preserved | Content is stored as sanitized HTML, the editor's native format | `server/convert.js` (`sanitizeContent`) |
| Shared access can be demonstrated | Seed data includes one document shared as editor and one as viewer, and shares are stored in the `document_shares` table | `server/db.js` |

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

## 3. File manifest

The repository contains exactly these 35 files.

### Documentation (8)

| File | Purpose |
| --- | --- |
| `README.md` | Overview, setup and run instructions, troubleshooting, features, API reference |
| `ARCHITECTURE.md` | Architecture note: components, data model, key flows, security, trade-offs |
| `AI_WORKFLOW.md` | AI workflow note: how the project was built and verified |
| `SUBMISSION.md` | This file |
| `docs/screenshots/dashboard.png` | Screenshot: dashboard with owned and shared sections |
| `docs/screenshots/editor.png` | Screenshot: editor with toolbar |
| `docs/screenshots/share-dialog.png` | Screenshot: share dialog |
| `docs/screenshots/view-only.png` | Screenshot: a viewer's read-only page |

### Client: `client/` (13)

| File | Purpose |
| --- | --- |
| `index.html` | HTML entry point |
| `src/main.jsx` | React root and toast notifications |
| `src/App.jsx` | Session check and routing |
| `src/api.js` | REST API client |
| `src/lib.js` | Hash router, date helpers, accepted file types |
| `src/styles.css` | All styles, including the responsive layout |
| `src/components/Login.jsx` | Demo account sign-in |
| `src/components/Dashboard.jsx` | Owned and shared document lists, create, import, drag-and-drop |
| `src/components/EditorPage.jsx` | Editor, autosave, conflict handling, live refresh |
| `src/components/Toolbar.jsx` | Formatting toolbar, style menu, insert from file |
| `src/components/ShareDialog.jsx` | Grant, change, and revoke access |
| `src/components/AccountMenu.jsx` | Switch demo user, sign out |
| `src/components/ui.jsx` | Avatar, badges, modal, toasts |

### Server: `server/` (5)

| File | Purpose |
| --- | --- |
| `index.js` | Entry point: ports, database path, production mode |
| `app.js` | Express app: authentication, documents, sharing, import, error handling |
| `db.js` | SQLite schema and seed data |
| `convert.js` | `.docx`, `.md`, and `.txt` conversion to HTML, and the HTML sanitizer |
| `reset.js` | Deletes the local database (`npm run seed:reset`) |

### Tests and samples (4)

| File | Purpose |
| --- | --- |
| `tests/api.test.js` | 24 API tests: auth, documents, sanitization, conflicts, sharing rules, import, persistence |
| `samples/kickoff-memo.docx` | Word file with headings, bold, italic, underline, and lists |
| `samples/meeting-notes.md` | Markdown file with headings, lists, a quote, and inline code |
| `samples/plain-text.txt` | Plain-text file with paragraphs and line breaks |

### Configuration (5)

| File | Purpose |
| --- | --- |
| `package.json` | Dependencies and npm scripts (`dev`, `build`, `start`, `test`, `seed:reset`) |
| `package-lock.json` | Exact dependency versions, for reproducible installs |
| `vite.config.js` | Dev server, API proxy, build output |
| `render.yaml` | Render Blueprint for the hosted deployment: build and start commands, health check, Node version |
| `.gitignore` | Excludes generated files (see below) |

## 4. Not included, by design

| Item | Why it isn't in the repository | How it is created |
| --- | --- | --- |
| `node_modules/` | Installed dependencies | `npm install` |
| `dist/` | Production build output | `npm run build` |
| `data/inkwell.db` | Local database containing user data | Created and seeded automatically on first start |
| Environment or secrets files | None are needed. All configuration is optional; see *Change the ports or the database location* in the README | — |
| A hosted deployment | The app is meant to run locally with the steps below | — |

## 5. How to evaluate (about 5 minutes)

```bash
git clone https://github.com/sujaychandrakoyyalamudi/inkwell-docs.git
cd inkwell-docs
npm install
npm test        # expect: 24 passing
npm run dev     # then open http://localhost:5173
```

This needs Node.js 22.13 or later. Then:

1. Sign in as **Alice**. Open *Welcome to Inkwell*, then format text, rename the document, and refresh
   the page.
2. Click **Share**, add **Carol** as a **Viewer**, then switch to Carol from the avatar menu to see the
   read-only view.
3. On the dashboard, import `samples/kickoff-memo.docx`.

The README's *Walkthrough* section covers the full tour.

## 6. Known limitations

These are listed, with suggested next steps, in the README's *Limitations and roadmap* section and in
sections 5 and 6 of `ARCHITECTURE.md`. In short:

- no real-time co-editing (concurrent edits are detected and resolved instead);
- mock authentication;
- no version history;
- imports drop images and tables;
- no automated browser tests.
