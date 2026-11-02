# Squads and Tickets: design

Date: 2026-10-30 · Branch: `feature/squads-tickets`, based on `feature/teams-telegram` (PR #30) + `feature/optional-run-budgets` (PR #31); `feature/runs-fix-themselves` gets merged in before the build starts. Mockup, approved by the owner ("this looks good"): canvas `WvgbPqG6rR4MaPwD7BUviV` board 8 "Squads v2" (interactive), board 9 "Agents write like people", board 10 "Tickets replace Goals" (interactive); copies in `docs/design/squads-tickets/`.

## 1. Intent (owner, 2026-10-30)

- "Rebrand teams and team runs and make them into one thing, similar to Grok bot, where you have different agents and the agents can communicate with each other. The chats between teams should look like real human messages, not LLM responses: summaries of what they are going to do, what they did, or what they are doing, just like how people ping each other on Slack." Then: "redesign it to be more dynamic looking and user friendly."
- "Instead of goals I want them to be tickets, serving the same purpose as software engineering feature tickets."

## 2. Goals

1. **Squads** replace Teams and team runs everywhere (sidebar, screens, routes' UI copy, Telegram copy, docs). One squad = people + agents + a project, living in Tether or a Telegram group. A team run is no longer its own concept: work handed to a squad is a run underneath, shown in the squad channel; the run page stays for details.
2. **Agents talk like people** (board 9): every agent message in a squad is one or two first-person sentences in the voice of a teammate on Slack: what I'll do, what I'm doing, what I did, or a question/hand-off with @mentions. No headings, lists, report formatting or pasted output. The work sits behind a collapsible **What I did** (reads/edits/commands with results, Full report, Diff, Open the run).
3. **Agents talk to each other** in the channel: hand-offs and review requests are visible @mentions ("@Lens mind checking the redirect check?"), replies go in threads, and a hand-off chip shows "Handed to Lens for a review".
4. **Board 8 v2 interactions**: the **Right now** strip (one card per busy agent: animated face, live status line, shimmering progress, timer, ticket name; a "You" card when something needs you; clicking a card filters the channel to that member, "Show everyone" clears), live typing line ("Lens is reading Bolt's change…"), reactions, hover actions (React, Reply in thread, Open the run), a **thread panel** on the right, the **ship card** (criteria/tests/approval chips, +/− bar, Ship it / See the diff / Not yet; after Ship it: "Shipped by you · PR #n merged · Undo" while undo is possible, else no Undo), **Chat | Map** toggle (map = who handed work to whom today; animated live edges), composer with **suggestion chips** and an **@ picker** that shows each agent's availability ("busy · will queue", "free now"). Sidebar: squads with live dot / unread / needs-you badges; Agents list with face and live status.
5. **Tickets** replace Goals (board 10): software-engineering tickets.
   - Fields: key (`<PROJECT>-<n>`, e.g. `WEB-142`, prefix from the project name, editable), type (feature, bug, chore, refactor — the existing `GoalType`), title, description, status (**Backlog, Todo, In progress, In review, Done, Canceled**), priority (Urgent, High, Medium, Low, None), assignee (an agent or a person) and reviewer (optional agent/person), squad, labels, **acceptance criteria** (a checklist; a criterion can be **auto-checked** by a command — the old goal check), linked PR(s), spent (shown, never a cap unless Spending caps is on and a limit is set), created-from link (chat, squad message, trigger), activity (human-style updates, runs, comments).
   - Views: **Board** (columns per status, cards with type tile, key, priority bars, title, labels, live progress + agent face for In progress, "needs you" chip and criteria/PR chips for In review, struck-through Done) and **List**; filters All / Needs me / Bugs / squad / assignee; **detail panel** with properties, criteria, ship banner in review ("All criteria met and Lens approved. Ship it?" Merge PR / Send back), activity and a comment box that takes @mentions (an @agent comment hands it work).
   - Flow: asking in any chat or squad to build/fix/change something creates a ticket (the goal card from #27 becomes a **ticket card**). Starting work moves it to In progress; a ready PR with criteria met → In review (needs you if approval is required); merge → Done. Loops ("keep main green") become **recurring tickets** (a ticket with an auto-checked criterion and a schedule/loop setting) — keep the loop engine, renamed in UI.
6. Migration: existing goals become tickets with no data loss (status map: paused not-started → Todo, paused → Backlog, active → In progress, needs_you → In review, met → Done, stopped → Canceled; check → auto-checked criterion; tracker items → criteria; assignees → assignee/reviewer; keys assigned in creation order per project). Existing teams become squads (same ids).

## 3. Message voice (server)

- A small **status writer** turns engine events into squad messages: plan accepted, work started, handed off, review requested, finished, blocked/needs you, failed/auto-fixing (from the auto-fix build). Input: the event + the step's final report (bounded); output: ≤ 2 sentences, ≤ 280 characters, first person, the agent's persona tone, @mentions resolved to real members, no markdown. Use the squad's cheapest configured model (free model first) with a strict prompt and a deterministic fallback template when no model is available or the output breaks the rules (validate: length, no headings/lists/code fences, mentions exist).
- Agent replies to pings (ping → answer) follow the same voice rules in their own prompt.
- Raw output is never posted in the channel; it's stored on the message for What I did / Full report.

## 4. Non-goals

- Slack squads (Phase 3, later). Ticket sprints/cycles, estimates and time tracking. Multiple projects per squad.

## 5. Anti-goals

- Agent messages that read like reports, or that hide failures: a failed or blocked step still says so plainly, with the reason (ties to the no-silent-failures rule).
- Losing goals' or teams' data in the rename; breaking Telegram squads.
- Duplicated concepts left behind (a "Teams" or "Goals" screen still reachable).

## 6. Constraints

1. Reuse: Teams P1/P2 code (`src/teams/*`, Telegram bridge), goals store/loop (`src/goals/*`), run page, Faces (`web/src/Face.tsx`, faceArt). Rename in UI and types where reasonable; keep old API routes as aliases for one release (`/api/goals` → `/api/tickets`, `/api/teams` → `/api/squads`).
2. Follow boards 8–10 exactly (layout, copy, motion with reduced-motion respected, Tether tokens, Geist). Accessibility as drawn: real buttons, aria-pressed on filter cards, labelled icon buttons, keyboard-reachable hover actions.
3. Tests: migration (goals → tickets, teams → squads) round trip; ticket status transitions from run events; keys; criteria auto-check; status writer (voice rules, fallback, mention resolution, failure messages); channel filters; thread panel; ship card states; @ picker availability; Board/List/filters/detail panel; Telegram squad messages use the new voice. Temp homes only. `npm run check` passes (known flaky `evolve.test.ts` timeouts under load).
4. Commits and PRs without AI attribution.

## 7. Left to the builder

Component split, where the status writer hooks into the engine/teams event flow, exact debounce of live updates, and the List view's columns.
