# Tether chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Many saved, titled Tether chats per project: a full-screen chat (New chat + conversation screens), a sidebar
Chats section, a live All chats page, and the floating panel redesigned as a mini chat that shares the active chat.

**Architecture:** The server keeps one file per chat in `<home>/assistant/<ws|_>/` (plus `allow.json`), migrating the old
`<ws>.json` + `<ws>.archive/` layout on a project's first read. Routes gain a validated `chat` id; a chat file is born with
its first message and the SSE `start` event names it. Summaries (kind, outcome chain, faces, cites) are computed per
request from the chat files and the run store. The web lifts the assistant's shell and chat hook into `App`, so the mini
chat and the full-screen screens show one active chat (remembered per project); All chats has its own poll and a
second chat hook for the preview's "Continue this chat".

**Tech Stack:** Node 22, TypeScript, React 19, beui kit + Tailwind (assistant), Studio Live tokens, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-28-tether-chats-design.md` (§8 and §10 are decided). Mockups:
`docs/design/chats/{Sidebar,Main,Conversation,AllChats,Mini,MiniSwitch}.dc.html` (layout, content, behaviour; build
with the app's components and tokens, not their inline styles).

## Global Constraints

- Work only in `.claude/worktrees/free-models` on `feature/tether-chats`. No new dependencies; do not commit `package-lock.json`.
- Chat ids match `^[A-Za-z0-9_-]{1,40}$` and are not `allow`; checked on every route (400) and again in the path builder (throws) before any path is built.
- Chat files: `{ id, title, created, updated, messages, once }`, 200 messages max, atomic (tmp + rename), mode 0600; `allow.json` = `{ always: string[] }`.
- A chat file is written only when its first message is sent. No automatic deletion of chats; delete is explicit.
- Title = first person message, first line, whitespace collapsed, ≤ 60 chars cut at a word boundary (+ `…`); rename ≤ 120 chars; no model call.
- Migration never deletes an old file before the chat it became is written; an unreadable old file stays where it is.
- Existing behaviour keeps working: turns, proposals → runs, tool approvals, feedback, citations, OpenRouter models in the picker, page/selection context, ⌘J, docked mode.
- UI: Studio tokens only, beui `Button`/`SearchField`/`SegmentedControl`/`Dialog`, `SideSection`/`SideRow`, `TetherFace`, `Thread`, `AIComposer`, `ActionNode`, `FaceStack`; real buttons with names; All chats animations off under `prefers-reduced-motion`.
- Copy (verbatim): "What should we look at in <project>?" · "Tether reads your runs, code and notes. It changes things only through cards you approve." · filters "All · Needs you · Live · Led to a run · Answers only" · "What it led to" · "Continue this chat" · "Pop out ↘" · "Open chat" · "All chats →" · "New chat".
- Commits: plain conventional messages, no trailers, no mention of AI tools.

## Decisions the spec leaves to the builder

- Chat id: `c` + base36 time + 6 hex random (`newChatId()`). Migrated ids are deterministic: an archive → `a-<file name>`, the current chat → `h-<first message id>` (sanitized, ≤ 40), so a re-run after a crash overwrites instead of duplicating; a target is only (re)written when it has fewer messages than the source.
- Summaries are computed on request (they must show live run status); the sidebar/switcher poll every 10 s, All chats every 3 s while a chat is live or waiting, else 15 s; search is debounced 250 ms.
- New chat shortcut: ⌘⇧O (Ctrl ⇧O elsewhere); ⌘N stays New run.
- `ChatSummary.cites` is `Cite[]` (not `string[]`) so the preview's chips can open the run/file/note.
- File outcome nodes are omitted: the run store has commits but no diffstat (spec: "otherwise omit").
- The All chats preview uses its own chat hook (preview ≠ open); "Open chat" and "Pop out" make a chat active. After a preview turn ends the list refreshes, and the shared chat reloads when it is the same chat.
- Mini chat is hidden on `#/chats/new` and `#/chats/<id>`; visible on `#/chats` (Pop out from the preview opens it there).
- `POST /api/assistant/new` is removed (only the web client called it).

## Review Focus

