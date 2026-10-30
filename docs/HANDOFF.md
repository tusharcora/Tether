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
3. **Teams Phase 2: Telegram.** Decide first:
   - how Telegram users map to teammates and approvers;
   - whether loop ship approvals also land in the Inbox;
   - which voice-note transcription endpoint to use;
   - whether non-owners can start runs.

   Then write the spec and plan, and build.
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
- Static boards: `docs/design/asks-goals-runs/` (#27) and `docs/design/next-build/` (rewind, Compare, Terminal and Preview).
- Mockup canvases (claude.ai artifacts): rewind and attempts `WvgbPqG6rR4MaPwD7BUviV`, Goals `GdPwgpVVdZssnLHUdmasJ7`, Teams `1FvSbeztqQPHixmjw8zbwv`, chat components `UMzU5xrg3MtHZhSVY66PGw`, chats `F3oPzyByj5yVXP9mZXs9GV`, free models `BpJa3QcyWiQDwfKXRb5rT4`.

## House rules

- **New UI:** a mockup canvas first, iterate with the owner, then the spec, then one implementer builds the whole plan.
- **Git:**
  - Branch per feature.
  - Never push to `main`.
  - Open stacked PRs against `main` once their base merges. #14 once merged into a dead branch.
  - No Claude attribution in commits or PRs.
- **Secrets:** API keys live only in the Keychain secret store, never in config, logs, argv, URLs or API responses.
- **Tests:** use temp homes only and never touch the real `~/.aorch`.
