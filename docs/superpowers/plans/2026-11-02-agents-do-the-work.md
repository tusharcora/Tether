# Agents Do the Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From chat, any agent recommends the cheapest way to do a job and, on a click, does it in any folder and checks its work, with "Trust this folder?", commands on every model, and one-click Undo. This is stage 2 of 6 of the agent-first design (§8).

**Architecture:** The chat turn stays read-only and adds one route card to its reply. Do it myself starts a one-step run in a hidden worktree, and a plain folder's finished work lands by itself through stage 1's `landRun`, so Undo, conflicts, costs and rewind are all reused. Trust is one file under home; a trusted folder gives the step a `commands` flag, which each adapter turns into its own shell ability under one shared rule.

**Tech Stack:** TypeScript (ESM), Node 22, vitest, React in `web/`, the `claude` CLI and the OpenAI-compatible adapter.

**Spec:** `docs/superpowers/specs/2026-11-01-agent-first-design.md`, §6.3, §6.4, §6.7, §6.9.

**Where this differs from the spec, on purpose (the owner confirms these with the plan):**
- Do it myself works in a hidden worktree and lands at the end, not live in the folder. The person sees the same result, with a landing conflict check instead of edits racing theirs. It also satisfies §6.4's one-writer rule.
- In a real git repo, Do it myself stays in a worktree and ends on today's Merge or Open PR banner, the alternative §6.4 names, rather than leaving uncommitted edits on the checked-out branch.
- The always-ask list refuses the command in this stage: the agent gets the reason and tells the person. A per-command approve button during a run waits for a later stage.
- Work continues in a fresh run with the task and the chat's recent text, not a resumed session. The adapters' resume support differs, and that is a saving to add later.

**Not in this plan:** memory and briefs (stage 3), leads and specialists, agent chats, the new sidebar (stage 4), the cross-project queue (stage 5). An @mentioned crew agent takes the same path as Tether here; "one turn path" finishes in stage 4 when Tether stops being special in the UI.

## Global Constraints

- A chat turn stays read-only: it never edits files or runs commands.
- Tether never tells a person to use another tool, or to set up git, for work Tether can do.
- Plain folders show no git words: no branch, merge, PR, commit or repository.
- Trust question, verbatim: **Trust this folder?** Body, verbatim: "Agents can run commands here, like tests and installs. Undo restores files, but it can't reverse everything a command does. Some things always stop and ask first. Files in a downloaded project can try to steer an agent, so only trust folders you know."
- Trust lasts for that folder and every agent, and can be withdrawn in Settings.
- Refused even when trusted: `sudo` and system settings; `git push`, merges and history rewrites; anything acting outside the folder; anything that publishes, sends or spends; `aorch evolve` and `harness … rollback`.
- In an untrusted folder, nothing runs and the agent says "not checked".
- Estimates are rough and read "about".
- `MAX_COMMAND_MS = 120_000`, `MAX_COMMAND_OUTPUT = 20_000` characters, tail kept.

## Review Focus

1. A reply with a malformed route, or one naming a workflow that doesn't exist, must drop that row and keep the text, not fail the turn. (Task 5)
2. A second click on a route card, or two tabs, must start one run only. (Task 5)
3. A chained command (`npm test && git push`, `x; sudo y`, `$(git push)`) must be refused as if run alone. (Task 2)
4. A folder deleted or renamed after being trusted must count as untrusted, and a symlink must trust its real path. (Task 2)
5. A solo run that fails, or lands into a conflict, must say so plainly in the chat card and leave the folder alone. (Tasks 4, 6)
6. Claude's Bash must go through the same `commandRule` as every other model, and a broken hook must refuse rather than let the command run. (Task 3)

---

### Task 1: A plain ticket knows it's plain

**Files:**
- Modify: `src/goals/routes.ts:100-105`
- Test: `test/tickets.test.ts`

**Interfaces:**
- Consumes: `insideGit`, `getWorkspace`.
- Produces: `GoalView.plain` is true for any ticket on a plain Workspace, with or without a run.

- [ ] **Step 1: Write the failing test**

