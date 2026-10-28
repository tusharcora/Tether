# Tether assistant, beui.dev component system, seamless sidebar

Date: 2026-10-26 · Branch: `feature/tether-assistant-beui` (stacked on `feature/linear-sidebar-accounts`, PR #6)

## 1. Intent

Owner decisions (2026-10-26):
- **Maestro becomes "Tether", a personal assistant** living at the bottom right of every screen: a launcher that expands
  into a chat and can dock as a side panel (mockup `docs/design/AppAssistant.dc.html`). Its avatar is a **face, not the
  logo** — bencho.dev's eye-tracker ("Watcher"), like every other bot has a face.
- **The chat is built from beui.dev agent components** (mockup `docs/design/AppTetherChat.dc.html`, one playable turn).
- **Replace Tether's basic components with beui.dev** — via **Tailwind v4 alongside Studio Live tokens** (owner chose
  option 1).
- **Sidebar collapse must be seamless** (positions were off): fixed icon column, nothing moves but the edge.
- Use bencho.dev upload-dropzone for **every** file upload; action-node, picker, liq-create where they fit; aicss data
  and comparison tables where useful.

Sources were researched and saved (verbatim, with licences) under `.superpowers/components/` (git-ignored):
`beui/<name>/source` (MIT, © Saurabh Chauhan, github.com/starc007/ui-components), bencho blocks (MIT, © Lorenzo Cabra),
aicss free components (MIT). AICSS **Pro** items are not used. Each copied file keeps its MIT notice.

## 2. Tailwind v4 + beui foundation
- Add `tailwindcss` v4 + `@tailwindcss/vite`; import **without preflight** (our foundation stays authoritative);
  `@theme` maps beui's variables to Studio Live tokens: `--background→--bg`, `--foreground→--ink`, `--muted→--s2`,
  `--muted-foreground→--mut`, `--border→--line2`, `--border-strong→--edge`, `--ring→--edge`, `--primary→--ink`,
  `--primary-foreground→--bg`, `--card→--s1`, `--destructive→--bad`, `--success→--ok`; dark variant =
  `[data-theme="dark"]` (our attribute), not `.dark`. Blue stays reserved for live state.
- Add `clsx` + `tailwind-merge` (`cn`), keep `motion/react` and `lucide-react`. Components live in
  `web/src/components/beui/` (registry source copied verbatim, then adapted; MIT header kept).
- `web/src/rules.test.ts` keeps guarding: no purple/indigo, no gradient/glow decoration — extended to scan the beui
  folder; any beui default that violates (e.g. metallic/glow button variants) is removed or disabled.
- **Code highlighting**: keep Shiki out of the main bundle — the beui code-block/file-diff highlight through the
  CodeMirror/lezer highlighter we already ship, or load Shiki lazily only when a code block first renders (implementer
  picks the smaller; recorded in the plan).

## 3. Migration of basic components (screen by screen, Arc retired as it empties)
beui → replaces: button, card (+ Panel), checkbox, switch, tabs/segmented-control, select/combobox, input, slider,
tooltip, accordion/collapsible, drawer (+ SettingsDrawer), toast stack, command palette, sortable table, chat thread,
badge (+ StatusChip), theme toggle, center-morph modal (dialogs incl. LeaveDialog), morphing search, loaders/skeletons
(wrapping our ascii-reveal `Loading` where it is the loading surface), sortable-stack (Favorites / pins reorder),
motion card. **Kept as ours** (no beui equivalent): json-viewer, EmptyState, Kbd, ListRow, ScreenHeader,
SectionHeading, FaceStack/faces, RunGlyph, AccountRow, BottomBar, stepper, plain textarea, alert-dialog.
Every screen keeps every function; tests updated to the new markup; Chrome check per screen in both themes.

## 4. The Tether assistant
- **Identity**: Maestro is renamed **Tether** everywhere (crew list, bot id alias `maestro`→`tether`, routing copy,
  prompts). Its face is the eye-tracker (`components/faces/TetherFace.tsx`, ported from bencho `Watcher`, tokens mapped,
  `idle` mode for small/static uses, reduced motion = static).
- **Launcher**: bottom-right on every screen (above the phone bottom bar on mobile), the face in an ink circle, amber
  badge + soft ring when something needs you, ⌘J toggles, Esc closes.
