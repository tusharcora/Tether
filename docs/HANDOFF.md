# Tether handoff

Updated 2026-10-30. Repo: `tusharcora/Tether`, default branch `main`.

## Where things stand

Merged to `main` (newest first):

| PR | What |
|---|---|
| #27 | Asks become goals (the goal card in chat, optional limits, a first Start), the team room (map, runs strip, channel), the Runs list and a run's page remade (story, commentable changes, Merge to main / Open PR / Send back) |
| #26 | Ports from deepseek-harness: tool-result pruner, repeat-tool reminder, run_code spill, browser MCP presets, issue and comment triggers, cron schedules; `npm run check` |
| #25 | Goals redesign: equal goal nodes with a "next" strip, lift and dim, assignees (teams and agents) on goals and steps, Owner pill, create menus in 5 places, soft-grey dark palette |
| #22 | Artifacts (like Claude's), task cards, slash commands, @mentions, saved prompts |
| #20 | assistant-ui elements on real data (message actions, feedback, error/stopped states, queue, permission grant, web search, link preview…) |
| #23 | Teams, Phase 1: Tether team screen, shared agents with one memory, ship-gated levels, approvals |
| #21 | CI: GitHub Actions `check` job (typecheck, tests, build) |
| #19 | Chat components: thinking timeline, context ring, plan and agents cards |
| #18 | NVIDIA free models (build.nvidia.com) |

**`main` is protected:**
- The CI `check` must pass before anything merges.
- No force pushes and no deleting `main`.
- No review is required: GitHub doesn't let you approve your own PR, so requiring one would block your merges.
- Admins can bypass in an emergency.

**CI:**
- `.github/workflows/ci.yml` runs on every PR and every push to `main`.
- One Linux job with a 15-minute cap; a new push cancels the older run.
- It skips Electron's binary download and caches npm downloads (the lockfile is gitignored).
- There are no path filters on purpose: a required check that skips docs-only PRs would leave them unmergeable.

## How to run the app

```sh
pkill -9 -f "Tether.app/Contents"          # plain SIGTERM does not quit it
TETHER_APP_OUT=/Users/tushar/dev/tether-app npm run -s app
open /Users/tushar/dev/tether-app/Tether-darwin-arm64/Tether.app
```

- Packaging signs with `TETHER_SIGN_IDENTITY`, or else the first "Apple Development:" identity, so macOS doesn't re-ask for Documents access after each rebuild.
- If the shell proxies localhost, use `curl --noproxy '*'` against the local server.

## Next steps (in order)

