# Studio Live restyle of the aorch web app

Date: 2026-10-25 · Status: approved in chat, awaiting written-spec review
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

- This is a restyle plus the new Home screen. Builder, Runs, Graph, Crew and Triggers keep every current function and
  behaviour; nothing is removed.
- The terminal UI (TUI) is out of scope.
- The branch `feature/studio-live-restyle` stacks on PR #3 because it reuses that PR's Studio Live foundation.

## Non-goals

- New product features beyond Home's sections, the activity feed and the roster preview.
- Changes to the TUI, CLI output, engine behaviour or run semantics.
- A component library rewrite; vendored Arc components stay and are restyled through tokens.

## Approach

One global switch (chosen over gradual per-screen `.studio` opt-in and over a new component library): Studio Live
tokens become the app-wide theme, a new shell replaces the tab strip, and each screen is rebuilt from a small set of
shared Studio parts. Old per-screen styles are deleted as each screen moves over, so the app never carries two looks
for long.

## 1. Foundation

- **Tokens.** The Studio Live tokens defined in `web/src/studio.css` (currently scoped to `.studio`) move to the root
  in `web/src/theme.css` for both themes. `.studio` remains as an alias during the migration and is deleted at the end.
  Dark and light values are the ones already in `constraints.md` of the workbench plan; both themes must pass WCAG AA
  contrast for text (4.5:1) and UI glyphs (3:1).
- **Theme selection.** `web/src/theme.ts` keeps following `prefers-color-scheme` and listens for changes; a manual
  choice (Light / Dark / Match system) is saved and wins. `data-accent="violet"` is removed: Arc's accent and control
  variables are re-pointed to the Studio tokens globally, so no Arc component can render violet.
- **Type.** Geist and Geist Mono (already self-hosted) apply app-wide.
- **Motion.** 150–280 ms, `cubic-bezier(.2,.8,.2,1)`. Loops only for live state (working step, breathing face, live
  clock, streaming caret). Everything stops under `prefers-reduced-motion`.
- **Loading.** Every loading state goes through `web/src/components/Loading.tsx` (AsciiSkeleton + AsciiReveal); no
  spinners-as-placeholders and no grey skeletons. Inline button busy states may keep Arc's button `loading` prop.
- **Shared Studio parts** in `web/src/ui/studio/`, each one file with its own test:
  - `ScreenHeader` — mono meta line, title, summary, right-aligned actions.
  - `SectionHeading` — title + count (mono) + optional action.
  - `ListRow` — hairline row with leading marker/face, title, meta, trailing age and actions; hover state.
  - `StatusChip` — label + dot; live states pulse; colour always paired with text.
  - `StepTrack` — segmented progress bar for a run's steps (done / working stripes / waiting pulse / queued).
  - `FaceStack` — overlapping Blobatar faces with optional breathing for the working bot.
  - `Panel` — bordered surface with optional header.
  - `EmptyState` — wraps Arc's empty state with Studio copy and actions.
  - `Kbd` — keyboard hint.
  Screens use these instead of one-off markup.

## 2. Shell

- **Rail** (`web/src/ui/studio/Rail.tsx`): Home, Runs, Builder, Crew, API, Graph, Triggers; Settings pinned at the
  bottom. Icon buttons with accessible names; labels appear on hover and focus; arrow keys move between items; the
  active item shows a 2 px accent marker. On widths under 900 px the rail becomes a bottom bar with the same items
  (Graph and Triggers move into an overflow menu if they don't fit).
- **Settings** (a panel opened from the rail): theme (Light / Dark / Match system), vault path, connection status, the
  existing items that sit in today's top-right area.
- **Routing.** Hash routes stay (`#/home`, `#/runs`, …). `home` becomes the default route; old links keep working.
- **⌘K menu and toasts** are restyled with the tokens; their behaviour is unchanged.
- **Leave guards.** The API tab's unsaved-edits confirm and `beforeunload` keep working for every way of leaving
  (rail, bottom bar, ⌘K, in-screen links).

## 3. Home

Follows the approved "Studio Live — Home" board (two columns on wide screens, one on phones).

- **Start a run.** Task input, Team / Solo / Plan-only segmented control, "Maestro would pick" faces, example chips,
  Start (⌘↵). Start uses the existing run-start route; the new run appears under Running.
- **Needs you.** One row per item, newest first:
  - an unanswered question in a run's `pending` list (plan approval, planning questions, a worker's `user.ask`) →
    Answer / Review (opens the run at that question);
  - an approval step waiting (`approval.requested`, node status `awaiting`) → Approve / Open;
  - a run that ended in `error` in the last 24 h → Retry / Logs.
  Actions call the existing endpoints; a successful action updates the row in place.
