# Tether assistant, beui.dev components, seamless sidebar

**Spec:** `docs/superpowers/specs/2026-10-26-tether-assistant-and-beui-design.md` (binding). **Mockups:**
`docs/design/AppTetherChat.dc.html` (one chat turn), `docs/design/AppAssistant.dc.html` (launcher, panel, dock, collapse).
**Branch:** `feature/tether-assistant-beui`, stacked on `feature/linear-sidebar-accounts` (PR #6).
**Order:** Phase 1 = tasks 1–8, then checkpoint 1. Phase 2 (component migration, spec §3 and §5) starts only after the
owner replies. One commit per task (or a few), conventional messages.

## Decisions

### Code highlighting: lezer, no Shiki
beui's `agent-code` highlights through Shiki (about 1 MB of grammars and themes). Tether already ships the lezer parsers
behind CodeMirror. `components/beui/lib/highlight.ts` loads them **lazily** (`import('@lezer/javascript')`,
`import('@lezer/json')`), so they share the chunk the Code screen already loads and stay out of the main bundle. Tags map to
Studio tokens the way `code/cmTheme.ts` does (keywords ink 600, strings `--ok`, numbers `--warn`, comments and punctuation
`--mut`). `bash`, `diff` and `text` render untokenised: file-diff colours its own rows. **No Shiki dependency.**

### Token map (Tailwind `@theme inline`, `web/src/tw.css`)
beui's classes read `--color-*`. They map straight to Studio tokens, at the `--color-*` level, because Tether already uses
`--muted`, `--accent` and `--border` with other meanings (`--muted` is muted **text** here, `--accent` the blue fill):

| beui | Studio | | beui | Studio |
|---|---|---|---|---|
| background | `--bg` | | border | `--line2` |
| foreground | `--ink` | | border-strong, input, ring | `--edge` |
| card, popover | `--s1` | | primary | `--ink` |
| muted, secondary, accent | `--s2` | | primary-foreground | `--bg` |
| muted-foreground | `--mut` | | destructive, danger | `--bad` |
| success | `--ok` | | warning | `--warn` |
| live (new) | `--acc` | | live-foreground (new) | `--accInk` |

`--color-violet` and `--color-neon` are not defined. `--font-sans`/`--font-mono` are the Geist stacks. The dark variant is
`@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`.

### Tailwind without preflight, utilities unlayered
`tw.css` imports `tailwindcss/theme.css` (layer theme) and `tailwindcss/utilities.css` **without a layer**, and never
`preflight.css`. Our element defaults are unlayered `:where()` rules (specificity 0): a layered utility would lose to them
whatever its specificity, an unlayered `.bg-foreground` (0,1,0) wins. `tw.css` loads after `studio.css`.
Scanning is `source(none)` plus `@source` per folder written in Tailwind (beui, bencho, aicss, faces, assistant): scanning
all of web/src turned plain words into global utilities (`.ring`, `.outline`, `.hidden`), which would restyle our classes of
the same name. Those three classes are renamed (`prog-ring`, `cw-chip ghost`, `is-hidden`) and rules.test forbids a global
class named like a bare utility, so Phase 2 can add screen folders safely.

## Dependencies (dev, bundled into the web build)
- `tailwindcss` 4.3.x + `@tailwindcss/vite` 4.3.x: beui's components are written in Tailwind v4 classes; the owner picked
  "Tailwind v4 alongside Studio tokens" (spec §2). Only the classes in use are emitted.
- `clsx` + `tailwind-merge`: beui's `cn()`; `tailwind-merge` resolves conflicting classes when a caller overrides a
  component's defaults (`className`). Our old `ui/cn.ts` keeps its API and now wraps them.
- No Shiki (above).

## Global Constraints
- **Approvals:** the assistant never starts a run, merges, comments or calls the outside world without an explicit
  approval click. Proposals are stored server-side and started only by `POST /api/assistant/proposals/:id
  {decision:"start"}`; the agent runs read-only (plan mode) in a Code Mode session with `approved:false`, so outside-world
  connector calls are refused and come back as tool-approval cards.
- **Secrets:** tokens and secrets never reach the browser or logs. Tool output shown in the chat goes through
  `activity.redact`; connector credentials stay in the server process.
- **Colour:** blue = live only, amber = needs you, green = done, red = failed. Ink primary buttons. No purple, gradient or
  glow (beui's metallic/magnetic buttons are not copied). Both themes AA.
- **Motion:** 150–280 ms; loops only for live state (caret, spinner, launcher ring); `prefers-reduced-motion` respected
  (motion's `useReducedMotion`, and studio.css's global rule).
- **Licences:** MIT sources are copied verbatim into the tree, then adapted; each copied file keeps an MIT header naming
  the source, the copyright and what was changed.
- **Homes:** tests use temp homes; the real check runs on a scratch home (`TETHER_HOME=$(mktemp -d)`) and its own port,
  never `~/.aorch` or the owner's server on 127.0.0.1:4177.
- **Git:** stage by explicit path; never `.mockup/`, `.superpowers/`, `.claude/`. No push.

## Phase 1 tasks

### 1. This plan (docs commit)

### 2. Tailwind v4 foundation (spec §2)
Files: `package.json`, `web/vite.config.ts` (+`tailwindcss()`), `vitest.config.ts` (unchanged: CSS is blanked),
`web/src/tw.css`, `web/src/main.tsx` (import after studio.css),
`web/src/components/beui/lib/{utils.ts,ease.ts,highlight.ts}`, `web/src/components/beui/LICENSE`; the three renamed
classes (graph, crew, runs).
Tests: `web/src/tw.test.ts` — every mapped `--color-*` points at the token in the table, the dark variant is
`[data-theme="dark"]`, no preflight import, no violet/neon colour; `rules.test.ts` gains a beui block: no
`bg-gradient|bg-linear|bg-radial|bg-conic`, no zero-offset glow shadow class, no purple/violet/indigo/fuchsia class, no
metallic/magnetic variants, and every file under `components/beui` carries the MIT header.

### 3. Seamless sidebar collapse (spec §6)
Files: `ui/studio/Sidebar.tsx`, `SideParts.tsx`, `ProjectSwitcher.tsx`, `shell.css`.
One DOM in both states: rows are `margin: 0 8px` with a 40 px icon cell, so an icon's centre is 8 + 20 = 28 px = half the
56 px rail; the aside's width animates 240 ms with no padding change; labels, counts and hints stay in the DOM and fade
(opacity 160 ms) and clip; section headers keep their 24 px and show a hairline when collapsed; the head is one row whose
glyph never moves and, collapsed, swaps to the expand icon on hover (click expands); rail tooltips sit at the row centre.
Tests: `Sidebar.test.tsx` — the same rows render in both states (Runs and Favorites stay), labels hidden from the
accessibility tree only by the button's own name; `sidebarGeometry.test.ts` — the geometry read from shell.css gives
equal icon centres collapsed and expanded and no `.collapsed` rule changes row/icon inset; a Chrome measurement in the
real check.

### 4. TetherFace + the Maestro → Tether rename
Files: `web/src/components/faces/TetherFace.tsx` + `TetherFace.css` (bencho Watcher, verbatim then: tokens mapped to
`--tf-slab`/`--tf-eye` defaulting to `--s3`/`--ink`, `idle` for small or static uses, reduced motion = static, no colour
literals); `Face.tsx` draws TetherFace for `orchestrator`. Server: `crew.ts`/`bots.ts` name `Tether`; prompts say "You are
Tether"; `types.ts` `Answer.by` gains `'tether'` (new writes) and keeps `'maestro'` (old logs); `sessions.ts` `who`
likewise; `/api/http/send-to-agent` takes `{kind:"tether"}` and the `maestro` alias; a `botAlias()` helper maps
`tether`/`maestro` → `orchestrator` where a bot id is looked up (bindings CLI `link`, roster). Web and TUI copy say Tether.
Tests: TetherFace (renders, follows a pointer move, idle ignores it, reduced motion static); `test/rename.test.ts` gains the
alias cases; existing tests updated for the copy.

### 5. Assistant shell UI
Files: `web/src/assistant/{Assistant.tsx,Launcher.tsx,Panel.tsx,useAssistantShell.ts,assistant.css}`, `App.tsx`,
`shell.css` (a third grid column for the docked panel).
Launcher bottom-right (above the bottom bar on phones), face in an ink circle, amber badge + ring while something needs you
and the panel is unseen; ⌘J toggles, Esc closes (floating); floating 384×560 springs from the corner; docked 420 px beside
the screen (⤢/⤡), remembered on this device; header: face, "Tether", "knows <project> · sees the <page> page", New chat,
close. History per project (task 7's API).
Tests: `Assistant.test.tsx` — launcher, badge, ⌘J, Esc, dock/undock, context line, New chat, per-project history.

### 6. Chat components (beui agents, aicss, bencho)
Copied then adapted into `web/src/components/beui/agents/` (prompt-input, streaming-response, citations, approval-card,
todo-list, tool-approval, tool-result, file-diff, code-block, agent-code, agent-disclosure) and the motion pieces they
need (`motion/button/base`, `action-swap`, `checkbox`, `radio`, `select` + `popover-morph`/`popover-position`, hooks);
`components/aicss/ComparisonTable.tsx` (+ module CSS); `components/bencho/UploadDropzone.tsx` (+ CSS), wired to real
`File`s with a size limit. Adapt: `@/` imports → relative; Shiki → `lib/highlight.ts`; `.dark` → our variant (via the
theme map); any purple/glow/gradient default removed.
Tests: one file per component group — streaming caret then actions; citation chips call `onOpen`; approval card questions
(single choice auto-advances, multi) and review (approve / changes / reject) collapse to one line; tool approval three
decisions; tool-result streams then collapses, copy; file-diff +/− counts; code-block copy; comparison table; dropzone
accepts a real file and refuses an oversized one.

### 7. `POST /api/assistant` (SSE) and friends
Server files: `src/assistant/{types.ts,history.ts,prompt.ts,reply.ts,turn.ts,routes.ts}`, `src/server.ts` (dispatch),
`src/adapters/claude.ts` (+ optional `onDelta` via `--include-partial-messages`), `src/types.ts` (`AgentRequest.onDelta?`).
Web files: `web/src/assistant/{api.ts,useAssistant.ts,Thread.tsx,Answer.tsx,cards.tsx,context.ts}`.

Interfaces (shared types in `src/assistant/types.ts`, imported by the web like `api.ts` imports `src/types.js`):
```ts
type Cite = { n: number; label: string } & ({ kind: 'file'; path: string; line?: number } | { kind: 'run'; id: string } | { kind: 'note'; path: string });
interface Proposal { id: string; kind: 'workflow' | 'team'; workflow?: string; task: string; mode?: TeamMode; why?: string; status: 'proposed' | 'started' | 'dismissed' | 'failed'; runId?: string; note?: string }
interface AskCard { id: string; questions: { id: string; title: string; desc?: string; multi?: boolean; options: { id: string; label: string; desc?: string }[] }[]; status: 'pending' | 'answered'; result?: string }
interface ToolAsk { id: string; what: string; status: 'pending' | 'once' | 'always' | 'denied' }
interface ToolRun { id: string; code: string; output?: string; isError?: boolean; ms?: number }
interface Compare { title?: string; columns: string[]; rows: { label: string; cells: string[] }[] }
interface ChatMessage { id: string; role: 'you' | 'tether'; text: string; at: number; cites?: Cite[]; proposals?: Proposal[]; ask?: AskCard; toolAsks?: ToolAsk[]; tools?: ToolRun[]; compare?: Compare; attachments?: { name: string; size: number }[]; feedback?: 'up' | 'down'; error?: string }
interface AssistantContext { page: string; selection?: { kind: 'run' | 'file' | 'note' | 'request' | 'workflow' | 'bot'; id: string; line?: number } }
type StreamEvent = { type: 'start'; you: ChatMessage; id: string } | { type: 'delta'; text: string } | { type: 'tool'; tool: ToolRun } | { type: 'done'; message: ChatMessage } | { type: 'error'; error: string };
```
Routes (Host/Origin guarded by server.ts):
- `GET /api/assistant?ws=` → `{ messages, agent, model?, models[] }` (the orchestrator binding = Tether's).
- `POST /api/assistant` `{ ws?, message, context?, model?, attachments?: {name,text}[] }` → `text/event-stream` of
  `StreamEvent`. One turn: the default crew agent (Tether's binding, default `claude`), read-only, in a Code Mode session
  (`writable:false`, `approved:false`, grants = the project's "always" grants + this turn's "once" grants). The prompt
  injects the page, the selection, the needs-you items, recent runs and the project notes. The final answer's
  ```` ```tether ```` JSON block (hidden while streaming) carries `sources`, `proposals`, `questions`, `compare`; each is
  validated (files exist in the project, runs in the store, notes in the vault; proposals through maestro's validation).
  Blocked outside-world calls become `toolAsks`.
- `POST /api/assistant/new {ws?}` archives the chat (last 20 kept) and starts a fresh one.
- `POST /api/assistant/proposals/:id {ws?, decision:"start"|"dismiss"}` — the only path that starts a run.
- `POST /api/assistant/proposals {ws?, from: messageId}` — "turn into a run": a new **proposal** (still needs Start).
- `POST /api/assistant/tools/:id {ws?, decision:"once"|"always"|"deny"}`; `POST /api/assistant/feedback/:id {ws?, value}`.
History: `<home>/assistant/<ws|_>.json`, atomic writes, 200 messages per chat.

Web: `useAssistant` streams with `fetch` + a reader (EventSource cannot POST), Stop aborts; the thread auto-scrolls unless
the person scrolled up; citations navigate (file:line → Code, run → Runs, note → Graph); proposal cards are approval cards
in review mode (Start run / Edit / Dismiss) and show the started run's steps as a live todo-list.
Tests: node `test/assistant.test.ts` — streams deltas then done; the prompt carries page, selection and needs-you; the
```` ```tether ```` block never streams; bad sources dropped; a proposal starts nothing until approved, then starts exactly
one run; dismiss starts none; history persists and New chat archives; outside-world calls become tool asks; secrets
redacted. Web: streaming render, stop, citations navigation, proposal → start, answers sent back, tool decision.

### 8. Real check
Scratch home + port (`TETHER_HOME=$(mktemp -d) node dist/cli.js serve --port 4199`), a throwaway git repo registered as a
project, Tether bound to `claude` / `haiku`. One exchange: streaming visible, a citation that navigates, a proposed-run card
that starts a run only after the click. Chrome: both themes, collapse geometry measured, launcher/panel/dock.

### 9. Checkpoint 1 report; stop.

## Phase 2 (after the owner replies; outline)
Screen by screen (Home, Inbox, Runs, Code, Builder, Crew, API, Graph, Triggers, Settings): beui replaces the basic
components in spec §3; the agent components reused per §5 (approval card in Inbox/run gates/Code Mode approvals; todo-list
on the run page and Home Running; tool-result in run step logs, API response, trigger deliveries; file-diff in the run diff
and Code's runs lens; code-block for read-only code); the dropzone on every upload; the picker on every assignment;
liq-create on compose; action-node on Builder steps and the integration palette; data tables for Runs, API history,
trigger deliveries, Graph notes; sortable-stack for pins and step order. Arc pieces are deleted once unused. Every screen
keeps every function; tests follow the markup.