- Old app writes `<ws>.json` again after migration (owner switches branches) → migrated as a new chat, nothing lost → Task 1 test "re-migrates a chat an older build wrote".
- A route with `chat` = `../x`, `allow`, or 41 chars → 400 and no file touched → Task 2 test.
- A chat deleted while its turn streams is not recreated by the turn's end → Task 2 test.
- `#/chats/<id>` for a deleted chat (or another project's) → falls back to `#/chats/new` → Task 6 test.
- Switching chats mid-turn never appends the old turn's text to the new chat → Task 4 test.

---

### Task 1: Chat storage, titles and migration

**Files:** Rewrite `src/assistant/history.ts`; modify `src/codemode/connectorsView.ts` (read `allChats`); create `test/assistant-history.test.ts`.

**Produces (`src/assistant/history.ts`):**
- `MAX_MESSAGES = 200`, `TITLE_MAX = 120`, `isChatId(v: unknown): v is string`
- `interface Chat { id; title; created: number; updated: number; messages: ChatMessage[]; once: string[] }`
- `newChatId(): string`, `titleOf(text: string): string`
- `listChats(home, ws): Chat[]` (newest `updated` first), `readChat(home, ws, id): Chat | undefined`, `saveChat(home, ws, c: Chat)`, `deleteChat(home, ws, id): boolean`
- `loadAllow(home, ws): string[]`, `saveAllow(home, ws, always: string[])`
- `allChats(home): Chat[]` (every project; migrates each old-layout slug first)
- Every read migrates the project first (internal `migrate(home, ws)`).

- [ ] **Step 1: Write the failing tests** (`test/assistant-history.test.ts`)
  - `titleOf`: `'  why did\nit fail'` → `'why did'`; 80-char line → ≤ 61 chars ending `…`, cut at a space; `''` → `'New chat'`.
  - `isChatId`: true for `c1`, `a-2026`; false for `../x`, `allow`, `''`, 41 chars, `a/b`, a number.
  - save → read round-trip; file mode `0o600`; 250 messages saved → 200 kept; `deleteChat` removes; `deleteChat(…, 'allow')` throws and `allow.json` stays; `listChats` sorted by `updated` desc and skips `allow.json`, tmp files and files whose `id` differs from their name.
  - migration: old `api.json` (`messages` 2, `always ['GET x']`, `once ['y']`) + `api.archive/2026-10-27T10-00-00-000Z.json` + `…T11-…json` → `listChats` gives 3 chats with titles from the first `you` message, archive `updated` = `Date.parse('2026-10-27T10:00:00.000Z')`, the current chat keeps `once`; `loadAllow` = `['GET x']`; `api.json` and `api.archive/` are gone; second `listChats` still 3.
  - an unreadable archive file stays on disk; the others migrate.
  - an old file with only `always` (no messages) → no chat, allow merged, file removed.
  - re-migrates a chat an older build wrote: after migration, write a new `api.json` with a different first message → next `listChats` has 4 chats.
  - `allChats(home)` returns old-layout `_`.json chats (migrated) and new-layout chats of two projects.

- [ ] **Step 2: Run** `npx vitest run test/assistant-history.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement** history.ts as above. Folder `<home>/assistant/<slug>/` (slug rule unchanged: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` else `_`). Archive stamp: `Date.parse(name.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'))`; `created` = first message `at` (else stamp), `updated` = stamp (else last message `at`). Old files are removed after every write succeeded; the archive dir only when empty. connectorsView's `chats()` becomes `allChats(home)`.

- [ ] **Step 4: Run** the new test and `npx vitest run test/connectors-map.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat(assistant): one file per chat per project, titles, and migration of the old chat and archives`

### Task 2: Chat-scoped turns and routes

**Files:** modify `src/assistant/types.ts`, `src/assistant/turn.ts`, `src/assistant/routes.ts`, `test/assistant.test.ts`.

**Consumes:** Task 1. **Produces:**
- `ChatView` gains `id?: string; title?: string`; `StreamEvent` start = `{ type: 'start'; you; id; chat: string; title: string }`.
- `runTurn(c, { ws, root, chat?: Chat, body }, emit, signal)`: no `chat` → a new chat (`newChatId()`, `titleOf(message)`) saved with the first message; grants = `loadAllow` + `chat.once`; the end re-reads the chat and saves only if it still exists.
- `GET /api/assistant?ws=&chat=` (no chat → `messages: []`; unknown → 404; bad id → 400). `POST /api/assistant` body `chat?`. `POST /api/assistant/proposals`, `/proposals/:id`, `/tools/:id`, `/feedback/:id` require body `chat`. "always" goes to `allow.json`, "once" to the chat. `/api/assistant/new` removed.