```ts
it('a ticket on a plain Workspace is plain before it has a run', async () => {
  const t = await ticketOn(plainFolder({ 'a.txt': '1' }));
  expect(t.plain).toBe(true);
});
it('a ticket in a real repo is not', async () => {
  expect((await ticketOn(makeRepo())).plain).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/tickets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the run-based check with `!insideGit(path)` for the ticket's Workspace, once per view. A missing Workspace keeps the old run-based answer.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/tickets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/goals/routes.ts test/tickets.test.ts
git commit -m "A ticket on a plain folder is plain before it has a run"
```

### Task 2: Trust and the command rule

**Files:**
- Create: `src/trust.ts`
- Modify: `src/permissions.ts`, `src/server.ts`
- Test: `test/trust.test.ts`, `test/permissions.test.ts`

**Interfaces:**
- Produces, in `src/trust.ts`:
  - `trustState(home: string, folder: string): 'trusted' | 'refused' | 'unknown'`
  - `setTrust(home: string, folder: string, trusted: boolean): void`
  - `clearTrust(home: string, folder: string): void`
  - `listTrust(home: string): { folder: string; trusted: boolean; exists: boolean }[]`
- Stored at `<home>/trust.json` (0600, written atomically, keyed by real path). A missing or unreadable file means nothing is trusted.
- Produces, in `src/permissions.ts`: `commandRule(command: string): { ok: true } | { ok: false; why: string }`.
- Routes: `GET /api/trust` lists; `PUT /api/trust` with `{ folder, trusted }`; `DELETE /api/trust` with `{ folder }` withdraws.

- [ ] **Step 1: Write the failing tests**

