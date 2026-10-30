# Optional run budgets: design

Date: 2026-10-30 · Branch: `feature/optional-run-budgets` (from main e30bc34).

## 1. Intent (owner, 2026-10-30)

"Runs don't need budgets: an optional choice that is defaulted to off. Run cost still shows for transparency, but does not stop operations after a limit."

## 2. Design

- New setting **Spending caps** (`prefs.spendingCaps: boolean`, **default false**), in Settings (General, or wherever app-wide prefs live), with one line: "Off: runs never stop because of cost. Costs still show everywhere." Changing it applies to runs started afterwards; a run records the setting it started with (`RunState.capsOn`), so a live run never changes rules mid-way.
- **When off** (the default), nothing stops or refuses work because of money:
  - workflow `settings.maxCostUsd` is not enforced: no "budget exhausted" stop (`engine.ts` ~l.1053, 1283, 1434), no remaining-budget passed to agent calls (~l.1687/1702: `budgetUsd` undefined), no adapter flag that caps a call (e.g. claude's per-call budget option) unless a cap is on;
  - team runs get no default or maximum cap (`team.ts` `TEAM_DEFAULT_BUDGET_USD` / `TEAM_MAX_BUDGET_USD` only apply when caps are on); the plan's `limits.maxCostUsd` and the planning "used up the budget" checks (`engine.ts` ~l.682, 856, 893) are skipped; the maestro gets no budget cap;
  - teams' **daily $ limit** (`limits.usdPerDay`) does not block new work (runs-per-day still does: it is not a budget);
  - `pipeline.ts` drops its "maxCostUsd cannot be enforced" warning.
- **Still enforced even when off:** a $ limit the owner added to a specific goal by hand (opt-in per goal, already optional since #27), and Evolve **probe replays**, which require a hard cap by design (`engine.ts` ~l.329). CLI `--budget` on `aorch team` sets a cap for that run explicitly, so it is honoured (explicit opt-in).
- **When on:** today's behaviour, unchanged.
- **Transparency:** costs keep showing everywhere they do today (run header, rows, Runs week rail, goal and team spend). Where a cap is shown ("$0.63 of $2.00", builder/inspector cost fields, team limit fields, plan review limits), show it only when caps are on; otherwise just the cost. The builder's and team settings' $ fields stay editable but carry "only used when Spending caps is on" (my call: keeps configs intact for anyone who turns caps back on).

## 3. Constraints

- No data migration: stored `maxCostUsd`/`usdPerDay` values are kept and simply not enforced while caps are off.
- Tests: default off (no stop at a pipeline's maxCostUsd, team run without cap, no per-call budget passed, team daily $ not blocking, runs-per-day still blocking); on = today's tests keep passing (set the pref in those tests); a goal's explicit $ limit still stops; probes still require a cap; the setting is captured at run start. Temp homes only. `npm run check` passes (known flaky: `evolve.test.ts` timeouts under load).
- Commits/PRs without AI attribution.

## 4. My calls (owner: check)

- Goal $ limits you add by hand and `--budget` still apply; probe replays keep their cap.
- Daily $ limits on teams are off with the switch; runs-per-day stays.
