# Tether — the Mac app, the Code screen and the rename

Date: 2026-10-25 · Branch: `feature/tether-app` (from `main` @ e1f8ce2) · Status: draft for owner review

## 1. Intent

The owner wants aorch packaged as a real Mac app they open on their own projects, with each project's code visible —
and editable — next to the runs that change it. The app is renamed **Tether**: agents work freely, tethered to your
plan and to you.

What the owner said and approved:

- A **Mac desktop app** (not a browser tab), for **this Mac only** — ad-hoc signed, no Apple Developer account.
- A **Code screen** with all four parts: file tree + viewer, changes by runs, search, and editing.
- The **name Tether** (backup: Mycelium) and the **Gapped Triad** mark on a **plain Graphite tile**; assets already
  generated in `assets/brand/` (commit 79749a8).
- The mockups on canvas `KbHFdsb4mTdaUnhEffaxY4`, row "App": **AppWelcome** (first launch) and **AppCode** (Code
  screen + project switcher), approved 2026-10-25.

Success: double-click Tether.app, open any folder, see its code with git status, read and edit files, see which runs
touched which lines, start runs — all in one window, with the restyled UI and no terminal needed.

Assumptions (owner may correct): Apple Silicon only; no auto-update; the browser dashboard (`tether serve`) keeps
working exactly as today; the TUI is unchanged apart from its name.

## 2. Delivery: two plans

The Code screen is useful in the browser too, so it ships first; the Electron shell wraps a finished web app.

- **Plan 1 — Rename + Code screen** (works in `tether serve` and later inside the app): the rename (§3), the server
  code routes (§5), the Code screen (§6), the first-launch screen inside the web app (§7.1).
- **Plan 2 — Tether.app**: the Electron shell (§4), Mac integration (§7), packaging (§8).

Each plan follows the usual flow: plan → subagent-driven build with per-batch reviews → final review → PR.

## 3. The rename

| Thing | Today | After |
|---|---|---|
| CLI command | `aorch` | `tether` — `aorch` stays as a second `bin` alias, forever |
| npm package name | `agent-orchestrator` | `tether` (private; not published) |
| Home directory | `~/.aorch` | **unchanged** (`~/.aorch`). `TETHER_HOME` is read first, then `AORCH_HOME` |
| Per-repo folder | `<repo>/.aorch/` | **unchanged** — renaming it would orphan saved requests and workspace notes |
| UI strings | "aorch" | "Tether" — window titles, rail mark, ⌘K, Settings → About, empty states, TUI header |
| Rail mark | "ao" text tile | the Triad glyph (`tether-glyph-dark/light.svg`, by theme) |
| Favicon / PWA icon | none / default | `tether-icon.svg` |
| Repo on GitHub | `tusharcora/aorch` | unchanged for now (owner can rename later; GitHub redirects) |

Rule: no data moves and nothing breaks for an existing install. Tests assert both `tether` and `aorch` bins point at
the same entry, and that `TETHER_HOME` beats `AORCH_HOME` beats `~/.aorch`.

## 4. Tether.app (Electron)

### 4.1 Process model

- **Main process** (`app/main.ts`): starts the existing server **in-process** with `startServer({ port: 0, host:
  '127.0.0.1' })` — a random free loopback port, the same Host/Origin guards, the same `~/.aorch` home — then opens one
  `BrowserWindow` on the returned URL. No second Node, no port 4177, so a running `tether serve` never clashes.
- **Window**: `titleBarStyle: 'hiddenInset'` with the traffic lights over the rail's top; min 960×640; size and
  position remembered in `~/.aorch/app-window.json`.
- **Preload** (`app/preload.ts`): exposes a tiny `window.tether` bridge — `openFolder()`, `revealInFinder(path)`,
  `setBadge(n)`, `notify({title, body, route})`, `platform`. Context isolation on, node integration off, sandbox on.
  The web app feature-detects `window.tether`; in a plain browser every call falls back (e.g. Open folder → the
  existing path input).
- **Node version gate**: the server needs Node ≥ 22.12 with `node:sqlite` unflagged. Plan 2 starts with a spike that
  pins the lowest Electron whose bundled Node meets that, and a boot test that opens the store inside Electron. If no
  shipped Electron qualifies, the fallback is a bundled Node 22 sidecar binary started by the main process (same
  `startServer` entry, child process, stdout handshake for the port).

### 4.2 Finding the agent CLIs