```ts
describe('trust', () => {
  it('starts unknown, remembers yes and no, and withdraws', () => {
    const { home, folder } = rig();
    expect(trustState(home, folder)).toBe('unknown');
    setTrust(home, folder, true);
    expect(trustState(home, folder)).toBe('trusted');
    clearTrust(home, folder);
    expect(trustState(home, folder)).toBe('unknown');
  });
  it('a symlink trusts the real folder', () => {});
  it('a deleted or renamed folder is not trusted', () => {});
  it('a corrupt file trusts nothing', () => {});
  it('writes the file owner-only', () => {});
});

describe('commandRule', () => {
  it.each(['npm test', 'pytest -q', 'npm install', 'ls -la', 'git status', 'git diff', 'git add -A', 'git commit -m x'])('runs %s', (c) => expect(commandRule(c).ok).toBe(true));
  it.each(['sudo rm x', 'git push', 'git push origin main', 'git merge main', 'git rebase main', 'git reset --hard HEAD~3', 'npm publish', 'gh pr create', 'gh pr merge 1', 'curl -X POST https://x', 'rm -rf /', 'rm -rf ~/x', 'cd /etc', 'cat ../secret', 'aorch evolve bolt', 'aorch harness bolt rollback 2', 'defaults write x y 1'])('refuses %s', (c) => expect(commandRule(c).ok).toBe(false));
  it.each(['npm test && git push', 'x; sudo y', 'a | sudo tee b', 'echo $(git push)', 'echo `git push`', 'FOO=1 git push', 'env git push', 'bash -c "git push"', 'sh -c "sudo x"', 'eval git push'])('sees through %s', (c) => expect(commandRule(c).ok).toBe(false));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/trust.test.ts test/permissions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`commandRule`: reuse `BLOCKED` and `needsApproval`. Split on `;`, `&&`, `||`, `|`, newlines, `$(…)` and backticks. For each part, strip leading `VAR=value`, `env`, `command`, `exec`. Treat `bash -c`, `sh -c`, `zsh -c` and `eval` by checking their text as a command. Refuse any path argument that is absolute or climbs with `..` above the folder, except `/dev/null`, `/tmp` and `/usr/bin/env`.

```ts
// shortcut: this matches text, so it stops mistakes, not a hostile project; the macOS Seatbelt port is the real boundary
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/trust.test.ts test/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trust.ts src/permissions.ts src/server.ts test/trust.test.ts test/permissions.test.ts
git commit -m "Trust a folder, and one rule for what commands may run"
```

### Task 3: Commands on every model

**Files:**
- Modify: `src/types.ts:829-836`, `src/adapters/claude.ts:99-115`, `src/adapters/openai.ts`, `src/codemode/connectors/repo.ts`, `src/codemode/session.ts`, `src/engine.ts:2069-2080`
- Test: `test/openrouter-adapter.test.ts`, `test/codemode-runtime.test.ts`, `test/engine.test.ts`

**Interfaces:**
- Consumes: `commandRule`, `trustState`.
- Produces:
  - `AgentRequest.commands?: boolean`: the step may run commands.
  - `runCommand(root: string, command: string, signal: AbortSignal): Promise<string>` in `src/permissions.ts`: checks `commandRule`, runs `sh -c` in `root`, keeps the tail of the output, and returns text. A refusal returns text that says why and tells the agent to tell the person; it never throws at the model.
  - OpenAI tool `run_command` with `{ command: string }`, offered only when `commands` and writable.
  - Code Mode connector method `repo.run(command)`, marked `write: true`, present only when `commands`.
  - `src/commandHook.ts`: a Claude Code `PreToolUse` hook script. It reads the hook's JSON on stdin, runs `commandRule` on `tool_input.command`, and refuses with exit 2 and the reason on stderr. Any failure of its own also exits 2.

- [ ] **Step 1: Write the failing tests**

```ts
it('offers run_command only in a trusted writable step, and runs it in the step folder', async () => {
  const seen = await fakeOpenAI({ commands: true, calls: [{ run_command: { command: 'echo hi > made.txt && cat made.txt' } }] });
  expect(seen.tools).toContain('run_command');
  expect(seen.result).toContain('hi');
  expect(existsSync(join(seen.cwd, 'made.txt'))).toBe(true);
});
it('has no run_command without trust, or on a read-only step', async () => {});
it('tells the model why a refused command did not run', async () => {
  const seen = await fakeOpenAI({ commands: true, calls: [{ run_command: { command: 'npm test && git push' } }] });
  expect(seen.result).toMatch(/not run/i);
});
it('cuts long output to its tail and stops at the time limit', async () => {});
it('Code Mode has repo.run only with commands', async () => {});
it('Claude gets Bash, guarded by the command hook, only with commands', () => {
  const args = claudeArgs({ commands: true, readOnly: false });
  expect(args.join(' ')).toContain('--allowedTools');
  expect(args[args.indexOf('--settings') + 1]).toContain('PreToolUse');
  expect(claudeArgs({ readOnly: false }).join(' ')).not.toContain('Bash');
  expect(claudeArgs({ readOnly: false })).not.toContain('--settings');
});
it('the command hook refuses what commandRule refuses, and refuses if it breaks', () => {
  expect(hook({ tool_input: { command: 'npm test' } }).status).toBe(0);
  const no = hook({ tool_input: { command: 'cd /etc' } });
  expect(no.status).toBe(2);
  expect(no.stderr).not.toBe('');
  expect(hookRaw('not json').status).toBe(2);
  expect(hook({ tool_input: {} }).status).toBe(2);
});
it('a run in a trusted folder sends commands; an untrusted one does not', async () => {});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/openrouter-adapter.test.ts test/codemode-runtime.test.ts test/engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The engine sets `commands: !node.readOnly && trustState(home, s.repo) === 'trusted'`. For Claude, export a pure `claudeArgs(req)`, add `--allowedTools Bash` merged with what Code Mode passes (`claudeCodeModeArgs`, `src/codemode/delivery.ts`), and `--settings` with inline JSON holding a `PreToolUse` hook on `Bash`. The hook's command runs `src/commandHook.ts`'s built file with this process's own runtime and ends in `|| exit 2`, because Claude Code treats any other non-zero exit, such as a missing file, as non-blocking and would run the command. It must work from the packaged app too, so check how the app finds its node runtime and built files. Then prove it once on a real `claude -p` with the cheapest model: a refused command must not run. That one run is approved by the owner; no other check spends tokens. If `commands` is false, the step's prompt gains: "You can't run commands here, so end by saying what you did not check." Update the OpenAI system text and the file's header comment, since "There is no shell tool" stops being true.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/openrouter-adapter.test.ts test/codemode-runtime.test.ts test/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "Trusted folders give every model commands, under one rule"
```

### Task 4: A solo run lands by itself

**Files:**
- Create: `src/solo.ts`
- Modify: `src/runShip.ts`, `src/types.ts`, `src/engine.ts`, `src/prompt.ts`
- Test: `test/solo.test.ts`

**Interfaces:**
- Consumes: `landRun` in `RunShip`, `run.shipped`.
- Produces:
  - `soloPipeline(o: { task: string; bot?: string; agent?: string; model?: string }): Pipeline`: `name: 'solo'`, one agent node `work` with role `o.bot ?? 'coder'`, `maxLoops` none.
  - `run.started` and `RunState` gain `solo?: true`; `engine.start` input gains `solo?: boolean`.
  - `CAREFUL` in `src/prompt.ts`: spec §6.7's five rules, one line each, added to every writable step's prompt.

- [ ] **Step 1: Write the failing tests**

```ts
it('a solo run in a plain folder lands when it finishes, with Undo', async () => {
  const { ship, store, id, folder } = await soloRun({ 'b.txt': 'two\n' });
  await ship.idle();
  expect(read(folder, 'b.txt')).toBe('two\n');
  expect(store.state(id)!.ship).toMatchObject({ merged: true, landed: { files: ['b.txt'] } });
  await ship.undo(id);
  expect(existsSync(join(folder, 'b.txt'))).toBe(false);
});
it('a failed solo run lands nothing and says why', async () => {});
it('a solo run whose file the person changed stops, names it, and changes nothing', async () => {});
it('a solo run with no changes says nothing needed changing and lands nothing', async () => {});
it('a solo run in a real repo finishes on the ordinary decision and pushes nothing', async () => {});
it('writable steps get the care rules; read-only steps do not', () => {});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/solo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `RunShip`'s `run.finished` listener, a `done` run with `s.solo && s.history` goes through the same ship path as `decide`. A real repo's solo run isn't touched.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/solo.test.ts test/run-ship.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "Do it myself: a one-step run that lands by itself"
```

### Task 5: The route card, server side

**Files:**
- Modify: `src/assistant/types.ts`, `src/assistant/reply.ts`, `src/assistant/prompt.ts`, `src/assistant/goalDraft.ts`, `src/assistant/turn.ts`, `src/assistant/routes.ts`, `src/prefs.ts`
- Test: `test/assistant-route.test.ts`

**Interfaces:**
- Consumes: `soloPipeline`, `trustState`, `goalFromDraft`, `checkDraft`.
- Produces:
  - `RouteKind = 'solo' | 'ticket' | 'workflow' | 'team'`
  - `RouteCard { id: string; task: string; recommend: RouteKind; rows: { kind: RouteKind; why: string; cost: string }[]; workflow?: string; draft?: GoalDraft; status: 'proposed' | 'started' | 'dismissed' | 'failed'; chose?: RouteKind; runId?: string; goalId?: string; note?: string }`, on `ChatMessage.route`.
  - In the block: `"route":{"task":"…","recommend":"solo","rows":[{"kind":"solo","why":"…","cost":"about 8k tokens"}],"workflow":"…","draft":{…}}`.
  - `POST /api/assistant/routes/:id` with `{ ws, chat, choice: RouteKind | 'dismiss', trust?: boolean }`. Answers 200 `{ route }`, or 409 `{ needsTrust: true, folder }` when `choice` is `solo` and the folder is `unknown`. With `trust`, it saves the answer first.
  - Prefs: `soloWithoutAsking?: boolean`. When true, a trusted folder and a `solo` recommendation start at once, and the card shows as started.

- [ ] **Step 1: Write the failing tests**

```ts
describe('route card', () => {
  it('keeps a good route and cuts it from the text', async () => {});
  it('drops a row with an unknown kind, an unknown workflow, or no why, and keeps the text', async () => {});
  it('a route whose recommendation lost its row keeps the rest and recommends solo', async () => {});
  it('every cost reads about, or is dropped', async () => {});
  it('solo starts one run; a second click returns the same run', async () => {});
  it('solo in an unknown folder answers needsTrust and starts nothing', async () => {});
  it('solo with trust: true saves it and starts; trust: false saves it and starts without commands', async () => {});
  it('ticket makes a paused ticket; team starts a team run; workflow starts that workflow', async () => {});
  it('dismiss starts nothing', async () => {});
  it('soloWithoutAsking starts at once in a trusted folder, never in an unknown one', async () => {});
  it('a plain question has no card', async () => {});
  it('an @mentioned agent gets a card and its work runs as that agent', async () => {});
  it('a squad turn gets no card', async () => {});
  it('no prompt can tell a person to use another tool', () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/never tell the person to use another tool/i);
    expect(p).not.toMatch(/you are read-only: you never change files/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/assistant-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Prompt: replace the "You are read-only…" sentence with: "You don't change files in this reply. When the person asks you to do something, say in a sentence what you'd do, and offer the routes in a `route` block. Do it yourself is the default for one job in one place. Git isn't needed: work runs in any folder. Never tell the person to use another tool, or to set up git, for work Tether can do. If something truly can't be done, say what would make it possible inside Tether." `goalsPromptPart` becomes the route instruction, and the old `proposals` for asks go. The existing goal card and workflow and team proposals stay readable on old chats. `drafts` applies to an @mentioned agent's turn too, and never to `o.ephemeral`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/assistant-route.test.ts test/assistant.test.ts test/goal-drafts.test.ts`
Expected: PASS, with goal-draft tests updated where the instruction changed.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "Chat recommends how to do the work, and starts it on a click"
```

### Task 6: The card, Trust and Settings in the app

**Files:**
- Create: `web/src/assistant/RouteCard.tsx`
- Modify: `web/src/assistant/api.ts`, `web/src/assistant/Thread.tsx`, `web/src/assistant/cards.tsx`, `web/src/ui/studio/SettingsPage.tsx`, the composer's "Turn asks into tickets" control
- Test: `web/src/assistant/cards.test.tsx`, `web/src/ui/studio/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 5's routes, `GET /api/runs/:id`, `POST /api/runs/:id/undo-land`, `/api/trust`.

Card states, matching the prototype's Agent chat screen:

| State | Shows |
|---|---|
| proposed | "How I'd do this", four rows, the recommended row tinted, cost in mono, buttons: the recommendation primary, then the others present, then "Don't ask for small jobs" as a small checkbox |
| working | "Doing it myself · saved a checkpoint first" and the live step line |
| landed | `{file} · +n −n` or `n files`, **See changes** (opens the run), **Undo** |
| undone | "Undone. Your folder is back to how it was." |
| conflict or failed | The server's plain text, with **Open the run** |
| real repo, done | "Ready" with **Open the run** |

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows four rows, marks the recommendation, and starts it', async () => {});
it('asks Trust this folder? with the exact words, then starts', async () => {
  answerOnce(409, { needsTrust: true, folder: '/x' });
  await click('Do it myself');
  expect(screen.getByRole('dialog', { name: 'Trust this folder?' })).toHaveTextContent("Undo restores files, but it can't reverse everything a command does.");
  await click('Trust');
  expect(lastPost().trust).toBe(true);
});
it('Not now still does the work, without commands', async () => {});
it('moves through working to landed and undoes', async () => {});
it('shows the conflict in plain words, with no git words', async () => {});
it('a plain card has no merge, branch, PR or commit', async () => {});
it('Settings lists trusted folders and withdraws one', async () => {});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/assistant/cards.test.tsx web/src/ui/studio/SettingsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Poll the run through the existing hook while `working`. The dialog is the app's `Dialog`, focus-trapped, with buttons **Trust** and **Not now**. Remove the composer's "Turn asks into tickets" checkbox and its setting route's UI, and leave the server pref alone.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "The route card, Trust this folder?, and trusted folders in Settings"
```

### Task 7: Whole-flow check and docs

**Files:**
- Modify: `README.md`, `docs/HANDOFF.md`
- Test: `test/agent-flow.test.ts`

- [ ] **Step 1: Write the end-to-end test**

```ts
it('asks in chat, trusts the folder, does it, lands, undoes', async () => {
  // a plain Workspace `Masters HW` with hw3.py; a mock reply with a route block; POST the route: 409 needsTrust; POST with trust: true
  // the mock step edits hw3.py: expect the card's run done, hw3.py changed, no .git, .aorch or .tether in the folder
  // undo-land: hw3.py as it began
});
```

- [ ] **Step 2: Run the whole check**

Run: `npm run typecheck && npm run build && npx vitest run --testTimeout=30000`
Expected: all pass, with nothing else running.

- [ ] **Step 3: Update the docs**

README: the route card, trust, what commands may do and what's refused, and that real repos end on the ordinary decision. HANDOFF: this branch, what to check in the app, and the four deliberate differences from the spec.

- [ ] **Step 4: Commit**

```bash
git add test/agent-flow.test.ts README.md docs/HANDOFF.md
git commit -m "Chat to folder and back, end to end; docs"
```
