# Studio Live restyle of the aorch web app

Date: 2026-10-25 · Status: revised after written-spec review (28 findings, controller rulings applied)
Builds on: `docs/superpowers/specs/2026-10-24-workbench-core-api-design.md` (PR #3, branch `feature/workbench-core-api`)
Visual reference: canvas https://claude.ai/artifact/KbHFdsb4mTdaUnhEffaxY4, row "A+ · Studio Live" (Home, Runs, API client, component kit)

## Goal

Make the whole web dashboard look and feel like the approved Studio Live boards: a calm, working Home dashboard, an
ink + blue palette in a polished dark and light theme, live motion only where something is actually happening, and
ascii-reveal loading everywhere. People should enjoy using and looking at it; nothing should read as "vibecoded".

## What the owner decided

- One spec for the whole app. Builder, Graph, Crew and Triggers have no approved mockups yet: their Studio Live
  boards are made and approved **before** they are built. Home and Runs follow the approved boards.
- Navigation: a left icon rail (bottom bar on phones).
- Themes follow the OS setting; dark and light are both first-class and polished. A manual override stays available.
- Home's "Maestro would pick" preview uses the existing roster heuristic, with no model call.
- Standing rules: no purple or indigo, no glow or gradient decoration, primary actions are ink, colour carries meaning
  only (blue live/working, amber needs you, green done/pass, red failed), loading via ascii-reveal.

## Assumptions (stated, not decided by the owner)

- This is a restyle plus the new Home screen. Builder, Runs, Graph, Crew, Triggers and the Evolve drawer keep every
  current function and behaviour listed in this spec; nothing is removed.
- The terminal UI (TUI) is out of scope. Printing is out of scope.
- The branch `feature/studio-live-restyle` stacks on PR #3 because it reuses that PR's Studio Live foundation
  (`web/src/studio.css`, `web/src/components/Loading.tsx`, the API tab). PR #3 is treated as frozen: fixes to it are
  made on PR #3 first and merged up into this branch.
- Bot faces are exempt from the no-purple rule (controller ruling, reversible by the owner): faces are generated
  identity art, not UI accent, and shifting their hues would change every bot's look, including hues set in the face
  editor. Seeded and saved face colours render unchanged.

## Non-goals

- New product features beyond Home's sections, the activity feed and the roster preview. No new run kinds: Home
  starts only the runs `POST /api/runs` already supports.
- Changes to the TUI, CLI output, engine behaviour or run semantics.
- A component library rewrite; vendored Arc components stay and are restyled through tokens.

## Approach

One global switch (chosen over gradual per-screen `.studio` opt-in and over a new component library): Studio Live
tokens become the app-wide theme, a new shell replaces the tab strip, and each screen is rebuilt from a small set of
shared Studio parts. Screens without an approved board (Builder, Graph, Crew, Triggers, Evolve) get a parity pass at
the switch so they stay legible and on-rule until they are rebuilt. Old per-screen styles are deleted as each screen
moves over.

## 1. Foundation

### Tokens

The Studio Live tokens move from `.studio` in `web/src/studio.css` to the document root for both themes. These are the
exact values (unchanged from `web/src/studio.css`):

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#fbfbfa` | `#0a0a0b` |
| `--s1` | `#ffffff` | `#111113` |
| `--s2` | `#f4f4f5` | `#18181b` |
| `--s3` | `#e4e4e7` | `#26262b` |
| `--line` | `rgba(9, 9, 11, .08)` | `rgba(255, 255, 255, .07)` |
| `--line2` | `rgba(9, 9, 11, .16)` | `rgba(255, 255, 255, .14)` |
| `--ink` | `#09090b` | `#f4f4f5` |
| `--mut` | `#52525b` | `#a1a1aa` |
| `--acc` | `#2563eb` | `#2563eb` |
| `--accInk` | `#1d4ed8` | `#93c5fd` |
| `--accBg` | `#eff6ff` | `rgba(59, 130, 246, .15)` |
| `--ok` | `#047857` | `#34d399` |
| `--okBg` | `#ecfdf5` | `rgba(52, 211, 153, .12)` |
| `--warn` | `#a16207` | `#fbbf24` |
| `--warnBg` | `#fefce8` | `rgba(251, 191, 36, .12)` |
| `--bad` | `#b91c1c` | `#f87171` |
| `--badBg` | `#fef2f2` | `rgba(248, 113, 113, .12)` |

Shared in both themes: `--font-ui: 'Geist', ui-sans-serif, system-ui, sans-serif`;
`--font-code: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace`; `--ease: cubic-bezier(.2, .8, .2, 1)`;
`--t-fast: 150ms`, `--t-med: 200ms`, `--t-slow: 280ms`; radii 8 px (control), 10 px (panel), 12 px (surface).

**Text-safe accent (decision).** `--acc` is a fill and stroke colour only (live dots, progress fills, focus rings,
active marker, white text on an `--acc` fill). Dark `--acc` is 3.83:1 on `--bg` and fails 4.5:1 as text, so every
accent-coloured *text* uses `--accInk` in both themes (light 6.4:1, dark 11:1 on `--bg`). In the Arc bridge, `--accent`
stays `var(--acc)` and `--accent-strong` is `var(--accInk)`; Arc parts that paint text in `--accent` (JSON viewer
numbers, toast info text) are re-pointed to `--accent-strong` in a Studio override file.

### Cascade

Studio tokens and the Arc/aorch bridge (today's `.studio.studio` block) are declared under `:root:root` (light) and
`:root:root[data-theme="dark"]` (dark), so they outrank every palette and accent rule in
`web/src/components/arc/foundation.css` (up to specificity 0,3,0). The old aliases in `web/src/theme.css`
(`--bg: var(--background)` and the rest) are deleted in the same change; aorch's names (`--panel`, `--text`, `--muted`,
`--run`, `--done`, `--wait`, `--err`, `--queued`, `--grid`, …) point straight at Studio tokens, because a variable that
references another is resolved where it is declared. `.studio` remains as an alias during the migration and is
deleted at the end of Plan B. A test asserts the computed `--accent`, `--foreground`, `--control-on` and `--text` on
`document.documentElement` equal the Studio values in both themes.

### Theme selection

`web/src/theme.ts` stores `aorch.theme` ∈ `'system' | 'light' | 'dark'`; default and missing mean `'system'`. Under
`'system'` it listens to `matchMedia('(prefers-color-scheme: dark)')` changes and updates `data-theme` live (new
behaviour: today the OS setting is read once and never watched). Migration: a stored `'light'` or `'dark'` from the old
two-state switch is kept as the manual choice, and Settings shows it selected so the person can pick Match system.
`applyTheme` still runs before first render (`web/src/main.tsx`) so there is no flash. `data-accent="violet"` is no
longer set. Tests cover an OS change under `'system'`, no change under a manual pick, and storage being unavailable.

### No purple

The rule covers UI chrome, code highlighting, charts and faces:

- Arc's accent and control variables are re-pointed to Studio tokens globally (see Cascade), and `data-accent` is gone.
- Code-block token colours (hard-coded violet at oklch hue 285 in `code-block.module.css`) and the chart `--series-*`
  colours (series 2 is purple in `foundation.css`) are re-declared from the Studio palette in the Studio override file.
- `web/src/styles.css`: `.t-pipeline { --c: #a77bf3 }` and the `#6d5bd0` fallback on `.badge.s-team` are replaced with
  tokens.
- Faces are exempt (see Assumptions): `Face.tsx`, the face editor swatches/slider in `Crew.tsx` and the built-in looks
  in `src/crew.ts` keep their colours.
- A test scans `web/src/**/*.css`, `web/src/**/*.tsx` and `foundation.css` for violet hex values and oklch/hsl hues in
  260–320 and fails on any hit outside an explicit allow-list, which holds only the face colour sources above.

### Gradients and motion

- "No gradient decoration" means no gradient as a visible fill, border or text colour. Arc's functional mask-image
  fades and scroll-edge shadows are allowed (`tabs.module.css`, `segmented-control.module.css`, `timeline.module.css`,
  `json-viewer.module.css`, `sortable-data-table.module.css`). The token test bans `--arc-gradient*` resolving to a
  gradient, and `background*: *-gradient(` outside those Arc files.
- Motion: 150–280 ms with `--ease`. Loops only for live state (working step, breathing face, live clock, streaming
  caret, a live run's moving border). The reduced-motion rule moves from `.studio` to `:root` and stops every loop and
  transition; Blobatar's own `motion.css` rule stays.
- **Type.** Geist and Geist Mono (already self-hosted) apply app-wide; numbers use tabular figures.

### Loading

Every loading state goes through `web/src/components/Loading.tsx` (AsciiSkeleton + AsciiReveal); no
spinners-as-placeholders and no grey skeletons. Inline button busy states may keep Arc's button `loading` prop.

### Contrast

Both themes pass WCAG AA: 4.5:1 for text, 3:1 for UI glyphs and shapes. A contrast test checks these pairs in both
themes: `--ink` and `--mut` on `--bg`, `--s1`, `--s2`, `--s3`; `--accInk`, `--ok`, `--warn`, `--bad` on `--bg`, `--s1`
and on their own `*Bg`; white on `--acc`; `--acc` and `--line2` against `--bg` and `--s1` at 3:1. Faces always carry an
accessible name and a visible text label nearby; on light they sit on their squircle with a `--line2` hairline so the
shape reads at 3:1 against the surface (several identity colours, e.g. `#e3ab3a`, `#38c5d6`, `#3fb97c`, are 2.0–2.7:1
on light on their own).

### Shared Studio parts

In `web/src/ui/studio/`, each one file with its own test:

- `ScreenHeader` — mono meta line, title, summary, right-aligned actions.
- `SectionHeading` — title + count (mono) + optional action.
- `ListRow` — hairline row with leading marker/face, title, meta, trailing age and actions; hover state.
- `StatusChip` — label + dot; live states pulse; colour always paired with text; tinted `*Bg` fill with the status
  colour as text (replaces white-on-colour badges).
- `StepTrack` — segmented progress bar for a run's steps: done, working (stripes), waiting (pulse), queued; skipped
  steps are hairline segments; a team run before plan approval shows one "planning" segment.
- `FaceStack` — overlapping Blobatar faces with optional breathing for the working bot.
- `Panel` — bordered surface with optional header.
- `EmptyState` — wraps Arc's empty state with Studio copy and actions.
- `Kbd` — keyboard hint; shows ⌘ on Apple platforms and Ctrl elsewhere.

Screens use these instead of one-off markup.

### Parity pass (at the switch)

After the switch, the screens not yet rebuilt (Builder, Graph, Crew, Triggers, Evolve drawer, and the Team panel inside
Runs) stay legible and on-rule without being rebuilt: hand-built `button.primary` in `styles.css` paints ink (it paints
`--accent` today, which would turn blue); `.badge` and `.chip` take colours from tokens (today `.badge` is white text on
`--queued`, about 2.5:1 in dark); no hard-coded hex remains in `styles.css`; Runs' Arc `Skeleton` and the plain
"loading" text in Crew and Triggers go through `Loading.tsx`; every text pair passes the contrast test. Layouts stay as
they are (Builder keeps its three-column grid). Done when a Chrome pass of each old screen in both themes shows no
violet, no blue primary, no grey skeleton and no contrast failure.

## 2. Shell

- **Rail** (`web/src/ui/studio/Rail.tsx`, `role="navigation"`, active item `aria-current="page"`): the ⌘K search
  button at the top; Home, Runs, Builder, Crew, API, Graph, Triggers; Settings pinned at the bottom. Icon buttons with
  accessible names; a label tooltip appears 300 ms after hover or focus; arrow keys move focus (roving tabindex),
  Enter/Space activates, Home/End jump to first/last; the active item shows a 2 px `--acc` marker. The Runs item reopens
  the last viewed run (today's `lastRun` behaviour).
- **Bottom bar** under 900 px wide: Home, Runs, Builder, Crew, API and a "More" menu holding Graph, Triggers and
  Settings.
- **Settings** is a right-hand Drawer (route `#/settings`) opened over the screen that was showing, which stays
  mounted (so opening Settings from a dirty API tab does not trigger the leave guard). It holds: theme
  (Light / Dark / Match system), vault path (full, copyable), the "loopback only" explanation (the API starts agents and
  writes files, so it only listens on this machine), and connection status: connected, reconnecting (after 3 failed
  health polls in a row, matching `usePoll`'s backoff) or offline. These replace today's top-bar badges and theme
  switch.
- **Routing.** Hash routes: `#/home`, `#/runs[/<id>[/<node>]]`, `#/builder[/<workflow>]`, `#/crew[/<bot>]`, `#/api`,
  `#/graph[/<note path, encoded>]`, `#/triggers`, `#/settings`. `home` is the default; an empty or unknown hash goes to
  `#/home` (today it falls back to Builder). Existing links (`#/runs/<id>`, `#/builder/<name>`, the run links in
  Triggers) keep working. `#/runs/<id>/<node>` selects that step in the Inspector. The `crew/<bot>` and `graph/<note>`
  segments are parsed in Plan A and acted on in Plan B (opening the bot editor / the note).
- **⌘K menu.** Restyled with the tokens. The "Tabs" group is renamed "Go to" and lists Go to Home … Triggers; new
  entries "Open Settings" and "Theme: Light / Dark / Match system"; the Recent runs and Workflows groups stay. Meta+K
  opens it anywhere and Ctrl+K outside text fields (unchanged). A test picks each new entry.
- **Toasts** are restyled with the tokens; their behaviour is unchanged.
- **Leave guards.** The API tab's unsaved-edits confirm covers every way of leaving: rail, bottom bar, ⌘K, in-screen
  links, and also `hashchange` (browser Back/Forward, a typed hash), which today bypasses the guard: the shell restores
  the previous hash and asks first. `beforeunload` keeps covering reloads. Builder's own discard-unsaved dialog (when
  switching workflows) is unchanged. A test covers Back from a dirty API tab.

## 3. Home

Follows the approved "Studio Live — Home" board: two columns at 1200 px and wider; one column below 900 px in the order
Needs you, Start a run, Running, Live activity, Recent, Saved requests, Crew.

- **Start a run.**
  - Task input (multi-line; Meta+Enter or Ctrl+Enter starts, plain Enter adds a newline).
  - Workspace picker from `GET /api/workspaces`, defaulting to the workspace in `localStorage['aorch.api.ws']` (the API
    tab's choice), else the default workspace. The workspace's `path` is the run's `repo`. With no workspace
    registered, the box shows the register-a-workspace empty state (run `aorch workspace init` in the project folder)
    instead of the form.
  - Segmented control **Team · live** / **Team · autonomous** → `POST /api/runs {kind:'team', mode, task, repo}`. A
    **Workflow…** link opens the Builder (workflow runs are started from its run dialog).
  - "Maestro would pick" row from the roster preview (below). It hides while there is nothing to show or on error.
  - Example chips fill the task input.
  - Start is disabled until task and workspace are set. Errors from `POST /api/runs` (400/422) show inline under the
    form. On success the new run appears under Running.
- **Needs you.** Rows from `GET /api/attention`, newest first. Each row: kind chip (amber, or red for planning_error and
  failed), title, mono meta, age, and its actions. A successful action updates the row in place (the list is
  re-fetched); a failed one toasts and leaves the row unchanged.
- **Running.** One row per run with `live === true` from `/api/runs`: title, mono meta (id · branch · kind),
  `StepTrack`, `FaceStack` of the run's bots with the working bot breathing, a "what's happening now" line from
  `current` (e.g. "Bolt is working on Implement"), and a live elapsed clock. Interrupted and paused runs are under
  Needs you, not here.
- **Recent.** The 5 most recently finished runs (status done, error or stopped), probe runs excluded: result dot,
  title, duration and cost. (The board's "files touched" count is dropped: it needs a git call per run and a finished
  run's worktree may already be gone.)
- **Live activity.** Lines from `GET /api/activity` (face, short text, relative time). New items slide in and their
  text decodes in with ascii-reveal (at most the newest 5 animate). Pause stops polling; Resume fetches from the last
  cursor and inserts what was missed.
- **Saved requests.** The `/api/http/tree` requests of the workspace in `localStorage['aorch.api.ws']` (else the default
  workspace), each with its newest row from `/api/http/history?limit=100`: method, name, last status and time;
  requests without history show "never sent". A `409` (no workspace) shows the no-workspace empty state. Rows link to
  the API tab.
- **Crew.** Faces of the roster. A bot is busy when it is the role or agent of a `running` node in a live run; busy bots
  breathe, idle ones are dimmed.
- **Polling.** Home opens no EventSource. It polls `/api/runs` every 2 s while any run is live and every 10 s otherwise,
  `/api/attention` on the same timer, and `/api/activity` every 3 s (paused while the tab is hidden or the feed is
  paused).
- **Loading / refresh.** First load and Refresh show ascii skeletons, then decode the content in.
- **Empty states.** No runs yet, nothing needs you, no workspace, no saved requests: each says so with one useful
  action.

### Server changes for Home

All read-only. All follow the existing loopback, Host and Origin checks and return JSON errors like the other routes.
Evolve probe runs never appear in any of them.

**`GET /api/runs` rows gain (additive):** `branch`; `lastTs` (`store.lastTs`); `steps: { id, status }[]` in pipeline
order (for `StepTrack`); `current?: { node, bot, title }` (the first running or awaiting node; `bot` is its display
name); `bots: string[]` (the pipeline's agent roles, for `FaceStack`). Existing fields are unchanged.

**`GET /api/attention`** — what needs the person, computed server-side from run states (and, for planning errors, the
event log). Response `{ items: { id, ts, runId, kind, title, meta, actions }[] }`, sorted by `ts` descending. `meta` is
the run label (pipeline name or "Team run") · run id · branch. `actions` ⊆ `'answer' | 'review' | 'approve' | 'resume'
| 'retry' | 'open'`; the client maps each to an existing endpoint or link, and a kind with no direct endpoint gets
"Open" only.

| kind | when | ts | title | actions → endpoint |
| --- | --- | --- | --- | --- |
| `plan_ready` | `planWaiting(state)` (the run list's `planReady`) | the `plan.ready` event | "Plan ready for approval" | review → `#/runs/<id>` (plan review) |
| `question` | one per item in `state.pending` (planning questions and a worker's `user.ask`) | its `plan.question` / `user.ask` event | the question's `ask`, first 120 chars | answer → `#/runs/<id>` (planning) or `#/runs/<id>/<node>` (worker) |
| `approval` | a node `awaiting` whose pipeline node kind is `approval` | its `approval.requested` event | "<step title> waits for approval" | approve → `POST /api/runs/:id/approve {node, approved:true}`; open → `#/runs/<id>/<node>` |
| `planning_error` | a team run, status `running`, not live, whose latest `team.error` is newer than its latest `run.resumed` | the `team.error` event | "Planning failed" (no error text) | retry → `POST /api/runs/:id/resume`; open |
| `paused` | status `paused` with no `approval` or `question` item for the run | `lastTs` | "Paused" | open |
| `interrupted` | status `running`, not live, and no `planning_error` item | `lastTs` | "Interrupted: no process is driving it" | resume → `POST /api/runs/:id/resume`; open |
| `failed` | status `error` and `finishedAt` within the last 24 h | `finishedAt` | "Failed" (no error text) | retry → `POST /api/runs/:id/resume` (the engine retries failed steps for error runs); open → `#/runs/<id>` Timeline |

"Live" is computed exactly as `/api/runs` computes it (`engine.isLive(id)` or a team run waiting on the person). `id` is
`"<runId>:<kind>[:<node or question id>]"`, stable across polls.

**`GET /api/activity?since=<cursor>&limit=<n>`** — recent events across all runs as display lines. The feed may be on
a shared screen, so it carries no free text: only ids, bot names, step titles, statuses, counts, costs and durations;
never task text, prompts, outputs, gate output, questions, goals or error messages.

- Allowlist and templates (every other event type is skipped, `node.chunk` above all):
  `run.started` → "run started"; `run.resumed` → "run resumed"; `node.started` → "<bot> started[ (attempt n)]";
  `node.finished` → "<bot> finished|failed[ · VERDICT PASS|FAIL][ · $cost][ · duration]"; `node.skipped` → "<bot>
  skipped"; `gate.result` → "<step title> passed|failed (exit n)"; `approval.requested` → "<step title> waits for
  approval"; `approval.resolved` → "<step title> approved|rejected"; `plan.question` → "the team asks n question(s)";
  `plan.ready` → "plan ready for approval"; `user.ask` → "<bot> has a question"; `user.answer` → "question answered";
  `handoff` / `consult` → "<from> → <to>"; `run.finished` → "run done|failed|stopped[ · budget reached]".
- `kind` ∈ `working | needs | done | failed | info` drives the dot colour: started/resumed → working; asks, approvals
  requested, plan.ready → needs; finished ok, PASS, approved, gate passed, run done → done; error, FAIL, rejected, gate
  failed, run failed → failed; everything else → info.
- Bot and step names come from the run's pipeline nodes (`title ?? role ?? id`), looked up once per run per request.
- Line shape: `{ id, ts, runId, who, text, kind }`, `id = "<runId>:<seq>"`. Response `{ lines, cursor }`, newest
  first; `cursor` is the newest line's `"<ts>:<runId>:<seq>"`.
- Query: `SELECT run_id, seq, ts, type, data FROM events WHERE type IN (<allowlist>) AND (ts, run_id, seq) > (?, ?, ?)
  AND run_id NOT IN (<probe run ids>) ORDER BY ts DESC, run_id DESC, seq DESC LIMIT ?`. Without `since` it returns the
  newest lines. `limit` default 30, max 100. The `IN` list lets the query use the `events_type (type, ts)` index.

**`GET /api/roster/preview?task=<text>&ws=<workspace id>`** — up to 3 specialists Maestro would likely pick. No model
call.

- Candidates: `buildRoster({ dir: <workspace path>, task, crew, routing: loadRouting(home) })` entries with
  `builtin === false` (imported or pack specialists).
- Ranking: +3 when the bot's language (`botLanguage`) is among the workspace's detected languages; +3 when its domain
  pattern (roster.ts `DOMAIN`, exported for this) matches the task; +1 for each task keyword (lower-cased words of 4+
  letters, minus a short stop list) found in the bot's `when` line or in the `when` of a routing rule that names it.
  Bots scoring 0 are dropped; ties keep roster order; the top 3 are returned.
- Response `{ bots: [{ id, name, why }], core: string[] }`; `why` is the bot's `when` line (its `whenToUse`), first 80
  chars; `core` names the built-ins (planner, coder, reviewer, …). The UI shows "core crew (planner, coder, reviewer…)
  always available" next to the picks, or "Maestro will use the core crew" when `bots` is empty, and labels the row as
  a guess.
- Cost: the repo scan (`detectLanguages`) is cached per workspace for 60 s and passed into the roster build instead of
  rescanning; `loadRouting` is already mtime-cached. The client
  calls 400 ms after typing stops, with at most one request in flight, only for tasks of 8+ characters.
- Errors: task over 2000 characters → 400; unknown workspace or missing folder → built-ins only (`bots: []`). On any
  error the preview row hides with no toast.

## 4. Runs

Follows the approved "Studio Live — Runs" board. Every current Runs and Team function is re-housed, none removed:

| Area | Contents |
| --- | --- |
| Run list (left) | Runs polled every 2 s; filter segmented control All / Live (`live === true`) / Done (done, error or stopped) (new, from the board); "show probe replays" switch; per row: progress ring, status, title (pipeline name or "Team run"), Team and probe badges, "plan" or "? n" chip when a plan or questions wait, task first line, cost, age; the selected run has the moving border only while live (static under reduced motion); load error with Retry; empty state. |
| Header | Title, status chip, Team chip, "interrupted" chip (running but not live), task first line, cost of budget, branch, vault-note count; Stop (live and running, or paused); Resume / Retry failed (not live and stopped, running or error). |
| Banners | Stream error; run error; approval banner per `awaiting` node of kind `approval` with Approve / Reject (a worker waiting on its question shows in the question cards instead); Coach findings (title, detail, action). |
| Centre | Team runs before approval: the Team panel replaces the graph — live/autonomous mode toggle with its hint (while active); "the team has n questions" banner; question cards (options with the recommended badge, own-words box when allowed, asker, why, n of m) with Use recommendations / Send answers (planning answers sent as one batch, a worker's answers one at a time); plan review (goal, done-when list, who does what with face, write/read badge, swapped badge, goal, expects, why, bot swap select; limits: writes, budget, planning spent and left, time limit) with Reject (confirm "Cancel this run?") / Approve and start; "Dialogue so far" accordion. Otherwise: the plan graph — steps as cards with faces and status chips on a dot grid; edges done solid, working animated, next dashed; `StepTrack` above it (replaces the Stepper); clicking a step selects it (`#/runs/<id>/<node>`). Workflow runs show their pipeline in the same style. |
| Inspector (right), tabs | **Step**: bot face and name, status, attempts, fix loops, cost, duration, verdict, commit; step error; live output (the step's `live` tail from the existing stream's `state` events, with a caret blinking only while the step is running; `node.chunk` events stay filtered); gate command, passed/failed (exit n) and gate output; agent output; this step's committed diff with per-file +/− bars (parsed client-side from `/api/runs/:id/diff?node=`); "finished without changing any files" note; feedback Good / Bad with an optional note (agent steps that are done or failed, not probe runs). **Branch diff**: the whole branch, refreshed as later steps commit. **Timeline (n)**: run events with a JSON detail per event. With no step picked: a hint to click a step. |

"Why Maestro picked it" in the Inspector is the plan assignment's `why` for team runs and is omitted for workflow runs.
At most one EventSource (the selected run's stream) is open in the app.

Layouts: at 1200 px and wider, three panes. From 900 to 1199 px, list + centre, with the Inspector as a right drawer.
Under 900 px, a stack: the list, then the run page with Graph / Inspector tabs; back returns to the list.

## 5. Builder, Graph, Crew, Triggers, Evolve drawer

1. **Mockups first.** Studio Live boards for Builder, Graph, Crew, Triggers, the Evolve drawer and the Team panel
   (question cards, plan review, dialogue) are added to the canvas (row A+), using the component kit's parts and real
   content from each screen. Each board enumerates every function in its list below, and approval checks the list. The
   owner approves them (iterating as needed) before any of these is rebuilt.
2. **Build.** Each is rebuilt from the shared parts to match its approved board, keeping every current function:
   - **Builder.** Toolbar: open a saved workflow, New, pipeline name, live preflight (validates 300 ms after edits,
     error/warning/valid badge that toggles the issue list, offending steps flagged on the canvas), Save (only when
     dirty and the name is valid), Run (disabled with errors or no steps). Discard-unsaved dialog when switching
     workflows. Palette: Planner, Architect, Coder, Reviewer, Gate, Approval; ECC skills and commands with search (adds
     a step with the skill's prompt; hidden when there are none). Canvas: drag steps, connect ports (no duplicates, no
     cycles), select and Delete steps or edges, pan, wheel zoom, zoom in / out / fit, empty hint; new steps chain onto
     the previous one. Inspector: pipeline settings (mode, parallel read-only steps, step timeout, spend cap, upstream
     output, setup command) or the step editor (label, role, agent — follow its bot or a detected adapter, marked when
     not installed — model, instructions, read-only, include diff, VERDICT, knowledge-graph context; gate: Command /
     Request with the request-gate fields, a parked command restored when switching back; on-failure fix step and max
     fix loops; Delete step). Run dialog: Workflow / Team, team mode toggle, repo (remembered in
     `localStorage['aorch.repo']`), task, auto-approve approval steps, tell agents about saved API requests, Start run.
     Deep link `#/builder/<name>`; the request gate handed over from the API tab ("Use as gate in a workflow"). Below
     900 px, view-and-run only (canvas pan and zoom, no palette or editing) unless the Builder board says otherwise;
     until Plan B it keeps today's layout.
   - **Graph.** Vault graph with pan and wheel zoom; nodes coloured by type (run, pipeline, role, file, note) with a
     legend and counts; search (hits highlighted, others dimmed); selecting a note dims everything but its neighbours
     and opens it (title, type, body up to 6000 characters, linked-from and links-to lists that open those notes); stats
     line (notes, links, unresolved); Reload; error state; deep link `#/graph/<note path>`.
     *Amendment 2026-10-25 (owner approved the Graph board only after a v2 rework he asked to be "more interactive,
     animated, and dynamic"):* the Graph is a live board. A small hand-written force layout settles on load and springs
     when a note is dragged (one rAF loop that stops when settled; under reduced motion, and for vaults over 1,500
     notes, the layout is computed to rest up front and nothing loops). Hover highlights neighbours at 1–3 hops (hop
     control) and dims the rest; click selects; double-click or Enter glides the camera to a note; search pulses its
     matches (three pulses, then a still ring) with an "n found" count and flies to the first; type filters fade notes
     out and the layout re-settles; wheel and buttons zoom, background drag pans, Fit and Re-run layout. Type is shown
     by shape, not hue (run square, pipeline hexagon, role triangle, file filled circle, lesson diamond, other notes
     hollow circle; `lesson`/`lesson-retired` join the type list). A keyboard-accessible "All notes" list mirrors the
     board. The reader adds tags (click = search) and a Connected list (hover highlights, click navigates). "Used by a
     run" is the smallest honest signal the system records: runs do not log which notes they *read*, but they log every
     note they *write* (`vault.note` events). A new read-only route `GET /api/vault/activity?since=<cursor>&limit=<n>`
     (same cursor, settle and probe rules as `/api/activity`; items `{ id, ts, runId, run, path }`, `run` = run label)
     feeds it: a note a run just wrote pings green for 12 s and a ticker line says "<run label> recorded <note>"; the
     reader shows "last written by <run label> · <age>". The ticker hides on error (like the roster preview).
   - **Crew.** + New bot; Import ECC… / Update ECC… (dialog with the version change) and Remove ECC (confirm); filter
     tabs All / Built-in / Custom / ECC with counts; bot cards: face (opens the editor), name, title, ECC badge, harness
     version badge, open-proposal mark, when-to-use or persona line, agent select (marked when not available) and model
     (with suggestions) with Save and Unlink, Evolve button (agent and verdict bots); approval bots say a person signs
     off. Bot editor drawer: face preview, hue and tone sliders, reset to generated face, name, title, kind (locked for
     built-ins), persona (full text loaded for truncated imports, read-only until it loads; length limits 600, ECC
     24000; ECC update note), read-only switch for custom agent bots, Save / Cancel / Remove or Reset to original. Crew
     packs with "Add to my crew". Local-models note. Load error with Retry. Deep link `#/crew/<bot>`.
   - **Evolve drawer** (opened from a Crew card). Close; status message; the `aorch evolve <bot>` hint; harness version
     (not-evolvable mark), persona, guidance notes, Versions accordion with Roll back to vN (confirm); Proposals: id,
     label, stale badge and explanation, base / made version, editor cost, note, each edit with a pick checkbox (field
     and op or role note, probe chip, before/after diff, supporting lessons), probe summary (spend of budget, stopped by,
     up to 10 results), Accept all / Accept n of m, Pick the kept edits, Reject (confirm); Lessons: status, text,
     polarity, run count, provenance, id.
   - **Triggers.** + New trigger; trigger table (status dot, id and status, repo → workflow with the comments chip,
     workspace, agent / model, events, last delivery, On switch to enable or pause, Test, Log, Edit, Delete with
     confirm); load error with Retry. Form: repo, workflow (suggestions from saved workflows), workspace (picker, or a
     text field when none are listed), agent, model (suggestions), events (suggestions), only-with-labels, id (auto,
     locked when editing), post the result as a PR comment, include drafts, include forks, Save / Cancel. Test panel:
     trigger, pull request, Dry run, Fire for real (confirm), result with "Open the run". Webhook setup: tunnel hint,
     payload URL and copy, content type, events to select, secret (shown once with copy when generated, otherwise its
     hint and source), Generate / Regenerate (confirm), Hide; error with Retry. Deliveries: filter by trigger, Refresh,
     sortable table (when, trigger, source, PR, outcome, run link or reason); error with Retry.

## 6. Accessibility and layout

- Breakpoints: 1200 px and wider for full layouts; 900–1199 px for the mid layouts above; under 900 px for the
  bottom bar and stacked layouts. Checked at 390 × 844 and 1024 × 768.
- Layouts reflow at 200% zoom and at 320 CSS px without horizontal scroll (WCAG 1.4.10).
- The activity list is `role="log"` with `aria-live="polite"` and announces only the final text: the decode effect is
  `aria-hidden` and the real text sits in a visually hidden span. Elapsed clocks are `aria-hidden` with a static
  "started 3 min ago" label. Pulsing chips keep their text label.

## 7. Error handling

- Every data panel shows its own inline error (`role="alert"`) with a retry, never a silent empty list (the roster
  preview is the one exception: it hides).
- Polling failures back off (`usePoll`: 15 s between tries after 3 failures) and show "reconnecting" in Settings'
  connection status.
- Actions on Home and Runs show toasts on failure and leave the row unchanged.

## 8. Testing

- Existing web tests keep passing. Plan A rewrites the App, theme and token tests: navigation by the rail
  (`role="navigation"`, `aria-current="page"`) instead of `role="tab"`, the `#/home` default instead of `#/builder`,
  three theme states, root-level tokens instead of the `.studio` blocks. Other selectors move to role and accessible
  name. Snapshot updates (e.g. `Face.test.tsx.snap`) are reviewed, not bulk-accepted.
- New web tests: rail navigation (click, arrow keys, Home/End, bottom bar and More at phone width), theme selection
  (OS change under system, manual override, storage unavailable, old stored value), every Studio part, Home sections
  against mocked API responses (including empty, error and loading states), Start's request body for each mode, leave
  guards through the rail, ⌘K and browser Back, the new ⌘K entries.
- New node tests:
  - `/api/attention`: each kind from a fixture run, sort order, probe runs excluded, `paused` and `interrupted`
    suppressed when a more specific item exists, no error text in titles.
  - `/api/activity`: each template and kind, cursor (no repeats or gaps at equal `ts`), limit default and cap, probe
    runs excluded; a fixture whose task, outputs, gate output, questions, goals and errors contain a sentinel string
    never returns the sentinel; with 10k seeded `node.chunk` rows the query plan uses `events_type`.
  - `/api/roster/preview`: two different tasks on the same workspace can return different bots; a domain task ("fix
    the RAG retriever") returns `rag-pipeline-reviewer` when it is imported; no built-ins in `bots`; task cap; unknown
    workspace returns `bots: []`; no model call.
  - `/api/runs` additions: `branch`, `lastTs`, `steps` order, `current`, `bots`.
- The contrast test over both token sets (pairs in §1) and the no-purple scan.
- Manual: click-through in Chrome in both themes and at phone width before each phase is called done.

## 9. Delivery

Two implementation plans. The mockups gate Plan B only.

**Plan A — starts now** (Home and Runs have approved boards):

1. **Foundation and parity pass:** root tokens and cascade, text-safe accent, theme selection, Arc bridge, no-purple
   and gradient rules, global reduced motion, Studio parts, the parity pass over the unbuilt screens.
2. **Shell:** rail, bottom bar, Settings drawer, routing, ⌘K and toasts, leave guards.
3. **Home** and its server changes (`/api/runs` additions, `/api/attention`, `/api/activity`, `/api/roster/preview`).
4. **Runs**, with the Team panel re-housed in the centre pane (styled through tokens and shared parts).

**Mockups — in parallel with Plan A:** Builder, Graph, Crew, Triggers, the Evolve drawer and the Team panel boards →
owner approval.

**Plan B — written after the mockups are approved:**

5. **Builder and Graph.**
6. **Crew (with the Evolve drawer), Triggers, and Team panel parity** with its board; then delete the `.studio` alias
   and leftover per-screen styles.

Each phase ends with tests green, typecheck and build clean, and a Chrome check in both themes. If PR #3 changes while
Plan A is under way, the fix lands on PR #3 first and is merged up before the current phase ends.
