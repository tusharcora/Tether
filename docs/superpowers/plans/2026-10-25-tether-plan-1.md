# Tether, Plan 1: rename, sidebar, Code screen, first launch

**Spec:** `docs/superpowers/specs/2026-10-25-tether-app-design.md` (§2 Plan 1 = §3, §5, §6, §6.1, §7.1).
**Boards:** `docs/design/AppSidebar.dc.html`, `docs/design/AppCode.dc.html` (its rail popover is replaced by the sidebar's
Projects section), `docs/design/AppWelcome.dc.html`.
**Goal:** `tether serve` shows the Tether-branded dashboard with the expandable sidebar, a Code screen (tree, viewer/editor,
changes by runs, search) and a first-launch screen. Plan 2 wraps this in Electron.

## Global Constraints

- The rename never moves data: `~/.aorch`, `<repo>/.aorch/`, localStorage keys (`aorch.*`) and run branches (`aorch/<id>`)
  stay. Home = `--home` › `TETHER_HOME` › `AORCH_HOME` › `~/.aorch`. `aorch` stays a bin alias of `tether`.
- Every `/api/code/*` path goes through one `resolveInWorkspace(root, rel)`: refuses NUL, absolute, `..`, `.git` and
  symlinks that escape. `ws` is a registry id, never a path.
- Secrets (`.env`, `.env.*`, `*.pem`, `*.key`, `id_*`) open read-only, are skipped by search, never sent to agents.
- Saves are atomic (temp file in the same folder + rename): 409 `changed-on-disk`, 423 `run-writing`, 403 secret.
- Studio Live: no purple/indigo, no gradient or glow, ink primary buttons, blue live / amber needs you / green done /
  red failed, motion 150–280 ms (loops only for live state, reduced motion respected), both themes AA, CodeMirror theme
  from tokens only. `web/src/rules.test.ts` stays green; its allow-list never grows (new surface tokens are added to its
  contrast checks).
- New dependencies: CodeMirror 6 only (`@codemirror/state view commands search language lang-javascript lang-json
  lang-markdown lang-css lang-html lang-python`, plus `@lezer/highlight`, CodeMirror's own highlight-tag package, needed
  for the token theme). Dev dependencies, like the rest of the web stack.
- Tests never touch the real `~/.aorch` (temp homes). Commits: conventional, by explicit path, no trailers, no push.
- Checks: `npx vitest run --project web|node <file>`, full suites, `npm run typecheck`, `npm run build`. Known: 3 triggers
  failures (`/private/var` vs `/var`); flaky under load: evolve "compose keeps the edit that wins", team/handoff timing,
  web hooks Back/Forward timing.

## Interfaces (shared across tasks)

```ts
// src/code.ts
resolveInWorkspace(root: string, rel: string): { abs: string; rel: string }       // throws HttpError 400/403/404
isSecretPath(rel: string): boolean
langOf(rel: string): CodeLang  // 'typescript'|'tsx'|'javascript'|'jsx'|'json'|'markdown'|'css'|'html'|'python'|'text'
gitInfo(root): Promise<{ git: boolean; prefix: string }>   // prefix = root relative to the repo top ('' or 'sub/')
listDir(root, dir): Promise<{ entries: TreeEntry[]; git: boolean; files?: number }>
readCode(root, rel): CodeFile   // { path, text, size, mtimeMs, lang, binary?, tooLarge?, secret?, readOnly? }
saveCode(root, rel, text, baseMtimeMs?): { mtimeMs: number; size: number }
// src/codeSearch.ts
rgVersion(): string | undefined
searchNames(root, q): Promise<{ hits: { path }[] }>
searchText(root, q, o?: { rg?: string | null }): Promise<{ hits: { path, line, col, text }[]; truncated: boolean }>
// src/codeRuns.ts
runsForFile({ store, root, rel, live }): Promise<RunTouch[]>  // RunTouch = { runId, title, label, status, live, at, add, del, hunks: {start, lines}[], patch }
changedByRuns({ store, root, days? }): Promise<string[]>
writingRun({ store, root, live }): { runId, node, bot } | undefined
// src/codeRoutes.ts — codeRoute(ctx, req, res, url): Promise<boolean>, mounted for /api/code/* in server.ts
// src/pins.ts — Pin = { kind: 'run'|'request', id, label, ws? }; loadPins(home), savePins(home, pins)
```

