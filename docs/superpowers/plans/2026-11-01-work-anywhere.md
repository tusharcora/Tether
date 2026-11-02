# Work Anywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every run path (workflows, teams, tickets, squads) works in a plain folder with no git, and finished work lands in the folder with one-click Undo. This is stage 1 of 6 of the agent-first design (§8) and fixes the HW3 failure on its own.

**Architecture:** Each plain folder gets a hidden bare git repo at `<home>/history/<hash>.git`, using the folder as its work tree through `GIT_DIR` and `GIT_WORK_TREE`. A run starts from a snapshot commit, then uses the existing worktree, commit, diff and rewind code unchanged, because a linked worktree of a bare repo is an ordinary git worktree. Only two things are new: taking snapshots, and landing a branch back into the folder.

**Tech Stack:** TypeScript (ESM), Node 22, the `git` CLI through `src/git.ts`, vitest, React in `web/`.

**Spec:** `docs/superpowers/specs/2026-11-01-agent-first-design.md`, §6.0 (folders), §6.4 (work in any folder).

**Verified by a spike on git 2.54 (2026-11-01):** `git init --bare`; `add -A` with `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` set, honouring `info/exclude`; `worktree add` from the bare repo; a symlink in the worktree stays hidden if `info/exclude` names it; `checkout <sha> -- <paths>` writes into the folder; `git rev-parse --show-toplevel` **fails** in a bare repo, so every helper that calls it must change (Task 2). The folder had no `.git` afterwards.

**Not in this plan:** Do it myself and "Trust this folder?" (stage 2, with commands), Firecrawl and generative UI (stage 6), picking an unregistered folder in the composer (stage 4), a job's in-place Undo (stage 2, built on Task 3's functions). Later plans get written when the stage before them lands, because they build on its code.

## Global Constraints

