# Tether chats: full-screen chat, saved chats, mini chat: design

Date: 2026-10-28 · Branch: `feature/tether-chats` (stacked on `feature/free-models`, PR #15) · Mockup (approved): https://claude.ai/artifact/F3oPzyByj5yVXP9mZXs9GV (boards copied to `docs/design/chats/*.dc.html`)

## 1. Intent

The ⌘J assistant becomes a real chat app inside Tether, like Claude: a full-screen chat with past conversations you can reopen, a **Chats** section in the sidebar, and a New chat screen. The floating panel stays, redesigned as a **mini chat** for talking to Tether while on another tab. Chats are **per project**, as today (owner decided).

## 2. Goals

1. Many saved, titled chats per project; reopen any of them.
2. Sidebar **Chats** section above Workspace: a + (new chat), a "New chat" row, the 5 most recent chats, "All chats →".
3. **New chat** screen and full-screen **conversation** screen (mockup boards 1, 2).
4. **All chats** page that shows what each chat led to, live (board 3, the approved v2).
5. **Mini chat** replacing the floating panel (boards 4, 5): title switcher, new, full screen, close.
6. Mini and full screen show the same active chat; moving between them keeps the conversation.

## 3. Non-goals

- Chats across projects (one global history). Chats stay per project.
- Model-written chat titles (no extra model calls; see 6.2).
- Sharing or exporting chats.
- Light-mode or phone-width redesigns beyond what existing tokens/layout give.

## 4. Anti-goals

- Losing any existing chat or archived chat in the migration.
- Empty "New chat" files piling up (a chat exists only once it has a message).
- All chats becoming a decorative dashboard (stat tiles, sparklines): every element shows real chat/run data (owner called bento/sparkline dashboards "vibecoded").
- The mini chat and full screen getting out of sync (two different active chats at once without the person choosing it).

## 5. What exists today (reuse)

- `src/assistant/history.ts`: one chat file per project `<home>/assistant/<ws|_>.json` (`messages`, `always`, `once`; 200 messages max, atomic writes, 0600); New chat moves it to `<ws>.archive/<iso>.json` (last 20 kept, untitled, not reopenable).
- `src/assistant/routes.ts`: `GET /api/assistant` (chat view: messages, agent, model, models, openrouter), `POST /api/assistant` (SSE turn), `POST /api/assistant/new`, proposals (`/proposals`, `/proposals/:id` decide), tools (`/tools/:id`), feedback. `turn.ts` runs a turn; `Proposal {id, status: proposed|started|dismissed|failed, runId?}` lives on Tether messages; messages carry `cites`.
- Web: `web/src/assistant/` — `Panel.tsx`, `Launcher.tsx`, `Chat.tsx` (thread + `AIComposer` with the AI Elements model selector from PR #15), `Thread.tsx`, `cards.tsx`, `useAssistant.ts`, `useAssistantShell.ts` (modes closed / float / docked, ⌘J), `context.ts` (page + selection context).
- Sidebar `web/src/ui/studio/Sidebar.tsx` (`SideSection`, `SideRow`, collapsed icon rail), routes in `web/src/hooks.ts` (`Screen`, `#/<tab>/<id>`), screens switched in `App.tsx`.

## 6. Design

### 6.1 Storage (server)

- Per project folder `<home>/assistant/<ws|_>/`: one file per chat `<chatId>.json` = `{ id, title, created, updated, messages }` (same 200-message cap, atomic 0600 writes). Chat ids: short, URL-safe, unguessable not required (local app) but validated on every route (`^[A-Za-z0-9_-]{1,40}$`), never used to build paths without that check.
- `always` (calls allowed for good) stays per project in `<home>/assistant/<ws|_>/allow.json`; `once` moves onto the chat file (it is for the next turn of that chat).
- **Migration** (on first read of a project, idempotent): the current `<ws>.json` becomes a chat (if it has messages) and its `always` moves to `allow.json`; every `<ws>.archive/*.json` becomes a chat (created/updated from the archive file name timestamp). Titles per 6.2. Old files are removed only after the new ones are written. A test covers migration with both kinds.
- A chat file is written only when its first message is sent (no empty chats).
- No automatic deletion of chats (the archive's 20-cap goes away). Delete is explicit.

### 6.2 Titles

- Title = the first person message, first line, trimmed to ~60 characters at a word boundary. Renamable (≤ 120 chars). No model call.

### 6.3 Routes (server)

Keep existing routes working; add a `chat` id where a chat is meant:
- `GET /api/assistant/chats?ws=&q=` → `{ chats: ChatSummary[] }`, newest `updated` first. `q` searches title, message text, run ids and cited paths (case-insensitive substring).
- `ChatSummary = { id, title, updated, count, last /* first line of the last Tether reply */, kind: 'live'|'needs'|'done'|'failed'|'answer', outcome: OutcomeNode[], faces: string[] /* crew ids that worked on its runs */, cites: string[] }`.
  - `outcome`: "Asked" (first question) → each proposal ("Proposal", its title, state) → its run if started ("Run", run id, live status from the store: running / waiting on you / done · $cost / failed) → up to one "File" node when the run changed files (path + `+a −d`, if the run store already has it; otherwise omit).
  - `kind`: `needs` if a proposal is `proposed` or a started run is awaiting a person; `live` if a run is running; else the latest run's done/failed; else `answer`.
- `GET /api/assistant?ws=&chat=` → the chat view of that chat (no `chat`: the view has no messages, for a new chat).
- `POST /api/assistant` body gains `chat?`: absent → creates the chat on this first message; the SSE `start` event carries the `chat` id (and summary title).
- `PATCH /api/assistant/chats/:id` `{ title }`; `DELETE /api/assistant/chats/:id`.
- Proposal/tool/feedback routes take `chat` too (find the message within that chat).
- `POST /api/assistant/new` goes away (a new chat is a client state until its first message); keep it as a no-op returning `{messages: []}` only if something else calls it.

### 6.4 Navigation and sidebar (web)

- New routes: `#/chats` (All chats), `#/chats/new` (New chat), `#/chats/<id>` (a chat). Add `chats` to `Screen`.
- Sidebar **Chats** section between the top rows (Search/Home/Inbox/Runs) and **Workspace** (mockup Sidebar board): header "Chats" with a **+** (new chat), a "New chat" row (pencil icon), the 5 most recent chats (title rows, current one highlighted), "All chats →". Collapsed rail: one chat icon that opens All chats, with a tooltip. Uses `SideSection`/`SideRow`.
- The existing Runs and Favorites sections stay below Workspace as today (the mockup left them out for space only).

### 6.5 New chat screen (board 1)

Centered: Tether face (the existing `TetherFace`), "What should we look at in <project>?", a large composer (attach, model selector, project chip, dictate, send), four starter suggestions built from real state (what's running; why the last failed run failed, naming it, only if there is one; plan a change with the crew; explain a file), and the line "Tether reads your runs, code and notes. It changes things only through cards you approve." Sending creates the chat and moves to `#/chats/<id>`.

### 6.6 Conversation screen (board 2)

- Header: chat title button (menu: Rename, Delete with confirm), project chip, **Pop out ↘** (opens the same chat in the mini chat and returns to the previous screen), ⋯ (same menu).
- Centered 760 px column: the existing `Thread` and cards (tool line, citations, proposal card, streaming state), composer pinned at the bottom (same `AIComposer`).
- While this screen is open, the launcher and mini chat are hidden.

### 6.7 All chats page (board 3, approved v2)

- Left column: title "Chats", project name, **New chat**; search (6.3 `q`, debounced); filter pills with counts **All · Needs you · Live · Led to a run · Answers only**; rows with a status mark (live = pulsing blue dot, needs = amber ring that breathes, done green, failed red, answer = plain square), title, time, last-reply line, outcome chips (`run R-4F21`, `proposal waiting`…) and crew face chips. Rows animate in with a short stagger when the list or filter changes (respect `prefers-reduced-motion`).
- Right column: preview of the selected chat: title + meta (messages · model · time), **Pop out ↘**, **Open chat**; "What it led to" as a chain of action nodes (reuse the app's existing action-node component from Goals/Runs, PR #9) with a moving baton on a live edge; an inline approval bar when a proposal waits (**Dismiss / Approve**, the existing decide route); citation chips (open the run/file/note as elsewhere); the last exchange; a **Continue this chat** composer that sends a turn to that chat in place (streams into the preview).
- Live: the list refreshes while any chat is live or waiting (poll, modest interval) and after a turn.

### 6.8 Mini chat (boards 4, 5)

- Replaces the floating panel's look: 380×520 card above the launcher. Header: Tether face, the chat title as a button opening the **switcher** (find a chat, + New chat, recent chats with the current ticked, All chats →), **+** new chat, **⤢** open full screen (`#/chats/<id>`, or `#/chats/new` for an unsent new chat), **✕** close. A "Sees: …" line from the existing page context. Compact thread and a one-line composer with the model selector.
- The launcher, ⌘J, badge and needs-you behaviour stay as today.
- **Docked mode stays** (my call): same header as the mini chat, docked beside the screen as today.

### 6.9 Active chat

- One active chat per project in the web client (remembered per project in `localStorage`; a missing/deleted id falls back to a new chat). Opening a chat anywhere (sidebar, All chats, switcher, Pop out) makes it active, so mini and full screen always agree.

## 7. Constraints

- Follow the approved mockup boards and the app's current look (Studio Live tokens, Linear sidebar, beui kit + Tailwind where the assistant already uses it, action nodes). No new dependencies unless unavoidable.
- Chat files stay local, 0600, atomic; ids validated; no path built from unchecked input.
- Existing behaviour that must keep working: turns, proposals → runs, tool approvals, feedback, citations, the OpenRouter models in the model selector (PR #15), page/selection context, ⌘J.
- Tests: migration (current chat + archives, idempotent, nothing lost), titles, summaries/`kind`/`outcome` from fixtures, search, rename/delete, new chat created on first message, routes; web: sidebar Chats section, New chat → chat route, All chats filters/preview/continue, mini switcher, active chat shared between mini and full screen.

## 8. Decided by the owner

- Chats per project, as today.
- Full-screen chat like Claude with past chats under **Chats** above Workspace, a New chat button and screen.
- The current panel becomes a smaller mini chat for other tabs.
- All chats must be dynamic (approved v2: filters, live states, outcome chain, preview, inline approve, continue in place).

## 9. Left to the builder

- Exact file/module names, chat id format, poll intervals, debounce.
- Whether `ChatSummary` is computed on request or cached (it must reflect live run status).
- Keyboard shortcut for New chat (pick one that does not clash with existing keys).

## 10. My calls (owner: check)

- Titles from the first message, no model call.
- No automatic deletion of chats (the old 20-archive cap goes away).
- Docked mode kept, with the mini chat's header.
- A new chat is not saved until its first message.
- Starter suggestions use real project state; the "why did it fail" one only appears when a failed run exists.