Web: `Screen` gains `'code'`; `Route` gains `line?: number`; `#/code/<seg>/<seg>:<line>` (segments encoded one by one).
`useProjects()` (`web/src/projects.ts`) = workspaces poll + current id (kept in `aorch.api.ws`, shared with Home and the
API tab) + `add(path)` / `remove(id)`. `usePins()` (`web/src/pins.ts`).

## Tasks

### 1. Rename: CLI, package, home precedence
Files: `package.json` (name `tether`, bins `tether` + `aorch` → `dist/cli.js`, `npm run tether`), `src/config.ts`
(`resolveHome`), `src/cli.ts` (help title, usage lines, global-flags line), `src/tui.ts` (header, hints), `src/server.ts`
(plain-text "API is running" line).
Tests (`test/rename.test.ts`): both bins name the same entry; `--home` › `TETHER_HOME` › `AORCH_HOME` › `~/.aorch`.

### 2. Rename: web strings and brand
Files: `web/index.html` (title Tether, favicon `tether-icon.svg`), `web/src/ui/studio/Glyph.tsx` (dark/light Triad glyph
swapped by `data-theme`, imported from `assets/brand/`), `SettingsDrawer.tsx` (copy + About group), `home/workspaces.ts`
(`tether workspace init`), command hints in Triggers/Evolve/RunList/WebhookSetup/WorkspaceDialog/RequestGateFields.
Tests: Settings shows About with Tether and the `aorch` alias; updated copy assertions; Glyph renders both sources.

### 3. Server: register/remove projects, pins, tools
Files: `src/server.ts` (`POST /api/workspaces {path}` → `initWorkspace(…, { write: false })`, `DELETE
/api/workspaces/:id` → `removeWorkspace`, `GET|PUT /api/pins`, `GET /api/tools` → `{ agents: [{id, ok, version}], rg }`),
`src/pins.ts`, `src/serverkit.ts` (`HttpError` gains optional `extra` merged into the JSON error body).
Tests (`test/projects-api.test.ts`): add (relative path 400, missing 400, aorch home 400, twice = same id, writes no
`.aorch/` files), remove (404 unknown), pins round-trip + validation (kind, length, max 50), tools shape.

### 4. Sidebar (replaces the rail) and the current project
Files: `web/src/ui/studio/Sidebar.tsx`, `SidebarSections.tsx` (Projects, Pinned: disclosure, `+`, `⋯` menu),
`shell.css` (sidebar rules replace rail rules; grid column `auto`), `web/src/studio.css` (`--side --side-hover
--side-card --card-shadow` in both themes), `nav.ts` (Code; `API client` long label), `hooks.ts` (`code` screen),
`web/src/projects.ts`, `web/src/pins.ts`, `web/src/projects/OpenFolderDialog.tsx` (path input; the browser's Open
folder…), `App.tsx` (sidebar, ⌘\ and ⌘, keys, project switch, `workspace`/`onWorkspace` to the API tab, `project` to Runs),
`http/ApiTab.tsx` (`workspace`, `onWorkspace`, `request`, `onOpenRequest` props), `runs/RunList.tsx` ("Only <project>"
switch). Delete `Rail.tsx` + `Rail.test.tsx`.
Behaviour: 300 px ↔ 76 px over 260 ms; choice remembered (`aorch.sidebar`) at ≥1200 px, starts collapsed below; bottom bar
under 900 px. Search field opens ⌘K. Counts: Home = attention (amber), Runs = live (blue); collapsed = dot. Tooltips when
collapsed (`role="tooltip"`, `aria-describedby`, Escape). Projects: rows = workspaces, current = card, live dot, `+` =
Open folder…, `⋯` = Remove from Tether. Pinned: `+` pins the current run or API request, `⋯` = unpin.
Tests: `Sidebar.test.tsx` (landmark, order, aria-current, counts/dots, toggle by button and ⌘\, persistence, tooltip +
Escape, sections aria-expanded, pin current, project switch/remove), `projects.test.ts`, `App.test.tsx` updates,
`rules.test.ts` contrast over the new surface tokens, `RunList` filter test.