- **Panel**: floating 384×560 (spring from the corner) or **docked** 420 px side panel beside the work (⤢/⤡); header with
  face, "Tether", context line ("knows <project> · sees the <page>"), New chat, close. History per project, persisted.
- **Brain**: a chat endpoint `POST /api/assistant` (streamed, SSE) that runs the project's **default crew agent** in a
  conversational mode **with Code Mode** (the `run_code` tool from PR #6) plus the connectors' Tether actions; the server
  injects context (current page, selected run/file, needs-you items). It answers from runs, code, the vault/graph and
  can act **only through approvals** (§5): it proposes runs as cards and starts them on the owner's click. Never
  auto-runs without approval.
- **Chat content** (beui.dev): **prompt-input** (＋ actions: Attach files → dropzone, Mention @file/@run/@bot, Run a
  workflow, Search code; model picker; send ↔ stop), **streaming-response** (caret while streaming, then copy · retry ·
  👍/👎 · "turn into a run"), **citations** (chips map to `file:line` → Code, `run` → run page, `note` → Graph), **approval
  card** both modes (Questions: multi-step, single choice auto-advances; Review: Approve / Request changes / Reject; both
  collapse to a one-line result), **todo-list** (the run's plan, live), **tool-approval** (Allow once / Always allow /
  Deny with parameters), **tool-result** (terminal / request output, streams then collapses, copy + retry), **file-diff**
  (streaming, live +/−), **code-block**. Auto-scrolls to new content unless the owner scrolled up. Comparison tables
  (aicss, MIT) render when Tether compares runs/models/bots (cost, time, tests, files).

## 5. Where the same components appear outside the chat
- **Approval card / tool approval**: Inbox items, run-page gates and Code Mode outside-world approvals — one component.
- **Todo-list**: run page (team plan) and Home "Running" detail.
- **Tool-result**: run timeline step logs, API client response pane, trigger delivery details.
- **File-diff**: run diff pane and Code's runs lens. **Code-block**: everywhere code is shown read-only.
- **Upload dropzone** (bencho, wired to real files): chat attachments, API import (Postman/OpenAPI), workspace import,
  vault import, ECC/pack import where files are accepted.
- **Picker** (bencho, given real options/value/onChange + keyboard): assign a bot to a step, a run to a project, agent/
  model choice, assign a goal.
- **Liq-create** (bencho): the sidebar compose button opens New run / workflow / bot / trigger / request (opaque fills so
  the goo effect works on our panels).
- **Action-node** (bencho): Builder step cards (actions fan out on hover: run from here, edit, duplicate, delete) and the
  integration palette (GitHub, HTTP request, Slack-style webhook). **Goals** (a goal node that spawns and tracks runs until
  met) is noted as a follow-up, not built here.
- **Data table** (beui sortable table / aicss): Runs list, API history, trigger deliveries, Graph notes list.
- **Sortable stack** (beui): Favorites/pins reorder and workflow step order lists.

## 6. Seamless sidebar collapse (fix on top of PR #6)
Rows keep the same left inset in both states — an 8 px gutter + a 40 px icon cell — so every icon's centre is identical
collapsed (56 px) and expanded; the width animates (240 ms) while labels fade/clip in place (no reflow); section headers
keep their height and become a hairline divider; the project row's glyph stays put and, when collapsed, turns into the
expand control on hover; tooltips align to the row centre. Test: icon positions measured before/after collapse are equal.

## 7. Testing
Web: Tailwind/token mapping (computed colours match Studio tokens in both themes), rules guards over beui; each migrated
component's behaviour on its screens; TetherFace (pointer follow, idle, reduced motion); launcher/panel/dock/⌘J/Esc;
streaming render, citations navigation, approval card both modes, tool approval, todo morphs, tool-result collapse,
file-diff counts, code-block copy; dropzone real file + size error; picker keyboard; liq-create menu; seamless collapse
positions. Node: `/api/assistant` streaming, context injection, approvals required before any run starts, history
persistence; rename `maestro`→`tether` with alias. Manual: Chrome check of every screen in both themes on real data.

## 8. Out of scope
Goals as a feature (follow-up), multi-user, voice input, AICSS Pro components, changing vendor CLIs' built-in tools.
