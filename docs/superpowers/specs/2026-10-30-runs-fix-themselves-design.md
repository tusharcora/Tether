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

### 3.5 Recommendations that finish the job, and no silent failures (owner, added 2026-10-30)

"Make sure that recommended options are the best options to get the job done efficiently, not one that silently fails without telling you why."

- Every place Tether pre-selects or recommends a choice recommends the option most likely to finish the task well and fast, and right for the task at hand. The planner is told to recommend that for its own cards and never an option that makes the task impossible (read-only for a task that changes files); so are workers asking `@ASK user:`.
- The plan check: when an approved plan's constraints contradict its goal (read-only while the task changes files; no step may write while the success criteria need a change), Tether flags it before running with a Needs you card that says why and offers the fix (Allow edits), instead of running and failing.
- No silent failures: every path that refuses, skips, cuts or degrades (a refused hand-off, a skipped step, text cut or passed on as a file, a fallback) shows a specific reason on the run page, not only in the event log.

## 4. Constraints

- Reuse `src/supervisor.ts` (`decide`, `culprit`, `failureBrief`) and `runchat.ts`'s brief; no second supervisor.
- Tests: writes default yes (and explicit no still read-only); guidance/handoff over 16 k spills with a pointer; fence scanner cases (nested, tildes, longer outer fence, indented, quoted, the README case); auto-fix rounds (diagnose → retry → escalate → give up with Needs you), not for stopped/rejected/probe/cap-stop, setting off disables it, goal counts one item. Temp homes only. `npm run check` passes (known flaky: `evolve.test.ts` load timeouts).
- Commits/PRs without AI attribution.

## 5. Left to the builder

How the diagnose turn is prompted (keep it short and read-only), where exactly each output cap lives, and the UI details of the auto-fix rows (match the run page's story rows).

## My calls

Made while building (2026-10-30); each is the smallest version that does the job. Confirm or change.

**Writes (§3.1)**
1. Writes are on unless the latest answer to the writes card is no, from anyone. The old rule (only a person's yes turns writes on) is gone, so `--yes` and autonomous mode now get writes too: they take the card's recommendation, which is yes. The model still cannot change it: its card text and its plan's limits are ignored.
2. The default plan's assignment edits files when writes are on.

**Nothing cut (§3.2)**
3. One helper, `passOn` in `src/codemode/spill.ts`: whole up to 16,000 characters; longer text goes to `<worktree>/.tether/spill/pass-<hash>.txt` and the reader gets its head, its tail and the file's absolute path. The name is the text's hash, so a prompt built twice names one file; a file swept after 24 hours is written again when a prompt is rebuilt.
4. It now covers: amended guidance and a manager's redo reason (were cut at 1,000), upstream output (12,000), a check's findings for its fix step (8,000), hand-off answers (6,000 in the prompt, 8,000 in the log), consult answers (6,000/8,000), the consulted step's earlier output (8,000), children's reports in a manager's review (4,000), and each child's part of a manager's summary (was a 1,500-character tail).
5. The fold keeps earlier guidance while all of it fits in 32,000 characters, else only the newest, always whole (it kept the last 2,000).
6. Left as they were: the diff in a prompt (30,000; not a step's output), the 400-character guidance of a chat "guide" option (a person picks it), a person's free-text answers (2,000), the plan's own length caps.

**Fences (§3.3)**
7. One scanner, `src/protocolLines.ts`, for `@HAND`, `@ASK user:` and step `@ASK` lines (the last ignored fences before). Indented code is four spaces or a tab; list items are not tracked, so a fence opened on a `- ` line is not seen. A step `@ASK` may still start up to three spaces in.

**Auto-fix (§3.4)**
8. Event-driven in the server (`src/autofix.ts`), reusing `decide`, `culprit`, `failureBrief` and runchat's run detail and model call. Not `supervise()`, whose loop waits in memory; the CLI and the TUI keep it.
9. Round 1's diagnosis is one read-only call to the assistant's agent (the orchestrator link) in the run's worktree, given the failed steps' full outputs (passed on as in §3.2), answering `{"guidance","needsWrites"}`. No model or an unusable reply: a plain retry. The guidance goes to every failed agent step and to the step `culprit` blames, as "Auto-fix diagnosis (round 1): …". Only round 1 diagnoses, as the spec says.
10. The give-up reason: past its rounds, the run's error line; otherwise the rule that stopped it ("nothing stronger to try", a hard stop). Needs you shows it ("Auto-fix gave up after 3 rounds: …", capped at 120 characters): the one place attention now carries error text.
11. A person's retry or resume ends a cycle; if the run fails again, a new cycle starts with fresh rounds. Stop between rounds ends auto-fix ("Stop auto-fix" in the run header).
12. "Read-only" means a team run with writes off; a workflow sets read-only per step and is never asked. Allow edits on a failed run turns on the plan's writes, `allowWrites` and (with hand-offs on) `allowWorkerWrites`; steps already handed out read-only stay read-only, so the manager hands out write work with the diagnosis.
13. A run that failed outside any step (while planning) is left alone, as are probes, cap stops with caps on, rejected runs and gone worktrees.
14. After a restart, a cycle between rounds carries on; a run that failed while the server was down, before any round, is not picked up.
15. A fresh loop budget: a manager's redo count, and the redos counted in the spawn budget, start over after any retry (the person's or auto-fix's), as the fold already does for checks.
16. A failed run auto-fix is working on reports live: it shows under Live, not as a Failed card, until auto-fix gives up.
17. Not changed: a team's channel may post a run's failure before auto-fix fixes it.

**Recommendations (§3.5), old → new**
18. Writes card: no → yes (why: a read-only run cannot do a task that changes files; edits stay in the worktree until approved).
19. The planner's own cards: no rule → recommend what finishes the task, never what makes it impossible. Workers' `@ASK user:`: the same.
20. Try more ways' default picks: free models first → free models last (a weaker, capped model is the try most likely to fail; the owner runs on a paid subscription).
21. Kept, with why: a goal's approval stays "ask each run" (auto with no run cap could loop without end; auto-fix already heals a run within itself); team runs stay live (a worker's question is rare and the person's to decide); New goal's workflow stays team; trigger and schedule forms keep full-review, the first preset and the default project; Spending caps off (PR #31); Auto-fix on; Tether's proposed commands still ask each time (safety); asks still become goals.

**Plan check (§3.5)**
22. A heuristic in `src/runLabels.ts` (`planConflict`), shared with the web: the task's first line or the plan's goal starts with a change verb (update, fix, add, write, refactor…), or a success criterion says something is updated, changed, fixed…; and writes are off, or every assignment is read-only. Needs you then shows "Check the plan: <why>" with Allow edits instead of Plan ready, and the plan review shows the same with "Allow edits and plan again" (the writes card answered yes, then one more planning call). The person may still approve it as it is.

**No silent failures (§3.5)**
23. A `run.notice` event (the last 50 kept), shown under the run header, newest first, three then "and N more": a refused hand-off, a question to a missing step or one that could not answer, a worker question Tether answered for the person, a manager's ignored or refused redo and unusable review, long text passed on as a file, an expired session restarted, a step run without its learned guidance. A skipped step's story row says why.
24. Not added: vault and reflection failures (best effort, they never change a run), and notices in the terminal UI (they show in its event list).
