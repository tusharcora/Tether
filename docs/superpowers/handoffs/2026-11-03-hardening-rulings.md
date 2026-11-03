# Hardening rulings

Every decision taken on the owner's behalf while building the hardening PR (#37), in order, from the build ledger: what was decided, why, and what it costs if wrong.

- Ruling: T1 an agent is resolved from the route's bot binding the same way engine.start resolves it, and a binding that can't be resolved counts as an own-shell agent — refusing is the safe side — a misconfigured bot asks for trust.
- Ruling: T6 only remove leaked worktrees under the system temp folder on aorch/* branches with no commits unreachable from other refs; anything else is listed for the owner — destructive step limited to provable test leftovers — some leftovers remain.
- Ruling: T4 extract the trust dialog to a shared component if both places need it — no duplicated verbatim text — a small move in web/.
- Ruling: the old proposal-accept endpoint (assistant/routes.ts:248-253) gets the same own-shell gate — it starts the same agents from old chat cards — an old card in an untrusted folder asks for trust.
- Ruling: the folder path in the trust dialog stays — it's the person's own folder, not Tether's home — none.
- Ruling: Task 4's round-1 re-review is the controller's check — the fix adds only tests, src diff is empty, the implementer showed the mutation fail — a weak test would go unseen until the final review.
- Ruling: ignored paths obey stage 1's MAX_FILE_BYTES and MAX_FOLDER_FILES and are named when left out — the snapshot already does — a large build output never lands.
- Ruling: run view gets trusted from trustState server-side; "wasn't checked" stays while any step ran without commands and no stopped gate or check later passed — a solo run never checked stays honest — one more field on the run view.
- Ruling: Task 6 also covers temp-folder leaks: TMPDIR holds about 281,000 entries, likely from test runs; find which tests leave temp folders and make them clean up; remove only provable test leftovers (Tether test name prefixes, older than a day, not in use), list the rest — owner's temp folder may hold other apps' files — some leftovers remain.
- Ruling: content matching never decides what lands. It only decides whether an old path may leave: a gone file leaves when its match lands by the normal rules, or when nothing left out could be its move. Empty files never match by content — matching was steering landing — a rare move into a left-out path lands as a delete plus a notice.
- Ruling: an unmatched deletion is held back only when a left-out path could be its move (same size, or same name folded); otherwise it lands. Every held-back deletion is named to the person — Case B (a persistent big cache.db) blocked every later deletion silently — one more notice line.
- Ruling: replace per-file matching under ignored paths with one rule — when a step's ignored-path changes trip a limit, none of that step's ignored-path changes land: tracked files under ignored paths keep their base entries (no deletes, no edits), no ignored files are forced in, and the folders are named. Non-ignored paths keep add -A behaviour with the per-file size limit and the re-spelling rule. Hashing for content pairing goes — per-file pairing kept producing ways to lose a copy — a run that also changed small files in an ignored folder next to a huge build lands none of them, and is told so.
- Task 3: Ruling: ':(' pathspec — load-bearing, a step can't commit; smallest change is './'+path to check-ignore with the './' stripped from output, verified by the reviewer; carried into Task 7's dispatch with a test — none.
- Task 3: parked — Ruling: outside ignored paths, a rename grown past 25 MB lands the deletion while the new file is held; real, predates this task, Undo restores it — documented as a known limit in Task 7.
- Task 3: parked — Ruling: classification uses the step's own .gitignore; folders named per file for global or nested patterns; EINVAL untested — minor.
- Ruling: accept the challenge to the Task 3 parked item — every unsure deletion stays and is named while a non-ignored file is too big; the README and HANDOFF limit sentence goes — the code's own promise is that limits never take a person's file away — a deletion beside a big file waits a step, named.
- Ruling: fix wave also covers HANDOFF:53's stale GitHub-token clause, README:180's overstated temp cleanup, the settings.json-only cloud mode clause (#7), and engine.resolve inside the try (#5). Minors #4 and #6 deferred.
- Ruling: runsOwnShell — only a readPipeline failure returns false; any failure resolving agents counts as own-shell — the earlier safe-side ruling — a broken binding asks for trust.
- Ruling: plain-flow waits for ship.landed before reading the file — the product rewrites files through checkout, which is correct — none.

## Deferred and parked

- Task 1: minor (deferred): web test builds ApiError itself; Codex test comment misleading; custom crew in default roster makes the gate broad
- Task 2: minor (deferred): provider flags set only in Claude's settings.json env aren't seen, so cloud creds are dropped there; loose truthy parsing over-keeps; real check can't distinguish claudeEnv from Claude's own scrub
- Task 4: minor (deferred): 409 folder is the stored path, not its realpath
- Task 3: minor (deferred): a person's edit between pre-snapshot and checkout inside move (predates); left-out list names __pycache__ from test runs
- Task 5: minor (deferred): an HTTP gate passing clears the line without a trust stop; trust file read uncached per run view
- Task 6: minor (deferred): 2,000-hit window is still ripgrep-ordered on huge repos; helpers cleanup assumes per-file isolation; acceptOffer kind:'run' uses process.cwd() with no test guard; ~29 direct mkdtempSync calls and history-land's plain-*-moved still leak temp folders
- Task 3: minor (deferred, for the owner): landBranch for a one-file change took 60 s at 50k files and 226 s at 100k on macOS (46 s and 186 s on Linux), likely predates stage 2; the owner's real folder is about 52k files.
- Task 3: parked — Ruling: outside ignored paths, a rename grown past 25 MB lands the deletion while the new file is held; real, predates this task, Undo restores it — documented as a known limit in Task 7.
- Task 3: parked — Ruling: classification uses the step's own .gitignore; folders named per file for global or nested patterns; EINVAL untested — minor.
- Task 3: complete (commits 6ab5fd1..40602b6, 1 carried to T7, 2 parked)
- Ruling: accept the challenge to the Task 3 parked item — every unsure deletion stays and is named while a non-ignored file is too big; the README and HANDOFF limit sentence goes — the code's own promise is that limits never take a person's file away — a deletion beside a big file waits a step, named.
