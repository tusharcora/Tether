# Teams Phase 2: Telegram: design

Date: 2026-10-30 · Branch: `feature/teams-telegram` (from main 2c4de49) · Builds on `2026-10-29-teams-design.md` (Phase 1 merged in #23; §6.8 "Telegram" and board 5 are the approved design). New board: canvas `WvgbPqG6rR4MaPwD7BUviV` board 7 "Telegram team: people and permissions" (copied to `docs/design/teams-telegram/TeamPeople.dc.html`); the approved Telegram board is `docs/design/teams/Telegram.dc.html`.

## 1. Intent

A team can live in a **Telegram group**: people talk to Tether's agents there like coworkers, get live progress, and approve ships from their phone. It is also the owner's phone remote for Tether. Everything runs on the owner's Mac while Tether runs (long polling, no server).

## 2. Owner decisions (2026-10-30)

1. **Who is who:** everyone in the linked group can chat and @mention agents; agents (Crew bots) are members too. **Only people can be approvers**; an agent can never approve, reject or merge.
2. **Inbox:** every approval asked in a Telegram team (plan, ship, loop/goal asks) also lands in Tether's **Inbox / Home "Needs you"**, and deciding in either place settles both (the Telegram message is edited to show who decided).
3. **Voice notes:** transcribed **locally with SenseVoice**, ported from deepseek-harness `experimental/speech-to-text-sensevoice` (free, offline, no key).
4. **Starting runs:** people other than the owner may start runs **only with the "Can start runs" permission**, set per person per team (board 7). Without it, their asks get a proposal card that an allowed person starts.

## 3. Goals

1. Connect a Telegram bot (Settings → Accounts → Telegram): paste the @BotFather token once (secret store, verified with `getMe`), long polling with `getUpdates`.
2. Link a group to a team: New team → "Telegram group" shows a one-time pairing code; add the bot to the group and send `/pair <code>`.
3. Board 5 features: agent replies labelled with the agent's name (one shared bot), inline keyboards (Approve / Reject / Diff; Start run / Edit / Dismiss), messages **edited in place** for progress and decisions, a **pinned** live-status message per team, command menu (`/status`, `/runs`, `/new`, `/mute 1h`), photos passed to the agent's model when it reads images (else a short notice), **voice notes transcribed** (§6.5).
4. People and permissions (board 7): group members appear as people as they speak or join; per person **Approver** and **Can start runs** switches (off for new people; the owner always has both); agents listed as "people only" / "via a person".
5. Inbox parity (§2.2).

## 4. Non-goals

- Slack (Phase 3). Per-agent Telegram bots. Voice replies from agents (Bark text-to-speech was considered; not now). Webhooks or any public URL.

## 5. Anti-goals

- Acting on a chat that isn't linked to a team, or on an update from anyone not in the linked group.
- An agent, a bot, or a person without the Approver switch approving/rejecting/merging; a person without "Can start runs" starting a run, a loop or a goal (directly or via a mention).
- Tokens in config, logs, argv, URLs or API responses; audio sent anywhere off the Mac.
- Unbounded spend: team daily limits apply to every run started from Telegram.

## 6. Design

### 6.1 Data

- `Person` gains `{ via?: 'telegram'; tgUserId?: number; username?: string; canStartRuns?: boolean }`. The owner is linked to their Telegram user by sending `/iam <code>` once (a code shown in Settings → Accounts → Telegram), so Tether knows which Telegram user is the owner.
- `Team.approvers` keeps `'any' | personId[]`, but `'any'` now means **any person** (never an agent) and person entries must be people. New Telegram teams default to `[owner]`. The board-7 switch edits the list.
- `Team.link` = the Telegram chat id; per team, Tether stores the pinned status message id and the ids of messages it must edit (cards), 0600, capped.

### 6.2 Telegram client (server)

- `src/teams/telegram/` — a small Bot API client over `fetch` (no new dependency): `getMe`, `getUpdates` (long poll, offset persisted), `sendMessage`, `editMessageText`, `pinChatMessage`, `answerCallbackQuery`, `setMyCommands`, `getFile` + file download (photos, voice). Backoff on errors; 429 `retry_after` respected; stops when the token is removed.
- Updates are accepted only for linked chats (plus `/pair` in an unlinked group and `/iam` in a private chat with the bot); everything else is ignored and not logged in full.
- Message text is untrusted: fenced in prompts like Tether team messages (Phase 1 rules).

### 6.3 Behaviour

- Messages and @mentions go through the same team logic as Tether teams (`src/teams/teams.ts`): ping → one answer, task → run, loop → goal, hand-offs, limits, memory. Replies are posted as "**Bolt**: …".
- Permission checks happen before anything starts: a task/loop/`/new` from a person without "Can start runs" becomes a **proposal card** ("Maya asked: … · Start run / Dismiss") that only an allowed person can start; the asker is told once why.
- Approval buttons check the presser: only people on the approver list; others get an `answerCallbackQuery` notice ("Only approvers can decide this"). A decision edits the card to "Approved by Maya · 14:02" and settles the matching Inbox item; a decision made in Tether's Inbox edits the Telegram card the same way.
- Live status: one pinned message per team, edited as runs move (debounced, ≤ 1 edit / 3 s per message).
- `/status` (live runs, needs-you count, spend today of limit), `/runs` (last 5 with links), `/new <task>` (permission-checked), `/mute 1h` (silences non-approval posts for that team).
- Photos: passed to the agent when its model supports images (existing vision path), else "this agent's model can't read images".

### 6.4 Inbox parity

Telegram-team approvals use the same attention items as Tether teams; the Inbox shows the team's name and "Telegram"; settling is idempotent (the first decision wins; the second click is told "already decided by …").

### 6.5 Voice notes (SenseVoice port)

- Port deepseek-harness `packages/experimental/speech-to-text-sensevoice` (MIT, © 2026 DeepSeek; files `recognizer.ts`, `inference.ts`, `model-sources.ts`, `runtime.ts`, `worker.ts`, `download-error.ts`, `config.ts`) into `src/stt/` with a provenance line per file and a THIRD_PARTY_NOTICES entry. New dependency: `sherpa-onnx-node` (the only one allowed in this build).
- The model downloads on first use to `<home>/models/sensevoice/` with progress shown in Settings → Accounts → Telegram ("Voice notes: download model (~230 MB)"); until it is present, voice notes get "Voice notes need the speech model — download it in Tether settings".
- Telegram voice notes are OGG/Opus: decode to 16 kHz mono PCM with the port's input path (or `ffmpeg` if the port needs it and it is installed; otherwise the notice above names what is missing). Transcription runs in a worker so the server stays responsive; the transcript is posted back in the chat as "Voice: …" and then handled like a typed message.
- Packaging: make sure the Electron app bundles the native module (rebuild for Electron's ABI in `scripts/package-app.mjs` if needed). If the native module can't load, voice notes degrade to the notice; nothing else breaks.

### 6.6 Web

- Settings → Accounts → **Telegram**: token field, status (bot username, polling), the owner link code (`/iam`), voice model download.
- New team: "Telegram group" option shows the pairing code and waits for `/pair`.
- Team screen for a Telegram team: the same room as Tether teams (read-only mirror of what Tether posted and what it received), plus **People and permissions** (board 7).

## 7. Constraints

1. Follow board 5 (Telegram) and board 7. Tokens only in the secret store. Validate every inbound update and route input.
2. Tests with recorded Telegram update fixtures (no network): pairing, `/iam`, unlinked chat ignored, ping/task/loop, permission refusals (no "Can start runs", non-approver, agent), callback approvals and Inbox parity both ways, in-place edits and debounce, pinned status, `/mute`, photo routing, voice note → transcript (SenseVoice mocked at the worker boundary), model-missing notice, 429 backoff. Temp homes only.
3. `npm run check` passes (known flaky: `evolve.test.ts` timeouts under load). The packaged app must start with the native module present.
4. Commits and PRs: no AI attribution.

## 8. Left to the builder

Bot API call details, offset persistence, the exact debounce, the audio decode path, and how the native module is packaged.

## 9. My calls (owner: check)

- The owner is identified on Telegram with a one-time `/iam` code.
- New people join with both switches off; the owner always has both.
- `approvers: 'any'` now means any *person*.
- Voice replies (Bark) are out of this build.