- [ ] **Step 1: Update/add tests** in `test/assistant.test.ts`: `turn()` helper passes `chat` through; existing tests send `chat: done.chat` from the start event; new tests:
  - first message creates a chat: start event has `chat` matching `/^c[a-z0-9]+$/` and `title: 'what is the limit?'`; `GET ?ws=api&chat=<id>` returns 2 messages + title; `GET ?ws=api` returns `messages: []`; a second turn with that `chat` appends (4 messages) and creates no other chat file.
  - bad ids: `GET ?chat=../x` 400, `chat=allow` 400, `POST /api/assistant` with `chat: 'nope'` 404, proposals route without `chat` 400.
  - tools "always" lands in `loadAllow(home,'api')`; "once" on `readChat(...).once` and is cleared by the next turn.
  - a chat deleted (`deleteChat`) while the agent is mid-turn is not recreated (Scripted agent deletes it inside `run`).
  - replace the "archives on New chat" test with: two first messages → two chats.

- [ ] **Step 2: Run** `npx vitest run test/assistant.test.ts` → FAIL.
- [ ] **Step 3: Implement** types/turn/routes as above (route helper `chatIn(c, ws, v)` → 400/404, then the `Chat`).
- [ ] **Step 4: Run** the test file and `npm run typecheck` (server part) → PASS.
- [ ] **Step 5: Commit** `feat(assistant): turns and cards are scoped to a chat; a chat is created by its first message`

### Task 3: Chat summaries, search, rename and delete

**Files:** create `src/assistant/summary.ts`, `test/assistant-summary.test.ts`; modify `src/assistant/types.ts`, `src/assistant/routes.ts`, `test/assistant.test.ts`.

**Produces:**
- types: `OutcomeNode { kind: 'Asked' | 'Proposal' | 'Run'; label: string; state: string; tone: 'live' | 'needs' | 'done' | 'failed' | 'idle'; runId?: string }`, `ChatSummary { id; title; updated; count; last; kind: 'live' | 'needs' | 'done' | 'failed' | 'answer'; outcome: OutcomeNode[]; faces: string[]; cites: Cite[] }`.
- `summarize(c: Chat, rows: Map<string, Row>, engine: LiveProbe): ChatSummary`, `matches(c: Chat, q: string): boolean` (`Row = ReturnType<Store['listRows']>[number]`).
- Routes: `GET /api/assistant/chats?ws=&q=` → `{ chats }` (q ≤ 200 chars), `PATCH /api/assistant/chats/:id` `{ ws, title }` → `{ chat: ChatSummary }` (title trimmed, 1–120, else 400; `updated` unchanged), `DELETE /api/assistant/chats/:id?ws=` → `{ ok: true }` (404 if unknown).

Rules: Asked = first `you` message (`titleOf`), `answered`/done when a Tether reply exists, else `asked`/idle. Proposal: label = task first line ≤ 60; proposed → `waiting on you`/needs, started → `approved`/done, dismissed → `dismissed`/idle, failed → `could not start`/failed. Run (after its started proposal): waits (pending, planReady, an `awaiting` step) → `waiting on you`/needs; `rowLive` → `running`/live; done → `done · $0.12`/done; error → `failed`/failed; else its status (`stopped`, `paused`, `interrupted` for a running row that is not live)/idle. `kind`: any needs → needs; any live run → live; else the last run failed → failed, any run → done; else answer. `faces`: agent bots (`crewFor`) of the started runs. `cites`: unique (kind + path/id + line), ≤ 8. `last`: first non-empty line of the last Tether reply's text (else its error), ≤ 140. `matches`: case-insensitive substring of title, any message text, run ids, cite paths/ids.

- [ ] **Step 1: Write failing tests** (`test/assistant-summary.test.ts`, real `Store.open(':memory:')` + `seedRun`, fake engine `{ isLive: id => live.has(id), isPlanning: () => false }`):
  - answer-only chat → kind `answer`, outcome `[Asked answered done]`, faces `[]`.
  - proposed proposal → kind `needs`, outcome `Asked → Proposal 'waiting on you' needs`.
  - started run, live → kind `live`, Run node `{ label: 'r1', runId: 'r1', state: 'running', tone: 'live' }`, faces `['coder']`.
  - run with `approval.requested` → needs; finished done with node cost 0.12 → `done · $0.12`, kind `done`; error → `failed`.
  - two runs: older failed, newer done → kind `done`.
  - cites deduped; `last` = first line of the last reply.
  - `matches`: by title, message text, run id `r1`, cite path `src/limit.ts`; not by `zzz`.
  - routes (in `test/assistant.test.ts`): list newest first with `q` filtering; PATCH renames (and 400 on `''` / 121 chars); DELETE removes then 404.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** both files → PASS.
- [ ] **Step 5: Commit** `feat(assistant): chat summaries with what each chat led to, search, rename and delete`

### Task 4: Web data layer: routes, API, active chat, chat hook