GUI apps on macOS don't inherit the shell PATH. On launch the main process runs the user's login shell once
(`$SHELL -ilc 'printf %s "$PATH"'`, 3 s timeout) and merges it into `process.env.PATH` before starting the server.
On failure it falls back to `/opt/homebrew/bin:/usr/local/bin:~/.local/bin:~/.npm-global/bin` plus the current PATH.
The first-launch screen and Settings show which agent CLIs were found (`claude`, `codex`, `gemini`, …) and whether
`rg` (ripgrep) is available for search — green dot = found with version, grey = "not found on PATH".

### 4.3 Projects

- **File → Open Folder… (⌘O)**, dragging a folder onto the window or the Dock icon, and `open -a Tether <dir>` all
  register the folder as a workspace through the existing registry (`addWorkspace`) and switch to it.
- The **project switcher** (rail top, the approved popover): recent projects, a blue dot where a run is live, Open
  folder… at the bottom. The current project drives Home, Code, Runs filters and the API tab's workspace.
- File → Open Recent mirrors the switcher.

## 5. Server: code routes

All under `/api/code/*`, inside the existing guarded handler (loopback, Host, Origin, JSON errors). Every route takes
`ws=<workspace id>`; the id is looked up in the registry, never used as a path.

| Route | Does |
|---|---|
| `GET /api/code/tree?ws&dir=` | One directory level: `{ entries: [{ name, path, kind: 'dir'|'file', git?: 'M'|'A'|'D'|'?'|'R' }] }`. Respects `.gitignore` (via `git ls-files --others --exclude-standard` + tracked files), hides `.git`, sorts dirs first. Lazy — the client asks per folder. |
| `GET /api/code/file?ws&path=` | `{ path, text, size, mtimeMs, lang, binary?, tooLarge?, secret?, readOnly? }`. Max 2 MB of text; binaries detected by a NUL byte in the first 8 KB. |
| `PUT /api/code/file` | `{ ws, path, text, baseMtimeMs }` → writes atomically (temp file in the same dir + rename). 409 `changed-on-disk` if `mtimeMs` moved since `baseMtimeMs`; 423 `run-writing` if a live run's worktree is this checkout and its current step is a write step; 403 for `readOnly`/`secret`. |
| `GET /api/code/search?ws&q=&mode=name|text` | Names: fuzzy over the tracked file list. Text: `rg --json --max-count 200 --max-filesize 2M` when `rg` exists, else a Node fallback walking tracked files (stops at 200 hits or 2 s). Never searches `.env*`. |
| `GET /api/code/runs-for-file?ws&path=` | Runs whose changes touch this file: `[{ runId, title, status, live, at, add, del, hunks: [{ start, lines }] }]`, newest first, max 20. Built from each run's recorded commits (`git diff --numstat` / `-U0` between the run's base and its last commit), cached per run once the run is finished. |
| `GET /api/code/changed?ws` | Paths touched by any run in the last 30 days → drives the "Changed by runs" filter and tree dots. |

**Path safety (one helper, `resolveInWorkspace(ws, rel)`)**: resolve against the workspace root, then `realpath`; refuse
anything outside the root (`..`, absolute paths, symlinks that escape), anything inside `.git`, and NUL bytes. Tests
cover each refusal.

**Secrets**: files matching `.env`, `.env.*`, `*.pem`, `*.key`, `id_*` open read-only with a banner, are skipped by
search, and are never attached to an agent prompt automatically (the existing "send to agent" paths gain the same
filter).

## 6. The Code screen (web app)

A new rail item **Code** (`#/code`, `#/code/<path>`, `#/code/<path>:<line>`) in Studio Live, as approved in AppCode.

- **Header**: meta `<project path> · <n> files · <n> changed by runs`, h1 "Code", search field (⌘⇧F).
- **Tree** (left, 250 px): lazy folders, git badges (M amber, A green, D red, ? muted), filter **All files /
  Changed by runs**, keyboard: ↑/↓ move, →/← open/close, Enter opens. While searching, the tree area shows results
  grouped by file with the matched line, `path:line`; Enter / click opens the file at the line with a brief highlight.
- **Editor** (centre): **CodeMirror 6** (the one new web dependency family: `@codemirror/state`, `view`, `commands`,
  `search`, `language` + `lang-javascript`, `lang-json`, `lang-markdown`, `lang-css`, `lang-html`, `lang-python`), themed
  from Studio Live tokens in both themes (keywords ink 600, strings green, numbers amber, comments muted italic — no
  purple). Tabs with a dirty dot; **View / Edit** toggle (read-only by default); **Save** (ink primary, ⌘S) disabled when
  clean. Conflict on save → a dialog: *Reload* (discard mine) / *Overwrite* (resend without the base check) / *Cancel*.
  Run-writing lock → the approved amber banner "Bolt is editing this file in run r-0144. Saving is paused…" with
  *Open run*. Too large / binary / secret → a clear panel instead of the editor.
