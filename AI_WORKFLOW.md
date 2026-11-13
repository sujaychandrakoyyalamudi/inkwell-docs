# AI workflow note

This note describes how I used an AI coding agent to build Inkwell: what I delegated, how the work was
checked, and which decisions stayed with me. The whole project, from an empty folder to a documented
GitHub repository, took about an hour.

## 1. Setup

The agent worked directly in the project folder. It could read and write files, run shell commands such
as `npm`, the test suite, and `git`, and control a browser to use the running app.

I gave it the requirements, answered its questions, and approved every step that leaves my machine:
creating the GitHub repository, every commit, and every push.

## 2. Workflow

| Phase | What happened |
| --- | --- |
| **Requirements** | I pasted the four requirement areas (editing, file upload, sharing, persistence) word for word. |
| **Plan** | The agent checked the environment first. Node 26 has SQLite built in, so it chose a stack with no native modules, and it broke the work into a visible task list. |
| **Backend** | It wrote the schema, the API, and the file converters, then tested the endpoints with `curl` before building any UI. |
| **Frontend** | It built the React and TipTap client: dashboard, editor, toolbar, share dialog, and account switching. |
| **Automated tests** | It wrote 24 API tests covering authentication, permissions, sanitization, conflicts, imports, and persistence, and ran them after every change. |
| **Browser testing** | It used the real app in a browser: typing and formatting, renaming, reloading to check persistence, sharing, switching users, view-only mode, live refresh, a deliberately forced edit conflict, importing a real `.docx` file, inserting a Markdown file, rejecting an unsupported file, and the mobile layout. |
| **Documentation** | Over several short follow-up requests: the README with screenshots, step-by-step setup instructions, the [architecture note](ARCHITECTURE.md), and this note. |

My follow-up prompts were short and outcome-focused, for example "a clear and professional README" or
"README with local setup and run instructions". The agent turned each into a plan, did the work, and
reported what it had verified.

## 3. What verification caught

Generating code was fast. Most of the value came from checking it, because several problems only showed
up when the app was actually run:

| Problem | How it was found | Fix |
| --- | --- | --- |
| The app hung on its loading screen | Browser test and server logs. The preview tool set `PORT=5173`, so the API took the same port as the dev server, and requests were forwarded back to the dev server in a loop | The API uses its own `API_PORT` variable in development |
| Choosing a heading from the style menu didn't apply it | After a browser test, the agent inspected the editor's HTML. The native `<select>` took focus away from the editor | Replaced it with a custom menu that never takes focus from the editor |
| On phones, the document title overlapped the Share button | Testing at a 375-pixel-wide viewport | Responsive CSS for the editor header |
| `npm start` failed on Windows | Found while writing the setup guide: `NODE_ENV=production node …` is not valid in Windows shells | A cross-platform `--production` flag |
| Filenames with non-ASCII characters would have been garbled on upload | Reading the upload library's source during implementation: it decodes filenames as Latin-1 by default | Configured the library to read filenames as UTF-8 |
| Underlines would have been dropped from imported Word files | The `.docx` converter ignores underline unless told otherwise | Mapped underline explicitly; an import test checks it |
| One test failed | The sanitizer writes `text-align: center` as `text-align:center` | The behavior is harmless, so the test was updated, not the code |

## 4. Guardrails I relied on

- **Run it; don't trust it.** Every feature was checked by the tests, in the browser, or both before it
  was called done.
- **Check library behavior against the installed code, not memory.** The agent confirmed details such as
  TipTap 3 export names, keyboard shortcuts, upload-library options, and icon names by reading the
  installed packages.
- **The server is the authority.** Permissions are enforced and tested on the API side; the UI only
  reflects them.
- **Check the documentation too.** The setup steps were run in a clean copy of the repository on separate
  ports. Keyboard shortcuts were checked against the editor library. The diagrams were rendered to
  confirm they display correctly.
- **No personal or leftover data in public artifacts.** The README screenshots were taken from a
  separate, freshly seeded instance of the app, not from my working database.
- **A person approves anything leaving the machine.** The repository is private, and nothing was
  committed or pushed without my explicit approval.

## 5. My decisions

These decisions were mine, not the agent's:

- the scope and the requirements;
- making the GitHub repository private;
- how the AI tooling is described in the project;
- which documentation to produce and when to publish each piece.

The agent proposed the technical choices: SQLite through Node's built-in module, storing content as
HTML, and optimistic concurrency instead of real-time co-editing. I accepted them. The reasoning behind
each is in the [architecture note](ARCHITECTURE.md).

## 6. Reflections

- **Where AI helped most:** scaffolding, writing the test suite, and the repetitive work of using the app
  end to end after each change.
- **Where AI was wrong:** assumptions about the environment (the port clash), focus behavior in the
  browser (the style menu), and cross-platform shell syntax. Each was caught only because the agent ran
  the code instead of stopping at code that compiled.
- **What I would add next:** commit the browser checks as an automated end-to-end test suite (for
  example, Playwright), so that the manual checks described above run on every change.