### 5. Server: path safety, tree, file read
Files: `src/code.ts`, `src/codeRoutes.ts` (`GET /api/code/tree`, `GET /api/code/file`), mount in `src/server.ts`.
Tests (`test/code-fs.test.ts`): each refusal (NUL, absolute, `..`, `.git`, escaping symlink; an inner symlink is fine);
tree respects `.gitignore`, hides `.git`, dirs first, git badges M/A/D/?, non-git folder works without badges; read
limits (2 MB → tooLarge, NUL → binary, secret → readOnly), unknown ws 404.

### 6. Server: save and search
Files: `src/code.ts` (`saveCode`), `src/codeSearch.ts`, `src/codeRuns.ts` (`writingRun`), `src/codeRoutes.ts` (`PUT
/api/code/file`, `GET /api/code/search`).
Tests (`test/code-save-search.test.ts`): atomic save keeps mode and leaves no temp file; 409 when mtime moved (and no base
= overwrite); 403 secret; 423 when a live run's worktree is this checkout and its running step writes (synthetic run
events); names search fuzzy + skips secrets; text search with `rg` (skipped when absent) and forced Node fallback, both skip
`.env*` and cap at 200.

### 7. Server: runs-for-file and changed
Files: `src/codeRuns.ts` (`runsForFile`, `changedByRuns`, per-run numstat cache keyed by run + last commit),
`src/codeRoutes.ts` (`GET /api/code/runs-for-file`, `GET /api/code/changed`).
Tests (`test/code-runs.test.ts`): fixture repo + synthetic runs with recorded commits → newest first, add/del, hunks from
`-U0`, patch text, live flag, probes skipped, max 20; changed = paths from runs in the last 30 days.

### 8. Web: CodeMirror editor
Files: `package.json` (deps), `web/src/code/Editor.tsx` (CM6 view: language, read-only compartment, ⌘S, run-line marks
via line decorations + `gutterLineClass`, line flash + scroll), `web/src/code/cmTheme.ts` (tokens only), `langs.ts`.
Tests (`Editor.test.tsx`): renders text, read-only vs editable, onChange, ⌘S, run marks, flash line; `rules.test.ts`
covers `cmTheme.ts` (and a check that it holds no colour literal).

### 9. Web: Code screen
Files: `web/src/code/codeApi.ts`, `treeModel.ts` (pure: rows from loaded dirs, changed-paths tree, key moves),
`FileTree.tsx`, `SearchResults.tsx`, `RunsLens.tsx` (reuses `ui/Diff`), `Code.tsx`, `code.css`; `App.tsx` route.
Behaviour per spec §6: header meta, ⌘⇧F search, All/Changed filter, keyboard tree, tabs + dirty dot, View/Edit, Save
(⌘S, ink), conflict dialog (Reload/Overwrite/Cancel), lock banner + Open run, tooLarge/binary/secret panels, per-panel
`InlineError` + Retry, empty folder, non-git note, phone drawers, deep links `#/code/<path>:<line>`.
Tests (`Code.test.tsx`, `treeModel.test.ts`): tree + keys, open/edit/save, conflict paths, lock banner, lens marks + mini
diff + Open run, search → open at line, empty/non-git/secret states, close dirty tab asks, deep link.

### 10. Web: links in and the leave guard
Files: `App.tsx` (dirty per screen: Code and API; leaving, switching project or reload asks), `runs/FileBars.tsx` +
`Inspector.tsx` (file names open in Code), `graph/NoteReader.tsx` (file notes: Open in Code), `CommandMenu.tsx` (Files
group from name search), `components/arc/command-palette/command-palette.tsx` (optional `onQueryChange`).
Tests: App leave guard for Code + project switch; FileBars/NoteReader links; ⌘K Files group.

### 11. Web: first launch
Files: `web/src/welcome/Welcome.tsx`, `ToolsStrip.tsx`, `welcome.css`; `App.tsx` (shown when the project list loads
empty; "Continue without a project" hides it for the session); `SettingsDrawer.tsx` (Agent tools group).
Tests (`Welcome.test.tsx`): path input registers and lands on Code, errors inline, Recent hidden when empty, tools strip
found/not found, App shows Welcome only for an empty list.

### 12. Verify
Full web + node suites, typecheck, build; Chrome check on a temp-home server (both themes, sidebar, Code, Welcome).