00. **Squads and Tickets** (branch `feature/squads-tickets`; it has #30 Teams on Telegram, #31 optional run budgets and #32 runs fix themselves merged in; spec `docs/superpowers/specs/2026-10-30-squads-tickets-design.md`, plan `docs/superpowers/plans/2026-10-30-squads-tickets.md`, boards `docs/design/squads-tickets/`): built and checked in tests only (no real model, no network). Squads replace Teams and team runs, Tickets replace Goals; the old screens are gone from the sidebar and `#/goals…`, `#/teams…` links redirect; `/api/goals…` and `/api/teams…` answer as aliases for one release. Open its PR once #30, #31 and #32 are in `main` (retarget it then). Check in the app, on a copy of your home first if you want a way back (the first start moves `<home>/teams/` to `<home>/squads/` and numbers every goal as a ticket):
   - **Migration**: your teams show under **Squads** with their messages; your goals show on **Tickets** (G K) with keys like `ORCH-1` in creation order and the status map (paused not started → Todo, paused → Backlog, active → In progress, needs you → In review, met → Done, stopped → Canceled). A Telegram squad still answers in its group.
   - **A squad ask**: in a Tether squad, `@Bolt fix …`. Bolt says "On it."; a ticket appears In progress with Bolt as assignee and the squad's reviewer (Lens) as reviewer; Right now shows Bolt's card with a live line and timer; Lens's card filters the channel.
   - **The voice**: when the work is done Bolt writes one or two sentences and asks @Lens; **What I did** opens files, +/−, the test command and its result, **Full report** shows the raw output. Lens's review lands in the channel; a failed review sends Bolt back in Lens's thread (open it from "2 replies · …") and the old ship card says it was replaced.
   - **Ship it**: the ship card's chips (tests, Lens approved, criteria), Ship it, "Shipped by you · PR #n open, merging once checks pass" with **Undo** (closes the PR, card waits again), then "merged" with no Undo; the ticket goes In review then Done. **Not yet** with a reason reworks once.
   - **Busy agents**: a second `@Bolt …` while Bolt works queues ("I'm in the middle of …"); the @ picker says busy · will queue / free now; the pulse's Coming up and Tickets' Ready for an agent show the pickup; Start now starts it.
   - **Failures**: a run that fails says "I couldn't finish this: …"; with auto-fix on, "That didn't pass, so I'm having another go (round 1 of 3)." and, when it gives up, a plain message with the reason.
   - **The pulse**: ticket counts (each opens the board on the squad), Shipped today with 5 days of bars, Coming up (queue, recurring tickets with their next scheduled time), Pinned (pin a message from its hover menu). Chat | Map: today's hand-offs, live lines move. Reactions, the typing line, the sidebar's unread count and needs-you badge, the Agents list.
   - **Tickets**: This week (shipped, in flight, Todo → Done, oldest waiting on you), Board and List, filters, the detail panel (status, priority, assignee, reviewer, squad, criteria with the auto-checked one, the ship banner's Merge PR / Send back, a comment with `@Bolt` that hands it the ticket), New ticket, the key prefix in the header, Ideas from your chats (answer a chat's ticket card "Just answer, no ticket", then press +).
   - **Telegram**: a squad message in the group is the sentence plus one *What I did* line; ship cards have Ship it / Not yet / Diff.
   - **With a free model** (OpenRouter or NVIDIA bound to an agent of the squad): the done messages read in the agent's words; without one they are templates ("Done, 3 files changed, tests pass. @Lens mind reviewing it?").
   The plan's "My calls" list what to confirm: tickets on the goals table (`stage` is the status), one auto-checked criterion, keys and the prefix rule, internal names kept as `team`, the status writer's model only for reports, the review as the default ticket reviewer, the queue and when an agent counts as busy, Ship it merging, Undo until merged, threads, the board's columns, no "Read" row in What I did, This week's week starting Monday and its Todo → Done measured from creation.
0. **Runs fix themselves** (branch `feature/runs-fix-themselves`, stacked on `feature/optional-run-budgets` / PR #31; spec `docs/superpowers/specs/2026-10-30-runs-fix-themselves-design.md`): built and checked in tests only. Merge PR #31 first, then open this one against `main` (retarget it once #31 merges). Then check in the app:
   - A team run that changes a file: the writes card recommends yes, the plan has a write step, and the drafter edits the file.
   - A run that fails: the header says "Auto-fixing · round 1 of 3", story rows per round, the run under Live; after 3 rounds Needs you says "Auto-fix gave up after 3 rounds: …" with Retry / Open. Settings → Runs: Auto-fix failed runs and its rounds; Stop auto-fix between rounds.
   - A read-only team run whose task changes files: "Check the plan" in Needs you and the plan review, and Allow edits plans again with writes on.
   - Notices under a run's header for a refused hand-off, an ignored redo, long text passed on as a file.
   The spec's "My calls" list what to confirm (writes default, the 16,000 limit, the diagnosis prompt, the plan check heuristic, free models last in Try more ways).
1. **Rewind, try more ways, Terminal and Preview** (branch `feature/rewind-attempts`, spec and plan dated 2026-10-30): built and checked in tests only. Open the PR against `main`, then check in the app:
   - A finished step's ⋯: Rewind to before it (the dialog, the banner's Undo and Resume), Fork from after it, Open its changes. A live run offers Stop & rewind.
   - Try 2 more ways from a run's header and from a started goal card; the picker's defaults; Compare (`#/attempts/<set>`): Tether's pick, Pick X and ship, Retry, Try 1 more way; the Runs list's best-of-N row.
   - Terminal: a command's output, Stop and Ctrl+C, ↑ history, a long output saved under `.tether/spill/`.
   - Preview: Start preview on a project with a `dev` script; the frame in Tether.app (the content policy now allows loopback frames); reload, open in browser, Stop; quitting the app ends the dev server.
   - Goals · next beside a chat on a wide window; the Goals button hides it.
   The plan's "My calls" list what to confirm (which steps a rewind requeues, the default picks, the pick ranking, the 7-day sweep, the clean env, the Preview width).
2. **Check the merged work in the app** (#27, #26 and earlier): built but only checked in tests and a browser.
   - **Asks become goals:** a chat ask to fix something gives a goal card; Start runs it; "Just answer, no goal" deletes the goal; "+ Add limits" on New goal, Settings and the card; the sidebar chat ⋯ (Rename, Delete chat).
   - **Runs and a run's page:** Needs you cards, Approve & open PR, the week rail; comment a diff line, Send back; Merge to main on a repo with a GitHub remote (without one the push error shows: there is no local merge path).
   - **Team room:** This run / Whole team, the strip, Open run from a card.
   - **dsh ports:** an issue labelled for a trigger and an `@tether` comment start runs; a cron schedule fires; the browser MCP presets add.
   - **Goals redesign (#25):** the palette, the hover arc (a second-row node's arc partly covers the strip above; widen the row gap if that bothers you), the 0.35 s hide delay, a tracker step's "+" picker, the fans on runs, triggers, All chats and Connectors.
   - **Teams Phase 1:** create a team, ping an agent, approve a ship (it opens a PR and merges only after approval).
   - **NVIDIA:** one real chat turn with an NVIDIA model.
3. **Teams Phase 2: Telegram** (branch `feature/teams-telegram`, spec and plan dated 2026-10-30): built and checked in tests only (fake Bot API, no network). Test with a real bot:
   - @BotFather `/newbot`; Settings → Accounts → Telegram: paste the token; **Link my Telegram** and send `/iam <code>` to the bot in a private chat.
   - New team → Telegram group; add the bot to a test group as an admin; send `/pair <code>`; check the pinned status appears.
   - From your account: `@Bolt fix …` (run card edited in place, ship card with Approve / Reject / Diff), `/status`, `/runs`, `/new …`, `/mute 1h` then `/mute off`.
   - From a second Telegram account in the group: an ask becomes a proposal card; its Approve is refused ("Only approvers can decide this"); switch it on in People and permissions and try again.
   - Approve one ship from the Inbox and watch the Telegram card change to "Approved by …".
   - A photo replying to an agent; a voice note before and after **Voice notes: download model** (~241 MB).
   The plan's "My calls" list what to confirm (reply-to pings, the Diff reply, Edit by force-reply, /mute rules).
4. **Later ports from deepseek-harness**, each its own spec: hooks (before and after a step or a tool call), the macOS Seatbelt sandbox for agent commands, auto-review of a finished run, LSP diagnostics fed to agents, speech-to-text for the composer.
5. **An interactive terminal** (a PTY, `node-pty`, a native dependency): the Terminal tab is a command console for now.
6. **Teams Phase 3: Slack.** It follows the Telegram pattern. Decide the scopes and the Home tab.
7. **Chat components phase B:** the PR and merge-conflict card in chat.
8. **Small bugs:**
   - Back after a new chat goes to the wrong screen.
   - ⌘J does nothing on the chat screen.
   - Search labels in the thinking timeline garble quoted text.
   - Decide whether to widen the chat history window beyond 8 messages.
   - Goals: avatars flash grey "removed" while the crew and teams lists load; the tracker add field keeps focus after "Add a step"; two fast assignee picks can drop one; a screen reader hears only "Assignees" on the compact picker; on a ticked tracker row the strike line runs across the step's avatars.
   - Try more ways: a sibling still going when the server stops is never settled on its goal (its item shows no result).
9. **Tests that fail only on a Mac:** `test/triggers.test.ts` (2) and `test/triggers-api.test.ts` (1). macOS reports `/private/var` where the tests expect `/var`; fix with `realpathSync` in the tests. Under heavy load, `evolve.test.ts` and `team-cli.test.ts` time out; they pass when run alone and pass in CI.

## Where the designs live

- Specs: `docs/superpowers/specs/` (free models, chats, teams, chat components, goals redesign, asks-goals-runs, dsh ports, rewind and attempts).
- Plans: `docs/superpowers/plans/`.
- Static boards: `docs/design/asks-goals-runs/` (#27), `docs/design/next-build/` (rewind, Compare, Terminal and Preview) and `docs/design/squads-tickets/` (Squad channel with its pulse, agents writing like people, Tickets).
- Mockup canvases (claude.ai artifacts): rewind and attempts, and Squads and Tickets (boards 8 to 10) `WvgbPqG6rR4MaPwD7BUviV`, Goals `GdPwgpVVdZssnLHUdmasJ7`, Teams `1FvSbeztqQPHixmjw8zbwv`, chat components `UMzU5xrg3MtHZhSVY66PGw`, chats `F3oPzyByj5yVXP9mZXs9GV`, free models `BpJa3QcyWiQDwfKXRb5rT4`.

## House rules

- **New UI:** a mockup canvas first, iterate with the owner, then the spec, then one implementer builds the whole plan.
- **Git:**
  - Branch per feature.
  - Never push to `main`.
  - Open stacked PRs against `main` once their base merges. #14 once merged into a dead branch.
  - No Claude attribution in commits or PRs.
- **Secrets:** API keys live only in the Keychain secret store, never in config, logs, argv, URLs or API responses.
- **Tests:** use temp homes only and never touch the real `~/.aorch`.
