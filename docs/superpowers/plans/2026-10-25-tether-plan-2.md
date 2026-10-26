# Tether, Plan 2: Tether.app (Electron)

**Spec:** `docs/superpowers/specs/2026-10-25-tether-app-design.md` §4 (process model, PATH, projects), §7 (Mac integration),
§8 (packaging), §9 (Electron tests). **Builds on:** Plan 1 (the web app with the sidebar, Code screen and Welcome).
**Goal:** `npm run app` builds `dist-app/Tether-darwin-arm64/Tether.app` (ad-hoc signed). Double-clicking it starts the
server in-process on a random loopback port and opens one window. Everything else is the web app, which feature-detects
`window.tether`.

## Spike result (§4.1)

- Electron 34.5.8 bundles Node 20.19.1: `node:sqlite` is missing (`ERR_UNKNOWN_BUILTIN_MODULE`).
- Electron 35.7.5 bundles Node 22.16.0: `node:sqlite` runs without a flag (ExperimentalWarning only), and `Store.open()`
  on a file database works.
- Plan 2 first pinned `electron@35.7.5`, the lowest qualifying release. No sidecar is needed.
- **Pin now: `electron@45.0.0`, the current stable release** (bumped after review: 35 is out of support and gets no
  security patches). The same spike on 45.0.0 shows Node 24.22.0 with `node:sqlite` unflagged and `Store.open()`
  working; the boot test and the packaged app's smoke launch pass.
- Every major from 35 up bundles Node 22+ with `node:sqlite`, so later bumps need only the spike, the boot test and
  `npm run app` again.
- Electron 45 downloads its binary on first use (`npx install-electron`), not at `npm install`.

## Global Constraints

- Plan 1's rules all hold: no data moves (`~/.aorch`), one path gate, the Studio Live rules, and `rules.test.ts` stays
  green.
- New dependencies: `electron` (pinned 45.0.0) and `@electron/packager`, both dev dependencies. Nothing else.
- The window runs with context isolation on, node integration off and the sandbox on. The preload exposes only
  `window.tether`. Navigation outside the server's origin is refused (http(s) links open in the browser).
- Tests never touch the real `~/.aorch`: the boot test sets `TETHER_HOME` to a temp folder. The owner's server on 4177
  is never touched.
- Commits: conventional, staged by explicit path, no trailers, no push.

## Interfaces

```ts
// src/serve.ts (shared by `tether serve` and the app)
openContext(flags: { home?; vault? }): Ctx            // moved from cli.ts: config, crew refresh, store, vault, engine
serveTether(o: { home?; host?; port?; webDir; examplesDir }): Promise<{ url; close(); cfg; stopLive() }>
// src/app/path.ts (pure)
loginPath(out: string): string | undefined            // reads the marker-wrapped PATH a login shell printed
mergePaths(login: string | undefined, current: string, home: string): string
// src/app/windowState.ts
loadBounds(home, displays): Bounds | undefined; saveBounds(home, bounds)
// src/app/preload.cts → window.tether (web/src/bridge.ts types it)
{ platform, openFolder(): Promise<string|undefined>, pathForFile(f: File): string, revealInFinder(path),
  setBadge(n), notify({ title, body?, route? }), onOpen(cb(path)), onRoute(cb(hash)), onCommand(cb('welcome')) }
```

The main process lives in `src/app/` (not `app/`). This lets it compile with the server into `dist/app/` and import
`../serve.js` with the same path in source and output. The preload is `.cts` because sandboxed preloads must be
CommonJS.

## Tasks

### 1. Shared serve entry
- Files: `src/serve.ts`, `src/cli.ts` (the `serve` command and `open()` use it).
- Tests: the existing server/CLI suites stay green.

### 2. Main process, preload, PATH merge, window state
- Files: `src/app/main.ts`, `src/app/preload.cts`, `src/app/path.ts`, `src/app/windowState.ts`, and `package.json`
  (`main`, `electron` dev dependency).
- Behaviour:
  - Single-instance lock.
  - Login-shell PATH merge (3 s timeout, fallback dirs).
  - `serveTether({ port: 0 })`.
  - The window: `hiddenInset` title bar, min 960×640, bounds kept in `<home>/app-window.json`, background colour from
    the OS theme.
  - Navigation guard and window-open handler.
  - `will-prevent-unload` asks before unsaved work is dropped.
  - Quit stops live runs and closes the server.
  - `open-file` (Dock drop, `open -a Tether <dir>`) is queued until the page is ready.
  - Smoke mode (`TETHER_SMOKE=1`): load the page, fetch `/api/runs`, print one JSON line, quit.
- Tests:
  - `test/app-path.test.ts` (marker parsing, merge order, dedupe, fallback dirs).
  - `test/app-window.test.ts` (bounds validated against displays, min size, garbage file).
  - `test/app-smoke.test.ts` (darwin with Electron installed: builds the server, boots Electron with a temp home,
    expects the page loaded, `/api/runs` 200, sqlite ok).

### 3. Menus, Dock badge, notifications (main side)
- Files: `src/app/menu.ts`.
  - Tether: About, Settings ⌘, (route), Hide, Quit.
  - File: Open Folder… ⌘O (native dialog → `tether:open`), Open Recent (from the registry; rebuilt when
    `workspaces.json` changes), Welcome, Close Window.
  - Edit, View (Reload, Full Screen, Actual Size / Zoom), Window.
  - Help: Report an issue (opens the repo's issues).
- Badge via `app.dock.setBadge`.
- Notifications via `Notification`; a click focuses the window and sends the route.

### 4. The web side of the bridge
- Files: `web/src/bridge.ts`, `web/src/main.tsx` (`tether-app` class on `<html>`), `App.tsx`, `projects/*`,
  `welcome/Welcome.tsx`, `ui/studio/Sidebar.tsx` and `shell.css`, `SettingsDrawer.tsx`, `web/src/useAppSignals.ts`.
- Behaviour:
  - Projects + and ⌘O use the native folder dialog.
  - Welcome shows the approved drop zone and an "Open folder… ⌘O" button.
  - A folder dropped anywhere on the window opens it.
  - The sidebar's ⋯ gains "Reveal in Finder".
  - Open events (menu, Dock, `open -a`) register the folder and switch to Code.
  - The Dock badge shows the attention count.
  - Notifications fire for new needs-you items and finished runs, never on the first poll, with an off switch in
    Settings (`aorch.notify`).
  - File → Welcome reopens the Welcome screen.
  - In the app, the sidebar's logo row sits below the traffic lights, and that strip drags the window.
- Tests: `bridge.test.tsx` (feature detection, a browser falls back), `useAppSignals.test.tsx` (badge, notification
  diffs, off switch), plus App, Welcome and Sidebar additions.

### 5. Packaging and dev
- Files: `scripts/package-app.mjs` (`@electron/packager`, arm64, `assets/brand/tether.icns`, `dev.tether.app`,
  folder document type, prune, `codesign --force --deep --sign -`), `scripts/app-dev.mjs` (Vite + Electron on a free
  port), `web/vite.config.ts` (proxy target from `TETHER_API`), `package.json` scripts `app` and `app:dev`,
  `.gitignore` (`dist-app`), README note (right-click → Open on first launch).
- Smoke: build with `npm run app`, launch once, check the window loads and `/api/runs` answers, then quit.
