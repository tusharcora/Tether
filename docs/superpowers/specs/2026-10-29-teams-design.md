# Teams: agents as teammates in Tether, Slack and Telegram: design

Date: 2026-10-29 · Branch: `feature/teams` (from main) · Mockup (approved): https://claude.ai/artifact/1FvSbeztqQPHixmjw8zbwv (boards copied to `docs/design/teams/*.dc.html`)

## 1. Intent

Tether's agents become **teammates**: members of teams where people talk to them like coworkers, @mention them, hand them tasks and longer "loop work", and see them ping people, hand work to each other, and ship through the same runs, gates and approvals Tether already has. A team lives **inside Tether** (its own team screen), **in a Slack channel**, or **in a Telegram group**. Agents are shared: one agent can be in many teams and carries one memory across them. This also gives the owner a phone remote for Tether (approvals, status, starting work) through Slack or Telegram.

## 2. Goals

1. Teams of people + agents, each living in exactly one place: Tether, a Slack channel, or a Telegram group (separate teams, not mirrors).
2. Agents answer when @mentioned or handed work; they can run tasks and **loop work** on their own, within the team's limits and approval rules.
3. Teammates see everything in the team; **any teammate can approve** by default, or only chosen people per team.
4. One **memory per agent** across all its teams: lessons, not transcripts; viewable and deletable.
5. Slack and Telegram surfaces use their native features (mockup boards 4, 5): status command, messages that update in place, approval buttons with a diff preview, link previews, threads, typing/working indicator; Telegram pinned live status, inline keyboards, commands, screenshots read by a vision model, voice notes transcribed when a transcription model is connected.
6. Everything runs on the owner's Mac while Tether runs; no Tether-operated server.

## 3. Non-goals

- iMessage and WhatsApp (owner chose Slack + Telegram only).
- Agents acting unprompted (no proactive check-ins); they act only when pinged, handed a task, or continuing a loop they were given.
- Mirroring one team across several places.
- Multi-user Tether accounts or permissions beyond the per-team approver rule.
- Hosted relay/webhook servers.

## 4. Anti-goals

- An agent leaking one team's conversation into another team (memory holds lessons, never quotes or who-said-what).
- Anyone outside a team's approver rule shipping a change, or anyone outside the team driving its agents.
- Unbounded spend: every task and loop is capped by the team's limits; loops by their own limits too.
- Tokens or keys in config files, logs, argv, URLs or API responses.
- Rebuilding Goals, runs, approvals or the assistant instead of reusing them.

## 5. What exists today (reuse)

- **Crew bots** (`src/bots.ts`, `src/crew.ts`, `src/bindings.ts`, web Crew lineup/bench/docked card): identity, look/face, persona, agent+model binding (incl. OpenRouter/NVIDIA free models), imported ECC skills. **Agents = Crew bots** plus a specialty and memory (owner accepted the guess).
- **Runs/engine** (`src/engine.ts`): worktree per run (`start` takes a `ref`), gates, approval nodes (`awaiting` → paused), run-wide `autoApprove`, attention items (`src/attention.ts`, Home "Needs you", Inbox). There are **no** approval levels today; §6.3 defines them. Nothing opens or merges PRs today (`src/pr.ts` only uses PRs as triggers); §6.3 adds that.
- **Lessons** (`src/lessons.ts`): per-bot lessons learned from finished runs (`reflect`), with provenance. **Agent memory extends this** (§6.2), it is not a second store.
- **Goals** (`src/goals/`: `Goals` loop, `GoalStore`, routes, web Goals screen): outcome loops with a check command, limits (money/runs/time), `needs_you`. **Loop work = a Goal owned by an agent and a team.**
- **Assistant turns** (`src/assistant/turn.ts` `runTurn`, Code Mode read-only tools, cites, proposals): the engine for an agent's reply in a team.
- **Accounts + secret store** (`src/accounts/`: registry kinds incl. `key`, `secretStore` Keychain/0600 file, routes, web Settings → Accounts): where the Slack and Telegram tokens go.
- **Models**: images go to vision-capable models (e.g. Nemotron 3.5 Super VL); OpenAI-compatible endpoints (Groq preset exists; OpenAI) can expose `/audio/transcriptions` for voice notes.

## 6. Design

### 6.1 Data