- **Running.** One row per running run: title, mono meta (id · branch · kind), `StepTrack`, `FaceStack` with the
  working bot breathing, a "what's happening now" line, and a live elapsed clock.
- **Recent.** The last few finished runs with result dot, files touched and duration.
- **Live activity.** A feed of recent events across runs (face, short text, relative time); new items slide in and
  their text decodes in with ascii-reveal; Pause / Resume.
- **Saved requests.** The current workspace's saved requests with their last status and time (from `/api/http`);
  links to the API tab.
- **Crew.** Faces of the roster; busy bots breathe, idle ones are dimmed.
- **Loading / refresh.** First load and Refresh show ascii skeletons, then decode the content in.
- **Empty states.** No runs yet, nothing needs you, no workspace, no saved requests: each says so with one useful
  action.

### New read-only endpoints

- `GET /api/activity?since=<ts>&limit=<n>` — recent events across all runs from the store's `events` table (indexed by
  type and time), mapped server-side to `{ id, ts, runId, who, text, kind }` lines. `kind` is one of
  `working | needs | done | failed | info` and drives the dot colour. Default limit 30, max 100. Text is built from
  event fields only; no prompts, outputs or secrets are included.
- `GET /api/roster/preview?task=<text>&ws=<id>` — the top four bots from the existing `buildRoster` + routing hints
  for that task and workspace folder, as `{ bots: [{ id, name, why }] }`. No model call. Task text is capped at
  2000 characters. The UI labels the result as a guess.

Both follow the existing loopback, Host and Origin checks and return JSON errors like the other routes.

## 4. Runs

Follows the approved "Studio Live — Runs" board.

- **Run list** (left): each run with a progress ring, title, mono meta; the active run has the moving border; filter
  segmented control (All / Live / Done).
- **Team plan graph** (centre): steps as cards with faces and status chips on a dot grid; edges show flow (done solid,
  working animated, next dashed); clicking a step selects it. Workflow (non-team) runs show their pipeline in the same
  style.
- **Inspector** (right): selected bot's face, mode, "why Maestro picked it", streaming output with a caret (existing
  run stream), files touched with diff bars.
- **Gate banner:** pending approvals and gates with Approve / Send back, using existing endpoints.
- All existing Runs and Team functions (swap, answer, stop, open diff, PR) keep working and are re-housed, not removed.

## 5. Builder, Graph, Crew, Triggers

1. **Mockups first.** Studio Live boards for Builder, Graph, Crew and Triggers are added to the canvas (row A+), using
   the component kit's parts and real content from each screen. The owner approves them (iterating as needed) before
   any of these screens is built.
2. **Build.** Each screen is rebuilt from the shared parts to match its approved board, keeping every current function:
   Builder (palette, canvas, step editor incl. Command / Request gates, run dialog), Graph (vault graph, search, note
   view), Crew (cards, faces, face editor, ECC import/update/remove), Triggers (trigger table, setup, deliveries).

## 6. Error handling

- Every data panel shows its own inline error (`role="alert"`) with a retry, never a silent empty list.
- Polling failures back off and show a quiet "reconnecting" state in Settings' connection status.
- Actions on Home and Runs show toasts on failure and leave the row unchanged.

## 7. Testing

- Existing web tests keep passing, with selectors updated where markup moves (by role and accessible name).
- New web tests: rail navigation (click, arrow keys, bottom bar at phone width), theme selection (OS change + override),
  every Studio part, Home sections against mocked API responses (incl. empty, error and loading states), leave guards
  through the rail and ⌘K.
- New node tests: `/api/activity` (mapping, kinds, limit cap, since, no prompt/output text) and `/api/roster/preview`
  (ranking matches `buildRoster`, task cap, no model call).
- A contrast test over both token sets.
- Manual: click-through in Chrome in both themes and at phone width before each phase is called done.

## 8. Delivery phases

1. **Mockups** for Builder, Graph, Crew, Triggers → owner approval.
2. **Foundation and shell** (tokens global, theme, Arc bridge, Studio parts, rail, Settings, routing, ⌘K/toasts).
3. **Home** and its two endpoints.
4. **Runs.**
5. **Builder and Graph.**
6. **Crew and Triggers**, then delete `.studio` scoping and leftover per-screen styles.

Each phase ends with tests green, typecheck and build clean, and a Chrome check in both themes.
