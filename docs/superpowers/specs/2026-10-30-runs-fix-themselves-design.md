# Runs fix themselves: design

Date: 2026-10-30 · Branch: `feature/runs-fix-themselves`, stacked on `feature/optional-run-budgets` (PR #31: spending caps off by default).

## 1. Intent (owner, 2026-10-30)

"Runs never stop failing. It should be able to auto fix, and since most of this is run on an already paid-for subscription the cost limit doesn't matter."

## 2. What actually failed (diagnosed from the owner's runs)

- `rmvuznphg1f5a82` (README update, team run): `budget exhausted ($5.24 of $4)`. Fixed by PR #31 (caps off by default).
- `rmvv2xz94eb88a8` (README update, team run, $17.33): the reviewer returned FAIL three times and the run errored. Root causes, from its events:
  1. **Read-only by default.** The planning card "May agents change files in the worktree?" recommends **no** (`src/team.ts` `WRITES_QUESTION` card). It was answered no, so the plan said "no file changes, including README.md" and asked for the whole ~54 k-character README inside step reports. The drafter could never apply anything ("README.md is unchanged" in every review).
  2. **Manager redo guidance cut at 1,000 characters** (`src/engine.ts` ~l.583 `guidance.slice(0, 1000)`): the reviewer's 11 fixes reached the drafter only up to fix 4.
  3. **Step outputs passed on were cut** (the reviewer: "both of the planner's replies were cut before they reached me"; handoff answers capped at 8,000, ~l.1270, plus whatever caps reports passed to the manager/next step).
  4. **Protocol lines inside quoted documents went live.** The README documents `@ASK`/`@HAND` with examples; the drafter quoted it and the fence scanner (`src/handoff.ts` `scanHands`, and the matching `@ASK` scanner) toggles on every line starting with ``` so nested/longer fences broke and the examples became real asks and hand-offs ("Which database?", "check a.txt").
  5. **No recovery in the app.** The supervisor (`src/supervisor.ts`: retry, then escalate the failing step to a stronger model) only runs from the CLI (`--supervise`) and the TUI (`m fix`). The desktop app never runs it.
  6. The full-README rewrite also hit the model's output classifier; with writes allowed the drafter edits the file instead of reprinting it.

## 3. Design

### 3.1 Writes on by default
- The writes card recommends **yes** and the default plan allows writes. Wording: "Agents edit files in this run's own worktree; nothing reaches your branch until you approve or merge." Explicit "no" still makes a read-only run.
- Team planning prompt: when the task is to change something in the repo (update/fix/add/write/refactor a file), plan it as file edits, never "deliver the text in the report".

### 3.2 Nothing important gets cut between steps
- Manager redo guidance: no 1,000-character cut. Keep up to 16,000 characters inline; beyond that, write the full text to the run's spill dir (`.tether/spill/`, the existing `src/codemode/spill.ts` helper) and pass head + tail + the path ("read the full list at …").
- Every place one step's output is handed to another (handoff answers, reports given to the manager, `@HAND` answers, review findings fed to a fixNode): the same rule (inline up to 16,000, else spill + pointer). Find them all (grep `slice(0,` on outputs in `engine.ts`, `handoff.ts`, `team.ts`, `runchat.ts`).

### 3.3 Fences done right
- One shared scanner for `@HAND` and `@ASK` lines that follows CommonMark fences: a fence opens with ≥3 backticks or tildes and closes only with the same character and at least the same length; indented code blocks and `>` quotes never carry live lines. Port the fixes to every parser of protocol lines. Test with the owner's case: a README with ```` ```` ```` outer and ``` inner fences containing `@ASK`/`@HAND` examples → no live lines.

### 3.4 Auto-fix in the app (default on)
- Setting **Auto-fix failed runs** (`prefs.autoFix`, default **true**, next to Spending caps in Settings → Runs) and `rounds` (default 3).
- When a run finishes `error` and it was not stopped by a person (not `stopped`, not rejected), the server runs the supervisor for it automatically:
  - round 1: **diagnose and retry**: one read-only turn (the assistant's agent) reads the run's last errors, failing verdicts and findings and writes concrete guidance; the failed step(s) restart from the failure (`resume` with `retryFailed`) with that guidance attached (`node.amended`). If the run was read-only and the failure shows edits were needed, it asks the owner once (Needs you card: "Allow edits and retry?") rather than flipping it silently.
  - round 2+: **escalate** the failing step to a stronger model (existing `decide`), then retry.
  - review loops: when a check/review loop runs out, the auto-fix round counts as a fresh loop budget for that pair, with the full findings passed (§3.2).
  - stop after `rounds`, or when the supervisor says there is nothing stronger: the run ends as today with a **Needs you** item "Auto-fix gave up after 3 rounds: <one-line why>" and buttons Retry / Open run.
- Never auto-fix: runs stopped or rejected by a person, probe replays, runs whose worktree is gone, a run that failed on a spend cap while caps are on (that is the owner's explicit limit).
- Visible: the run page shows "Auto-fixing · round 2 of 3 · moved Lens to Opus" in its header and as story rows; the Runs page shows such runs under Live; events `autofix.started|round|gave_up`.
- Goals: a goal's run that auto-fixes counts as one run item (its rounds are not new tries).

## 4. Constraints

- Reuse `src/supervisor.ts` (`decide`, `culprit`, `failureBrief`) and `runchat.ts`'s brief; no second supervisor.
- Tests: writes default yes (and explicit no still read-only); guidance/handoff over 16 k spills with a pointer; fence scanner cases (nested, tildes, longer outer fence, indented, quoted, the README case); auto-fix rounds (diagnose → retry → escalate → give up with Needs you), not for stopped/rejected/probe/cap-stop, setting off disables it, goal counts one item. Temp homes only. `npm run check` passes (known flaky: `evolve.test.ts` load timeouts).
- Commits/PRs without AI attribution.

## 5. Left to the builder

How the diagnose turn is prompted (keep it short and read-only), where exactly each output cap lives, and the UI details of the auto-fix rows (match the run page's story rows).