- **Changed by runs** (right, 280 px): the runs that touched this file (status dot, title, meta, `+add −del`). Selecting
  one marks its changed lines with a green gutter + tint in the editor and shows a mini diff; selecting again clears it.
  "Open run" jumps to `#/runs/<id>`.
- **Links in**: the run page's diff file names and the Graph reader's file notes open the file in Code; ⌘K gains a
  **Files** group (name search).
- **Unsaved work**: leaving Code, switching project or closing a dirty tab asks first (the existing leave-guard
  mechanism); the Electron window close does the same.
- **States**: loading through `Loading`; every panel has its own `InlineError` with Retry; empty project → "This folder
  is empty"; not a git repo → tree works, git badges and runs lens are hidden with a one-line note.
- **Phone width**: tree and runs lens become drawers; editing works.

## 7. Mac integration (Plan 2)

1. **First launch** (no workspaces yet): the approved AppWelcome screen — drop zone, *Open folder… ⌘O*, Recent, and
   the agent-tools strip (§4.2). Also reachable as File → Welcome. In a browser the same screen offers the path input.
2. **Menu bar**: Tether (About, Settings ⌘,, Quit), File (Open Folder ⌘O, Open Recent, Close Window), Edit (standard),
   View (Reload, Toggle Full Screen, Actual Size / Zoom), Window, Help (Report an issue → repo issues URL).
3. **Dock badge** = the attention count (`/api/attention` length), updated by the web app through `setBadge`.
4. **Notifications** when a run needs you or finishes (Notification API through the bridge); clicking one focuses the
   window and routes to the run. Off switch in Settings.
5. **Menu-bar glyph** (optional extra, behind a Settings toggle, default off): the Triad template image with a count and
   a menu of items that need you.
6. **Quit** stops the in-process server cleanly; live runs keep their state (they are durable today) and resume as
   now.

## 8. Packaging (Plan 2)

- `npm run app` → builds the web app and server, then packages `Tether.app` (arm64) into `dist-app/` with
  `@electron/packager` (dev dependency), using `assets/brand/tether.icns`, bundle id `dev.tether.app`.
- Ad-hoc signing (`codesign --force --deep --sign -`); README note: first launch is right-click → Open.
- `npm run app:dev` → Electron against the Vite dev server for UI work.
- New dependencies: `electron` and `@electron/packager` (dev), CodeMirror 6 packages (web). Nothing else.

## 9. Testing

- **Node**: path-safety refusals; tree respects `.gitignore` and hides `.git`; file read limits (2 MB, binary,
  secret); save atomicity, 409 changed-on-disk, 423 run-writing, 403 secret; search with and without `rg` (forced
  fallback); runs-for-file from fixture repos with recorded commits; rename (`tether`/`aorch` bins, home precedence).
- **Web**: Code screen tree/keyboard, open/edit/save flow, conflict dialog, lock banner, runs lens gutter, search →
  open at line, leave guard, deep links, ⌘K Files; first-launch screen; `rules.test.ts` stays green (no purple,
  gradient or glow; the CodeMirror theme is tokens only).
- **Electron**: boot smoke test (main starts the server on a random port, window loads, `/api/runs` answers),
  PATH-merge unit test, bridge feature-detection test in the web app.
- **Manual**: Chrome check of the Code screen in both themes; on this Mac, build the app, open two real projects,
  edit + save, start a run and watch the badge and notification.

## 10. Out of scope

Windows/Linux builds; Intel Macs; notarization and auto-update; a terminal pane; git commit/push from the Code screen;
multi-cursor collaboration; LSP features (go-to-definition, diagnostics); renaming the per-repo `.aorch/` folder or
the GitHub repo.

## 11. Risks

- **Electron's Node vs `node:sqlite`** — handled by the Plan 2 spike and the sidecar fallback (§4.1).
- **Editing files agents are also editing** — the 423 lock covers runs in the main checkout; runs in their own
  worktrees don't conflict (they edit a different directory), and the runs lens shows their changes after the fact.
- **Large repos** — lazy tree, capped search, 2 MB file cap, per-run cache for runs-for-file.
- **Name clash** — "Tether" is also the USDT company; flagged to the owner, accepted.