**Files:** modify `web/src/hooks.ts`, `web/src/hooks.test.tsx`, `web/src/assistant/api.ts`, `web/src/assistant/useAssistant.ts`; create `web/src/assistant/useAssistant.test.tsx`; minimal caller updates so it compiles (`Assistant.tsx`, `Chat.test.tsx`, `Assistant.test.tsx`).

**Produces:**
- `Screen` gains `'chats'`; `TAB_LABEL.chats = 'Chats'`; `#/chats`, `#/chats/new`, `#/chats/<id>` parse to `{ tab: 'chats', id? }` (`SCREENS` unchanged: not a G-key screen).
- `assistantApi`: `chat(ws, chat?)`, `chats(ws, q?)`, `rename(ws, id, title)`, `remove(ws, id)`, and `decide/turnIntoRun/tool/feedback(ws, chat, …)`; `SendBody.chat?`; re-export `ChatSummary`, `OutcomeNode`.
- `useActiveChat(ws): [string | undefined, (id: string | undefined) => void]` (localStorage `tether.assistant.chat.<ws|_>`).
- `useAssistant(ws, chatId, enabled, on?: { created?(id): void; gone?(id): void })` → `Assistant` gains `chatId?`, `title?`, `refresh()`, `rename(title)`; loses `newChat`. `created` must make `chatId` follow; `gone` fires on a 404.

- [ ] **Step 1: Failing tests**: `parseHash('#/chats/new')` → `{ tab: 'chats', id: 'new' }`, `hashFor({ tab: 'chats', id: 'c1' })` → `'#/chats/c1'`; hook: send without a chat → body has no `chat`, start `{ chat: 'c9', title: 'hi' }` → `created('c9')`, `title` 'hi', no reload GET; a 404 load → `gone('cX')`; switching `chatId` mid-turn aborts it and the new chat shows no "Stopped." message; `useActiveChat` keeps one id per project.
- [ ] **Step 2: Run** `npx vitest run --project web web/src/assistant web/src/hooks.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Load key `${ws}\0${chatId}`; on `start` for a new chat set the key refs before calling `created`; switching key aborts the turn (as switching project does today).
- [ ] **Step 4: Run** → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): chat routes, chat API and an active chat per project`

### Task 5: Sidebar Chats section

**Files:** modify `web/src/ui/studio/Sidebar.tsx`, `web/src/ui/studio/Sidebar.test.tsx`, `web/src/ui/studio/shell.css` (the `All chats →` row tone only).

**Produces:** `SidebarProps.chats: { list: ChatSummary[]; current?: string /* '' All chats, 'new', or a chat id */; onNew(): void; onOpen(id): void; onAll(): void }`. Inside `nav[aria-label=Main]` between the top rows and Workspace: `SideSection id="chats" title="Chats"` with a `+` (New chat) action; rows "New chat" (Pencil, hint ⌘⇧O), the 5 most recent titles, "All chats →" (name "All chats"). Collapsed: one row (MessagesSquare, "Chats", tooltip) that opens All chats.

- [ ] **Step 1: Failing tests**: nav names now `Search, Home, Inbox, Runs, Chats, New chat, New chat, <5 titles>, All chats, Workspace, …`; only 5 of 7 chats; current chat row `aria-current="page"`; clicks call `onNew`/`onOpen('c2')`/`onAll`; collapsed rail shows one "Chats" row that calls `onAll`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(web): Chats section in the sidebar above Workspace`

### Task 6: Full-screen chat: New chat and conversation screens, App wiring

**Files:** modify `web/src/assistant/Chat.tsx` (split `ChatComposer`, `wide` prop), `web/src/assistant/assistant.css`, `web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/assistant/Assistant.tsx`; create `web/src/chats/NewChat.tsx`, `web/src/chats/Conversation.tsx`, `web/src/chats/chats.css`, `web/src/chats/chats.test.tsx`.

**Produces:**
- `ChatComposer({ chat, project, context, placeholder, draft?, onDraft? })`; `Chat({ …, wide? })` (760 px column).
- `NewChat({ chat, project?, context, runs: RunRow[], lastFile?, onGo })`: TetherFace, heading, composer, 4 starters (what's running; `Why did R-XXXX fail?` only when a project run has status `error`, newest; plan a change with the crew; explain `<lastFile>` or "Explain a file"), footnote. A starter fills the composer and focuses it.
- `Conversation({ chat, project?, context, onGo, onPopOut, onDeleted })`: header (title menu: Rename, Delete with a confirm dialog; project chip; Pop out ↘; ⋯ same menu), `Chat wide`.
- App: shell + `useActiveChat` + one `useAssistant` lifted here (enabled while the mini is open or on `#/chats…`); the route's chat id becomes active (also on project switch); `created` → active + `#/chats/<id>` when on `#/chats/new`; `gone` → `#/chats/new`; Pop out → open the mini (float) and go to the last non-chat screen; ⌘⇧O → `#/chats/new`; mini and launcher hidden on `#/chats/new` and `#/chats/<id>`; `#/chats` renders nothing until Task 8 adds All chats.