- A plain folder gets nothing from Tether: no `.git`, no `.aorch/`, no `.tether/`. Known gap: `.aorch/http` and `workspace init` are written only when a person saves a request or runs that command, and move in stage 4.
- No git words in the UI for a plain folder: no branch, merge, PR, commit or repository.
- Undo never overwrites a person's work silently. It stops, names the files, and changes nothing.
- Real git repos behave as they do today, except that uncommitted work is included in a run (spec §6.4).
- `MAX_FILE_BYTES = 25 * 1024 * 1024` and `MAX_FOLDER_FILES = 100_000`.
- Left out of the history by name at any depth: `node_modules`, `.venv`, `venv`, `__pycache__`, `.DS_Store`.
- Every failure a person can hit is plain text with no home path (`<home>` in messages, as in README's error rule).

## Review Focus

1. A run started on the home folder or `/` must be refused at once with a plain message, not walk the whole disk. (Task 1)
2. A folder over `MAX_FOLDER_FILES` must be refused with a plain message that names the limit, not hang. (Task 1)
3. A file edited in the folder during a run must stop landing, name the file, and change nothing. (Task 3)
4. A git repo nested inside a plain folder must be left out, linked in, and named in a notice, not added as an empty gitlink. (Tasks 1, 2)
5. File names with spaces, non-ASCII letters or newlines must land correctly: `Masters HW` is a real folder here. (Task 3)

---

### Task 0: Branch

- [ ] **Step 1: Create the branch and commit the design**

```bash
git switch -c feature/agent-first
git add docs/superpowers/specs/2026-11-01-agent-first-design.md docs/design/agent-first docs/superpowers/plans/2026-11-01-work-anywhere.md
git commit -m "Agent-first design, prototype and the work-anywhere plan"
```

### Task 1: Hidden history and snapshots

**Files:**
- Create: `src/history.ts`
- Modify: `src/git.ts:5-25`
- Test: `test/history.test.ts`

**Interfaces:**
- Consumes: `git`, `must` from `src/git.ts`.
- Produces, in `src/git.ts`: `gitEnv(cwd: string, args: string[], env: Record<string, string>): Promise<GitResult>`, and `must` exported.
- Produces, in `src/history.ts`:
  - `insideGit(dir: string): boolean`: sync, walks up from `dir` looking for `.git` (a folder or file).
  - `class FolderRefused extends Error`
  - `historyDir(home: string, folder: string): string`: `<home>/history/<first 16 hex of sha256 of realpath>.git`
  - `interface Snapshot { sha: string; leftOut: string[] }`
  - `snapshotFolder(home: string, folder: string): Promise<Snapshot>`: inits the repo if missing, writes `info/exclude`, makes a commit on `refs/heads/main`. Reuses the parent when the tree is unchanged.
  - `withFolder<T>(history: string, folder: string, fn: (env: Record<string, string>) => Promise<T>): Promise<T>`: a unique temp index under `<history>/tmp-<random>`, removed in `finally`.
  - `snapshotDirty(top: string): Promise<string>`: real repos. Commits the working tree on a temp index with `HEAD` as parent, touching no ref or real index. Returns `HEAD`'s sha when nothing differs.

- [ ] **Step 1: Write the failing tests**

```ts
describe('history', () => {
  it('snapshots a plain folder without touching it', async () => {
    const { home, folder } = plain({ 'a b.txt': 'one\n' });
    const s = await snapshotFolder(home, folder);
    expect(await show(home, folder, s.sha, 'a b.txt')).toBe('one\n');
    expect(readdirSync(folder)).toEqual(['a b.txt']);
  });
  it('reuses the last commit when nothing changed', async () => {
    const { home, folder } = plain({ 'a.txt': '1' });
    expect((await snapshotFolder(home, folder)).sha).toBe((await snapshotFolder(home, folder)).sha);
  });
  it('leaves out dependencies, large files and nested repos, and says so', async () => {
    const { home, folder } = plain({ 'a.txt': '1', 'node_modules/x/i.js': '1', 'sub/.venv/y': '1' });
    writeFileSync(join(folder, 'big.bin'), Buffer.alloc(MAX_FILE_BYTES + 1));
    mkdirSync(join(folder, 'inner'));
    execFileSync('git', ['init', '-q'], { cwd: join(folder, 'inner') });
    const s = await snapshotFolder(home, folder);
    expect(s.leftOut.sort()).toEqual(['big.bin', 'inner', 'node_modules', 'sub/.venv']);
    expect(await names(home, folder, s.sha)).toEqual(['a.txt']);
  });
  it('refuses the home folder and the root', async () => {
    await expect(snapshotFolder(tmp(), homedir())).rejects.toBeInstanceOf(FolderRefused);
    await expect(snapshotFolder(tmp(), '/')).rejects.toThrow(/too big|whole/);
  });
  it('refuses a folder with too many files, naming the limit', async () => { /* a fixture with MAX_FOLDER_FILES lowered through an optional third parameter */ });
  it('insideGit sees a parent repo', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'sub'));
    expect(insideGit(join(repo, 'sub'))).toBe(true);
    expect(insideGit(tmp())).toBe(false);
  });
  it('snapshotDirty includes uncommitted and untracked work and leaves the repo alone', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    const before = status(repo);
    const sha = await snapshotDirty(repo);
    expect(show(repo, sha, 'new.txt')).toBe('new\n');
    expect(status(repo)).toBe(before);
    expect(head(repo)).not.toBe(sha);
  });
  it('snapshotDirty returns HEAD for a clean repo', async () => {
    const repo = makeRepo();
    expect(await snapshotDirty(repo)).toBe(head(repo));
  });
});
```

`plain()`, `show()`, `names()`, `status()` and `head()` are small helpers in the test file, using `tmp` and `makeRepo` from `test/helpers.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/history.test.ts`
Expected: FAIL, `src/history.ts` does not exist.

- [ ] **Step 3: Implement `gitEnv` in `src/git.ts` and everything above in `src/history.ts`**

The walker uses `lstat`, never follows a symlink, stops counting at the limit, and treats a folder holding `.git` as left out. Refuse `/` and `homedir()` before walking, and any folder that is a parent of `home`. Messages: `"This folder is too big to work in: it is your whole home folder. Pick a project folder inside it."` and `"This folder has more than 100,000 files, so Tether can't keep an undo history for it."` Commits use `commit-tree`, with `commit.gpgsign` never involved. `info/exclude` holds the skip names plus each left-out path, anchored with a leading `/`.

```ts
// shortcut: history grows without pruning, add a sweep (git gc, old refs) when a folder's history passes a size people notice
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/history.ts src/git.ts test/history.test.ts
git commit -m "History: a hidden repo and snapshots for plain folders"
```

### Task 2: Runs start in plain folders

**Files:**
- Modify: `src/git.ts:38-47,50-73`
- Modify: `src/types.ts:246-253,402-405,493-495`
- Modify: `src/engine.ts:286-289,354,408,599` and both `run.started` appends
- Modify: `src/attempts.ts:246-247`
- Test: `test/plain-runs.test.ts`

**Interfaces:**
- Consumes: Task 1's `insideGit`, `snapshotFolder`, `historyDir`, `snapshotDirty`.
- Produces:
  - `gitTop(repo: string): Promise<string>` in `src/git.ts`: the bare repo itself when `rev-parse --is-bare-repository` says true, otherwise `--show-toplevel`. Replaces `--show-toplevel` in `createWorktree`, `cloneShared`, `removeWorktree`, `removeBranch`.
  - `Worktree` gains `history?: string; leftOut?: string[]`.
  - `gitRoot(repo: string, home: string): Promise<string>` in `src/history.ts`: the repo's top, or a plain folder's history after a snapshot.
  - `run.started` and `RunState` gain `history?: string`.
  - `linkLeftOut(workdir: string, folder: string, leftOut: string[]): void` in `src/history.ts`: symlinks each path, making parents.

- [ ] **Step 1: Write the failing tests**

```ts
describe('runs in a plain folder', () => {
  it('runs a workflow and leaves the folder alone', async () => {
    const { engine } = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'two\n' } } }], []);
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo: folder }));
    expect(s.status).toBe('done');
    expect(s.history).toBeTruthy();
    expect(existsSync(join(s.workdir, 'b.txt'))).toBe(true);
    expect(readdirSync(folder)).toEqual(['a.txt']);
  });
  it('starts a team run', async () => { /* engine.startTeam with a mock plan, on a plain folder: no throw, s.history set */ });
  it('deleting the run removes its worktree and branch from the history', async () => { /* engine.delete; `git -C history branch` lists no aorch/ branch */ });
  it('rewinds in a plain folder', async () => { /* a two-step run, rewind to before step two, expect the second file gone from s.workdir */ });
  it('gives a linked worktree its left-out files and a notice naming them', async () => {
    const { engine } = setup();
    const folder = plainFolder({ 'a.txt': '1', 'node_modules/x/i.js': 'dep' });
    const p = pipe([{ id: 'r', role: 'planner', readOnly: true, mock: { output: 'ok' } }], []);
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo: folder }));
    expect(readFileSync(join(s.workdir, 'node_modules/x/i.js'), 'utf8')).toBe('dep');
    expect((s.notices ?? []).map((n) => n.text).join()).toContain('node_modules');
    expect(status(s.workdir)).toBe('');
  });
  it('a real repo with uncommitted work carries it into the run', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    writeFileSync(join(repo, 'wip.txt'), 'mine\n');
    const p = pipe([{ id: 'r', role: 'planner', readOnly: true, mock: { output: 'ok' } }], []);
    const s = await engine.wait(await engine.start({ pipeline: p, task: 't', repo }));
    expect(readFileSync(join(s.workdir, 'wip.txt'), 'utf8')).toBe('mine\n');
    expect(s.history).toBeUndefined();
  });
  it('a run from a ref ignores uncommitted work', async () => { /* start with ref: 'HEAD~0'-style sha: wip.txt absent */ });
});
```

`plainFolder(files)` is a new helper in `test/helpers.ts`, writing the files into a `tmp()` folder with no git. Task 1's `plain()` wraps it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/plain-runs.test.ts`
Expected: FAIL, "not a git repository".

- [ ] **Step 3: Implement**

In `createWorktree`: if `insideGit(repo)` is false, take `snapshotFolder`, `base = ref && ref !== 'HEAD' ? rev-parse ref : snapshot.sha`, `worktree add` from the history, then `linkLeftOut`. In a real repo with no `ref`, or `ref === 'HEAD'`, `base = await snapshotDirty(top)`. In `engine.ts`, pass `wt.history` into both `run.started` appends, append a `run.notice` when `wt.leftOut?.length` (text: `"Left out of undo: ${list}. A change to these can't be undone."`, first 5 names then `and N more`). Clean-up calls at `engine.ts:286-289` and `attempts.ts:246-247` take `s.history ?? s.repo`; `engine.ts:354` takes `await gitRoot(input.repo, home)`.

- [ ] **Step 4: Run to verify it passes, then the existing suites**

Run: `npx vitest run test/plain-runs.test.ts test/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git.ts src/history.ts src/types.ts src/engine.ts src/attempts.ts test/helpers.ts test/plain-runs.test.ts
git commit -m "Runs start in plain folders; a real repo's uncommitted work comes along"
```

### Task 3: Land and undo

**Files:**
- Modify: `src/history.ts`
- Test: `test/history-land.test.ts`

**Interfaces:**
- Consumes: Task 1's `withFolder`, `snapshotFolder`.
- Produces:
  - `interface Landed { pre: string; post: string; files: string[] }`
  - `landBranch(home: string, folder: string, base: string, head: string): Promise<Landed | { conflicts: string[] }>`
  - `undoLanding(home: string, folder: string, l: Landed): Promise<true | { conflicts: string[] }>`

- [ ] **Step 1: Write the failing tests**

```ts
describe('landing', () => {
  it('adds, changes and deletes files, with awkward names', async () => {
    const { home, folder, base, head } = await run({ 'a b.txt': '1', 'é.txt': '1', 'gone.txt': '1' }, { 'a b.txt': '2', 'é.txt': '2', 'new.txt': '3' }, ['gone.txt']);
    const r = await landBranch(home, folder, base, head);
    expect('files' in r).toBe(true);
    expect(read(folder, 'a b.txt')).toBe('2');
    expect(read(folder, 'é.txt')).toBe('2');
    expect(read(folder, 'new.txt')).toBe('3');
    expect(existsSync(join(folder, 'gone.txt'))).toBe(false);
    expect(readdirSync(folder)).not.toContain('.git');
  });
  it('keeps a person\'s other changes', async () => { /* a different file edited in the folder after the snapshot survives */ });
  it('stops on a conflict, names the file, changes nothing', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    writeFileSync(join(folder, 'a.txt'), 'mine');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['a.txt'] });
    expect(read(folder, 'a.txt')).toBe('mine');
  });
  it('undo restores changed, added and deleted files', async () => { /* land, undoLanding: folder equals the start, new.txt gone, gone.txt back */ });
  it('undo stops if a landed file changed since, names it, changes nothing', async () => { /* land, edit new.txt, undoLanding gives { conflicts: ['new.txt'] } */ });
  it('undo leaves files it did not land alone', async () => { /* edit other.txt after landing: undo succeeds, other.txt keeps the edit */ });
  it('a missing folder is a plain error', async () => { /* rmSync the folder: rejects with /no longer there/ */ });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/history-land.test.ts`
Expected: FAIL, `landBranch` is not exported.

- [ ] **Step 3: Implement**

`landBranch`: take `pre = snapshotFolder`. List changes with `diff --no-renames --name-status -z base head`. The paths changed by the person are `diff --name-only -z base pre`. Conflicts are the intersection. Otherwise, under `withFolder`, `read-tree head`, `checkout head -- <paths>` in batches of 500 for A and M, `rmSync` for D with a check that the resolved path stays inside the folder, then `post = snapshotFolder`. `undoLanding`: `now = snapshotFolder`; conflicts are `diff --name-only -z post now` ∩ `files`; otherwise a path present in `pre` is checked out from `pre`, and a path absent from it is removed; then snapshot.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/history-land.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/history.ts test/history-land.test.ts
git commit -m "History: land a run's work in the folder, and undo it"
```

### Task 4: Shipping lands, for runs, squads and tickets

**Files:**
- Modify: `src/types.ts:271,452,745-750`
- Modify: `src/runShip.ts`
- Modify: `src/teams/teams.ts:812-832`
- Modify: `src/goals/loop.ts:470-482`
- Modify: `src/server.ts:1138-1146`
- Test: `test/run-ship.test.ts`, `test/teams-ship.test.ts`, `test/tickets.test.ts`

**Interfaces:**
- Consumes: Task 3's `landBranch`, `undoLanding`, `Landed`; Task 2's `history`.
- Produces:
  - `run.shipped` gains `landed?: Landed` and `undone?: true`. `RunState.ship` gains `landed?: Landed`.
  - The reducer deletes `s.ship` on `undone`.
  - `RunShip.undo(runId: string): Promise<void>`
  - `POST /api/runs/:id/undo-land`: 200, or 409 with `{ error }` naming the files.

- [ ] **Step 1: Write the failing tests**

In `test/run-ship.test.ts`:

```ts
it('lands a plain folder run instead of pushing', async () => {
  const { ship, store, folder, id } = await finishedPlainRun({ 'b.txt': 'two\n' });
  await ship.decide(id, true);
  await ship.idle();
  expect(read(folder, 'b.txt')).toBe('two\n');
  expect(store.state(id)!.ship).toMatchObject({ merged: true, landed: { files: ['b.txt'] } });
  expect(exec.calls).toEqual([]); // no gh, no push
});
it('a conflict is recorded in plain words and changes nothing', async () => { /* edit the same file first: ship.error contains the name and "changed since" */ });
it('undo restores the folder and lets it land again', async () => { /* ship.undo(id): file gone, state ship undefined, decide works again */ });
it('undo with a conflict rejects 409 naming the file', async () => {});
it('does not land twice', async () => { /* a second decide: HttpError 409 */ });
```

In `test/teams-ship.test.ts`:

```ts
it('a squad run in a plain folder lands and the ship card says it is in the folder', async () => {});
```

In `test/tickets.test.ts`:

```ts
it('a landed run moves its ticket to Done, and undo moves it back to In review', async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/run-ship.test.ts test/teams-ship.test.ts test/tickets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`RunShip.ship`: when `s.history`, call `landBranch(home, s.repo, s.baseSha, s.branch)`. On success append `{ type: 'run.shipped', merged: true, landed }`. On conflicts append an error: `"${names} changed since this work started, so nothing was put in the folder. Keep your version, or send this back."` `decide`'s guard refuses `s.ship?.landed` as well as `s.ship?.url`, and `RunShipDeps` gains `home`. In `teams.ts`, branch before `shipBranch` when `s.history`, and use copy `"It's in the folder."`, never "PR". In `loop.ts` `pr()`, the text is `ev.landed ? 'put the changes in the folder' : …`; on `ev.undone`, record what `dropPr` records (`loop.ts:443-448`) so the ticket returns to In review.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/run-ship.test.ts test/teams-ship.test.ts test/tickets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/runShip.ts src/teams/teams.ts src/goals/loop.ts src/server.ts test/run-ship.test.ts test/teams-ship.test.ts test/tickets.test.ts
git commit -m "Shipping a plain folder run lands it, with Undo, for runs, squads and tickets"
```

### Task 5: No git words for plain folders

**Files:**
- Modify: `web/src/runs/DecisionBanner.tsx`, `web/src/runs/OutcomeRail.tsx:41`, `web/src/runs/RunFiles.tsx:16`, `web/src/runs/RunDetails.tsx:53`, `web/src/runs/StepInspector.tsx:103`
- Modify: `web/src/code/Code.tsx:264`, `web/src/code/Code.test.tsx:312`
- Modify: `web/src/api.ts` (the run state type, and `undoLand`)
- Modify: `src/tui.ts:1395,1601,1632,1953`
- Test: `web/src/Runs.test.tsx`

**Interfaces:**
- Consumes: `POST /api/runs/:id/undo-land`, `run.history`, `run.ship.landed`.
- Produces: the copy below.

| Where | Real repo | Plain folder |
|---|---|---|
| Decision banner primary | Merge to main | **Put it in the folder** |
| Decision banner secondary | Open PR instead | not shown |
| After landing | PR link | **It's in your folder · {n} files** with **Undo** |
| Undo conflict | | The server's error text |
| Outcome rail, Branch row | Branch | not shown |
| Files heading | `Files · branch …` | `Files` |
| Empty diff | No committed changes on this branch yet. | No changes yet. |
| Code tab note | Not a git repository… | Tether keeps the undo history for this folder. |
| TUI prompt | Repository (a git repo): | Folder: |

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers Put it in the folder for a plain folder run, with no git words', async () => {
  renderRun({ ...doneRun, history: 'x', status: 'paused' });
  expect(screen.getByRole('button', { name: 'Put it in the folder' })).toBeTruthy();
  expect(screen.queryByText(/merge|branch|PR\b|commit/i)).toBeNull();
});
it('shows Undo after landing and says what stopped it', async () => {});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/Runs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the table**

`const plain = !!r.history`, read once per component. Update `Code.test.tsx:312` to the new note.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src src/tui.ts
git commit -m "Plain folder runs say folder, not branch, and offer Undo"
```

### Task 6: Chat leaves nothing in a plain folder

**Files:**
- Modify: `src/assistant/artifacts.ts:29-33,48-60`
- Modify: `src/assistant/prompts.ts:27-31`
- Test: `test/artifacts.test.ts`, `test/prompts.test.ts`

**Interfaces:**
- Consumes: Task 1's `insideGit`, `historyDir`.
- Produces: `folderState(home: string, root: string): string` in `src/history.ts`: `<home>/folders/<same hash as the history>`.

- [ ] **Step 1: Write the failing test**

```ts
it('keeps artifacts and prompts under home for a plain folder', () => {
  const home = tmp(); const folder = tmp();
  expect(artifactsDir(home, folder)).toBe(join(folderState(home, folder), 'artifacts'));
  expect(promptsFile(home, folder)).toBe(join(folderState(home, folder), 'prompts.json'));
});
it('keeps them in the project for a real repo, and uses what a plain folder already has', () => {
  const repo = makeRepo();
  expect(artifactsDir(tmp(), repo)).toBe(join(repo, '.aorch', 'artifacts'));
  const folder = tmp(); mkdirSync(join(folder, '.aorch', 'artifacts'), { recursive: true });
  expect(artifactsDir(tmp(), folder)).toBe(join(folder, '.aorch', 'artifacts'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/artifacts.test.ts test/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

A plain folder with no existing `.aorch/<thing>` uses `folderState`, so nothing a person already has is orphaned. The `.gitignore` writer at `artifacts.ts:48-60` does nothing for a plain folder. The existing symlink refusals stay.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/artifacts.test.ts test/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assistant src/history.ts test
git commit -m "Chat keeps a plain folder's artifacts and prompts under home"
```

### Task 7: Whole-flow check and docs

**Files:**
- Modify: `README.md`, `docs/HANDOFF.md`
- Test: `test/plain-flow.test.ts`

- [ ] **Step 1: Write the end-to-end test**

```ts
it('a ticket in a plain folder runs, lands, and undoes', async () => {
  // a ticket on a plain Workspace whose run edits hw3.py through the mock adapter, approved through the ticket's ship route
  // expect: run done, hw3.py changed in the folder, ticket Done, no .git or .aorch in the folder
  // undo: hw3.py as it began, ticket In review
});
```

- [ ] **Step 2: Run the whole check**

Run: `npm run check`
Expected: typecheck, all tests and the build pass.

- [ ] **Step 3: Check it in the real app on a copy of a home folder**

Copy the home without `accounts.json`, `mcp.json` and `squads/telegram.json`, and with a copy of `Masters HW` registered in place of the real folder. Run HW3's ticket. Expected: it runs, Put it in the folder lands it, Undo restores it, and `ls -a` on the folder shows no `.git`, `.aorch` or `.tether`.

- [ ] **Step 4: Update the docs**

README: plain folders in the run and ticket sections. HANDOFF: this branch, what to check, and that stages 2 to 6 follow the design's §8.

- [ ] **Step 5: Commit**

```bash
git add test/plain-flow.test.ts README.md docs/HANDOFF.md
git commit -m "A ticket works end to end in a plain folder; docs"
```
