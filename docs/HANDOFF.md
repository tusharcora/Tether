# Tether handoff

Updated 2026-10-29. Repo: `tusharcora/Tether`, default branch `main`.

## Where things stand

Merged to `main` (newest first):

| PR | What |
|---|---|
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

1. **Check the merged work in the app.** These were built but only checked in tests and a browser:
   - **Goals:**
     - The new palette on Home, Chats, Teams and Goals.
     - The hover arc on neighbouring nodes. A second-row node's arc partly covers the strip of the node above; widen the row gap if that bothers you.
     - The 0.35 s hide delay.
     - A tracker step's "+" picker.
     - The fans on runs, triggers, All chats and Connectors.
   - **Teams Phase 1:**
     - Create a team.
     - Ping an agent.
     - Approve a ship: it should open a GitHub PR and merge only after approval.
   - **NVIDIA:** one real chat turn with an NVIDIA model (paste the key once in Settings → Accounts).
2. **Teams Phase 2: Telegram.** Decide first:
   - how Telegram users map to teammates and approvers;
   - whether loop ship approvals also land in the Inbox;
   - which voice-note transcription endpoint to use;
   - whether non-owners can start runs.

   Then write the spec and plan, and build.
3. **Teams Phase 3: Slack.** It follows the same pattern. Decide the scopes and the Home tab.
4. **Chat components phase B:** the PR and merge-conflict card in chat. It was waiting on Teams, which is now merged.
5. **Small bugs:**
   - Back after a new chat goes to the wrong screen.
   - ⌘J does nothing on the chat screen.
   - Search labels in the thinking timeline garble quoted text.
   - Decide whether to widen the chat history window beyond 8 messages.
6. **Goals follow-ups** from the build review:
   - Avatars flash grey "removed" while the crew and teams lists load.
   - The tracker add field keeps taking focus after "Add a step".
   - Two fast assignee picks can drop one.
   - A screen reader hears only "Assignees" on the compact picker, not who is assigned.
   - On a ticked tracker row, the strike line runs across the step's avatars.
7. **Tests that fail only on a Mac:** `test/triggers.test.ts` (2) and `test/triggers-api.test.ts` (1). macOS reports `/private/var` where the tests expect `/var`; fix with `realpathSync` in the tests. Under heavy load, `evolve.test.ts` and `team-cli.test.ts` time out; they pass when run alone and pass in CI.

## Where the designs live

- Specs: `docs/superpowers/specs/` (free models, chats, teams, chat components, goals redesign).
- Plans: `docs/superpowers/plans/`.
- Mockup canvases (claude.ai artifacts): Goals `GdPwgpVVdZssnLHUdmasJ7`, Teams `1FvSbeztqQPHixmjw8zbwv`, chat components `UMzU5xrg3MtHZhSVY66PGw`, chats `F3oPzyByj5yVXP9mZXs9GV`, free models `BpJa3QcyWiQDwfKXRb5rT4`.

## House rules

- **New UI:** a mockup canvas first, iterate with the owner, then the spec, then one implementer builds the whole plan.
- **Git:**
  - Branch per feature.
  - Never push to `main`.
  - Open stacked PRs against `main` once their base merges. #14 once merged into a dead branch.
  - No Claude attribution in commits or PRs.
- **Secrets:** API keys live only in the Keychain secret store, never in config, logs, argv, URLs or API responses.
- **Tests:** use temp homes only and never touch the real `~/.aorch`.
