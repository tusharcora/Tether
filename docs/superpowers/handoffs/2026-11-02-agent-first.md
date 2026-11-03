# Handoff: agent-first Tether, 2026-11-02

Start the next session in the **orchestrator** project, in this worktree:

```sh
cd /Users/tushar/Documents/PROJECTS/orchestrator/.claude/worktrees/squads
```

Tether's current code is here, on `feature/agent-first`, which builds on `feature/squads-tickets`. The local `main` in `/Users/tushar/Documents/PROJECTS/orchestrator` is old (the aorch/Maestro build); `origin/main` has moved: see Where things stand.

## The goal

Tether told the owner to skip it and use Claude Code, because chat couldn't edit files and every run needed git. The owner wants agents that do the work in any folder, recommend the cheapest way to do it, remember everything, and work like employees across projects. Read `docs/superpowers/specs/2026-11-01-agent-first-design.md` first. `docs/design/agent-first/prototype.html` is the approved look.

Six stages, from the design's §8:

| Stage | What | State |
|---|---|---|
| 1 | Work anywhere: hidden history, landing, Undo | **Built**, local only |
| 2 | Agents do the work from chat, commands, trust | **Built**, local only; check it in the app |
| 3 | Memory: About you, briefs | Not started |
| 4 | Agent-first shell: leads, specialists, agent chats, sidebar, first run | Not started |
| 5 | One job at a time, queue across projects | Not started |
| 6 | Generative UI, scraping with Crawlee | Not started |

## Where things stand

- **Stage 1 is finished and reviewed.**
- **Stage 2 is built and local only.** The final review's fixes are in. It's checked in tests only: no real model has run the hook, the deny list or the scrub, and it hasn't been checked in the app.
- **The four differences from the design are approved** (2026-11-02): Do it myself on a hidden copy, a real repo ending on Merge or Open PR, always-ask commands refused, each job starting fresh.
- **Nothing is pushed for agent-first.** `feature/agent-first` exists only on this Mac.
- **`main` moved.** PRs 31-33 merged at `54b3035` on `origin/main`, separately from this work. `feature/agent-first` merges onto it with one conflict, as of `efcbc2d` and after the fixes: two import lines at the top of `test/teams.test.ts`, keep both. No other file conflicts (`git merge-tree`).
- **Tether.app** at `/Users/tushar/dev/tether-app/Tether-darwin-arm64/Tether.app` is built from `abc8a93` and was running on the owner's real home. It looks mostly unchanged, because stage 1 is behind the scenes. Its visible changes need a finished run in a plain folder, and `Masters HW` has none yet.

## Next step

The owner checks stage 2 in the app, including the three real-model checks, in the order `docs/HANDOFF.md` gives them, with its limits. Then write stage 3's plan: memory, About you and briefs, from the design's §8. Write it only after that check, or when the owner says to go ahead.

## Rules that bit us

- **Never push without the owner's say-so.** Clicking ship on a real repo really pushes. A check of mine put a test copy inside this repo, so Tether treated it as a real repo and pushed a branch to the public `tusharcora/Tether`. The owner approved deleting it, and it's gone.
- **A test folder must sit outside any git repo,** or it isn't a plain folder. Use the system temp folder. Confirm `history` is set on the run before any ship.
- **To run a second Tether, copy the home and strip it first.** Leave out `accounts.json`, `mcp.json` and `squads/telegram.json`, and start it with a PATH that has no agent CLIs, or it can resume paused runs, spend tokens and reuse the Telegram bot.
- **Spend no tokens on checks.** The `demo-mock` workflow in `~/.aorch/pipelines/` uses the mock agent.
- **Run the suite with nothing else running:** `npx vitest run --testTimeout=30000`. The 5-second timeouts fail under load, and `test/code-save-search.test.ts` and `web/src/hooks.test.tsx` are load flakes.
- **Landing and shipping code needs a review that reproduces on the real filesystem.** Reviews found case-folded names overwriting files, CRLF corruption, private files widened to 0644, and uncommitted work reaching a remote through a fork. The fork logic took three designs: keep the one-base rule in `landingBase` (`src/runShip.ts`) and `landBranch` (`src/history.ts`), and don't go back to per-path baselines.
- The repo's `review-package` needs the real head: a docs commit can sit below the code commit. Check `git rev-parse HEAD`.

## Known limits in stage 1

These are in `docs/HANDOFF.md` and the README:

- A sibling fork of an unlanded parent, after another sibling landed, can overwrite a person's revert. So can a run started from a landed run's branch with no fork origin, such as squad follow-ups and goal runs. Undo restores the file.
- Uncommitted work sits on the local `aorch/<run>` branch, so a person's own `git push --all` would publish it.
- The uncommitted-work check goes by path, so a copy to a new path could still ship. A fresh sha `ref`, or a run already in the logs, has only the commit-message check.
- A fork from an earlier step can stop with "changed since" when the parent changed the file.
- `.aorch/http` and `workspace init` still write into a plain folder until stage 4.
- The hidden history is never pruned: 308 MB for the 52,000-file `Masters HW` copy.
- No real model has run on a plain folder yet, and nothing has shipped through real GitHub since these changes.

## Decisions already made by the owner

- Five leads at most, the rest are specialists (option B). One job at a time per agent, the rest queue.
- "Trust this folder?" once per folder, for every agent.
- Every model gets commands, including OpenRouter and NVIDIA.
- Crawlee, not Firecrawl, for scraping. Generative UI uses Tether's own components, with agents sending data rather than code.
- Never ask twice: About you and a brief per job, loaded automatically.

## Useful paths

- Design: `docs/superpowers/specs/2026-11-01-agent-first-design.md`
- Stage 1 plan: `docs/superpowers/plans/2026-11-01-work-anywhere.md`
- Stage 2 plan: `docs/superpowers/plans/2026-11-02-agents-do-the-work.md`
- Stage 1 ledger, with every ruling (git-ignored, local): `.superpowers/sdd/2026-11-01-work-anywhere/progress.md`
- App handoff and run instructions: `docs/HANDOFF.md`
- Build the app: `TETHER_APP_OUT=/Users/tushar/dev/tether-app npm run -s app`