- [ ] **Step 1: Failing tests** (App.test with `routeApi`, streamTurn mocked): sidebar New chat → `#/chats/new` with "What should we look at in <project>?"; ⌘⇧O does the same; sending there → `#/chats/c9` showing the reply, no launcher; the failed-run starter appears only with an `error` run; `#/chats/gone` (404) → `#/chats/new`; Pop out → previous screen with the mini open on the same chat (its title in the header); Rename and Delete call PATCH/DELETE and Delete lands on `#/chats`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(web): full-screen Tether chat with a New chat screen, shared with the mini chat`

### Task 7: Mini chat

**Files:** modify `web/src/assistant/Panel.tsx`, `web/src/assistant/Assistant.tsx`, `web/src/assistant/context.ts`, `web/src/assistant/assistant.css`, `web/src/assistant/Assistant.test.tsx`; create `web/src/assistant/ChatSwitcher.tsx`.

**Produces:** Panel header = TetherFace (22), `ChatSwitcher` (title ▾ → dialog "Switch chat": "Find a chat" field, + New chat, recent chats with the current ticked (`aria-current`), "All chats →"), `+` New chat, ⤢ "Open full screen", dock/undock (kept), ✕ close; a `Sees: <page>[ · <selection>]` line (`contextLine(route)`: run ids as `R-XXXX`); float size 380×520. `Assistant` props: `{ shell, chat, chats, project, route, phone, hidden, onPick(id?), onFullScreen(), onAllChats(), onGo }`.

- [ ] **Step 1: Failing tests**: switcher lists chats, filters by "Find a chat", picking one calls `onPick('c2')`; + New chat → `onPick(undefined)`; All chats → `onAllChats`; ⤢ → `onFullScreen`; `Sees: Runs · R-0001`; existing launcher/⌘J/dock/phone tests still pass; `hidden` renders no launcher and no panel.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(web): the floating panel becomes a mini chat with a chat switcher`

### Task 8: All chats page

**Files:** create `web/src/chats/AllChats.tsx`, `web/src/chats/AllChats.test.tsx`; modify `web/src/chats/chats.css`, `web/src/App.tsx`.

**Produces:** `AllChats({ ws?, project?, active?, onOpen(id), onPopOut(id), onNew(), onGo, onTurnDone(id) })`. Left: h1 "Chats", project name, New chat; `SearchField` "Search chats" (debounced 250 ms → `q`); `SegmentedControl` filters with counts; rows (status mark with a name, title, time, last line, outcome chips `run R-XXXX` / `proposal waiting` / `answer only`, `FaceStack`), staggered in (`--k`), list re-keyed on filter + q. Right (`section aria-label="Chat preview"`): title + meta, Pop out ↘, Open chat; "What it led to" as compact `ActionNode`s joined by links (a moving baton on the link into a live node; Run nodes have "Open run"); approval bar (Dismiss / Approve via `decide`) when a proposal waits; cite chips (`routeOf`); last exchange; "Continue this chat" form streaming into the preview. Poll 3 s while any chat is live/needs, else 15 s; refresh after a preview turn. CSS: `@media (prefers-reduced-motion: reduce)` turns off row, mark and baton animations.

- [ ] **Step 1: Failing tests**: counts per filter, "Needs you" shows only the needs chat; selecting a row previews it (title, outcome nodes, cites); approve calls decide with `start` and the chat id; continue sends `{ chat: 'c2', message }` and the streamed reply shows in the preview; Open chat → `onOpen`, Pop out → `onPopOut`; search types → `GET …&q=readme` after the debounce; CSS rule for reduced motion exists.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(web): All chats page with live states, what each chat led to, inline approval and continue in place`

### Task 9: Real check and full verification

- [ ] `npm run build`; temp home; `node dist/cli.js workspace add <scratch repo> --home <tmp>`; link the orchestrator bot to `mock`; `node dist/cli.js serve --home <tmp> --port <free>`; drive New chat → conversation → All chats → mini in a browser if available.
- [ ] Migration on a COPY of a made-up home layout (old `<ws>.json` + archives) via the built server: chats listed, old files gone, allow kept.
- [ ] `npm run typecheck`, `npm test` (baseline: 3 triggers path tests, 2 evolve probe timeouts), `npm run build` pass; fix anything found (own commit); push.