- **Agent profile** (extends a Crew bot): `specialty` (short label, e.g. "code"), `personality` (≤ 500 chars, the bot's persona if set), and **memory** = the bot's existing lessons (`src/lessons.ts`) extended with a `team` tag, a cap (~200 per agent, oldest dropped) and per-lesson delete / Forget all (builder check: one lesson system, my call).
- **Team**: `{ id, name, place: 'tether' | 'slack' | 'telegram', link (Slack channel id / Telegram chat id), project (workspace id), agents: botId[], people (Tether: the owner; Slack/Telegram: whoever is in the channel/group), approvers: 'any' | personId[], level: 'tight' | 'balanced' | 'loose', limits: { usdPerDay, runsPerDay } }`, stored under `<home>`, 0600.
- **Tether team messages**: stored locally per team (append-only log, capped like chats). Slack/Telegram teams: the platform holds the conversation; Tether keeps only what it needs (message ids it must edit, which agent posted what, pending approvals).

### 6.2 Agents in a team

- **Pinged** (@Agent, or a reply in a thread an agent is in): the agent answers with one turn built on `runTurn`: its persona + specialty + its memory lessons + the team's recent messages (bounded) + the project context, read-only Code Mode tools, cites. One answer per ping.
- **Handed a task** ("@Bolt fix X", or `/tether run`): the agent acknowledges, then **starts a run** itself on the team's project: a **workflow run** whose work step runs on the mentioned agent's own binding, then the project's gates, then the team level's approvals (§6.3) (builder check, my call: not a manager-led team run, so "Bolt does it" stays literal). A plain question where the agent thinks work would help gets a **proposal card** (Start run / Edit / Dismiss) instead; loops on `ask` propose too. Progress is posted as one message that **updates in place** (step track), results and failures posted back; it may @mention another agent for the next step (e.g. Lens to review), which hands that step on.
- **Loop work** ("@Probe keep main green… stop at $5"): the agent creates a **Goal** (loop) owned by itself and the team, with the check and limits taken from the ask (it confirms them in its reply), and posts a short update after each run; the Goal's `needs_you` becomes a team approval/ask.
- **Hand-offs**: an agent may @mention a teammate or another agent. A hand-off for **work** starts a new run on the **previous run's branch** (`ref`), so changes carry over; a hand-off for **review** (e.g. @Lens) is a read-only answer that reviews that run's diff and posts a verdict, not a new run. Both count toward the same limits; the task's progress message tracks the chain (my call).
- **Reject**: the card asks for an optional reason; the agent does **one** automatic rework run on the same branch with the reason, then asks the team before trying again (my call).
- **Limits**: each team's `usdPerDay`/`runsPerDay` caps all its agents' runs and answers; when hit, **nothing new starts** (agents say so); runs already in flight finish under their own run budget (my call). Free models cost $0, so `runsPerDay` is what caps them.
- **Memory**: after a task or loop ends, the agent may save **at most a few lessons** (facts about the code, preferences, what worked/failed), phrased without quoting people. Lessons are visible on the agent profile, deletable one by one or all; a team setting "don't learn from this team" (my call, default off).

### 6.3 Approvals and who can act

- **Levels (owner decided, ship-gated):** **Tight**: a person approves the plan *and* the result. **Balanced** (default): agents plan and code freely; a person approves before anything ships. **Loose**: agents ship on their own when gates pass, within the team's limits.
- **Ship (owner decided)**: approving pushes the run's branch and **opens a GitHub PR** (via the connected GitHub account / `gh`), posted back as a link card. An agent **merges** a PR only when a teammate who may approve tells it to ("@Scout merge it once that turn works"), and only after the PR's checks pass; the merge is posted back.
- Approval cards (plan approvals at Tight, ship approvals, goal asks) are posted into the team with **Approve / Reject / Review diff** (Tether), **Approve / Reject / Full diff ↗** (Slack), **Approve / Reject / Diff** (Telegram).
- When pressed, Tether checks the presser against the team: `approvers: 'any'` → anyone in the channel/group; a list → only those people (others get an ephemeral/short "Only <names> can approve here"). The card is edited to "Approved by <name> · <time>" or "Rejected…".
- Who can ping or hand work to agents: anyone in the team (channel/group members). Starting runs is capped by the team limits.

### 6.4 Tether team screen (board 1) and sidebar

- Sidebar **Teams** section above Chats: + (new team), each team with its place mark (#, S, T) and a status dot (blue working, amber needs you).
- Team screen: header (name, place, member faces, Add member, settings); channel with messages, @mentions, agent role pills, loop cards (progress, cost, live chain of runs → check), run cards, approval cards; composer with @-autocomplete for agents and people; right panel **Working now** (loops/tasks with progress; needs-you), **Members** (people; agents with specialty and live state: idle / coding / looping / reviewing), **Rules** (approvers, level, limits, place).

### 6.5 New team (board 2)

Name; **where it lives** (Tether / Slack channel picker, needs Slack connected / Telegram group with a pairing code); agents to add (Crew bots with specialty; + New agent → Crew); who can approve (any teammate / chosen people); approval level; limits per day; project.

### 6.6 Agent profile (board 3)

On the Crew bot (docked card or a profile view): personality, specialty, model (existing Runs on picker), skills chips (existing ECC skills), **memory** list with team + date, ✕ per lesson, Forget all; teams it's in with its state in each; recent work; "Answers when @mentioned, or handed a task or loop".

### 6.7 Slack (board 4)

- Connect in Settings → Accounts → **Slack**: Tether shows a ready-made **app manifest** (Socket Mode on; bot scopes for reading/writing messages in channels it's invited to, `chat:write.customize` so each agent posts with its own name and icon, commands `/tether`, interactivity); the person creates the app in their workspace, installs it, and pastes the **bot token** (`xoxb-`) and **app-level token** (`xapp-`) into Tether once; stored in the secret store; verified with one API call.
- Socket Mode: Tether opens the connection itself (no public URL); uses the platform's built-ins where possible (`fetch` + the global `WebSocket`; a dependency only if unavoidable).
- Features (board 4): `/tether status` (summary card with buttons), `/tether run <task>`; agents post as themselves; run progress message **edited in place**; approval card with a short diff preview and buttons; finished PRs/runs as compact link cards; threads (an agent answers in the thread it was pinged in); a "working…" line while an agent is busy (posted/updated message, since Slack bots have no typing indicator); message shortcut "Ask Tether about this message".

### 6.8 Telegram (board 5)

- Connect in Settings → Accounts → **Telegram**: paste the bot token from @BotFather once (secret store, verified with `getMe`). Long polling (`getUpdates`), no public URL.
- **One shared Tether bot**; agent replies are labelled with the agent's name (my call; per-agent bots later if wanted). Linking a group: add the bot, send `/pair <code>` shown in New team.
- Features (board 5): inline keyboards (Approve / Reject / Diff; Start run / Edit / Dismiss), messages **edited in place** for live progress and decisions, a **pinned** live-status message per team (edited, not re-pinned), bot command menu (`/status`, `/runs`, `/new`, `/mute 1h`), **screenshots/photos** passed to the agent's model when it supports images (else "this agent's model can't read images"), **voice notes** transcribed when a transcription-capable model/endpoint is connected (else a short "connect a transcription model to send voice notes").

### 6.9 Notifications

The owner's "needs you" items for a team appear in that team (as above) and keep appearing in Tether's Inbox/Home. `/mute 1h` (Telegram) and Mute 1 h (Slack status card) silence non-approval posts for that team.

## 7. Constraints

- Follow the approved boards and the app's current look (Studio Live tokens, Linear sidebar, beui kit, action nodes, faces).
- Secrets only in the secret store; validate every inbound platform event (Slack: only the connected app's socket; Telegram: only updates for linked chats; ignore everything else); never act on a chat that isn't linked to a team.
- Treat all platform message text as untrusted input to agents (it is the same as a chat message: agents act only through runs with gates/approvals and team limits).
- Reuse runs, Goals, approvals, assistant turns, accounts; no new heavy dependencies.
- Tests for: team/agent storage, approver checks, limits, ping → answer, task → run, loop → Goal, hand-off, memory (save, cap, delete, no quotes), Slack and Telegram event handling with recorded fixtures (no network), in-place edits, pairing; web: Teams sidebar, team screen, new team, agent memory UI.

## 8. Decided by the owner

- Slack and Telegram only; Tether also has its own Teams screen; teams in each place are separate; agents can be in many teams.
- Teammates see everything; approvals: any teammate by default, chosen people as an option.
- Agents act when pinged, and can run tasks and loop work autonomously.
- One memory per agent across teams.
- From the phone: approve/reject, answer questions, see what's running, start runs, chat.
- The five approved boards, incl. the dynamic Slack and Telegram versions.

## 9. Left to the builder

- Storage layout, ids, message caps, poll/back-off timings, how the team context is trimmed.
- Exact Slack manifest scopes (minimum that delivers board 4), Telegram API usage details.
- How lessons are produced (e.g. a final step after a task/loop) as long as they stay lessons, few, and deletable.
- Splitting the build into phases (suggested: core + Tether teams → Telegram → Slack).

## 10. My calls (owner: check)

- Agents = Crew bots + specialty + personality + memory (no separate agent list).
- Lessons not transcripts; ~200 lessons per agent; optional "don't learn from this team".
- Telegram: one shared bot with agent name labels; Slack: one app posting as each agent (name + icon).
- Agents start runs directly when handed a task (the teammate's ask is the approval to start), limited by team caps; shipping follows the team's level and approver rule.
- A task is a workflow run on the mentioned agent; review hand-offs are read-only answers; work hand-offs continue on the previous branch.
- Reject → one automatic rework with the reason, then ask.
- Daily limit → nothing new starts; in-flight runs finish.
- Memory extends `src/lessons.ts`.
- Screenshots in v1 via the agent's vision-capable model; voice notes in v1 only when a transcription endpoint is connected.
- Each team belongs to one project.
