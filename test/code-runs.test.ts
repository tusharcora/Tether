import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedByRuns, runsForFile } from '../src/codeRuns.js';
import type { Store } from '../src/store.js';
import { initWorkspace } from '../src/workspace.js';
import { enc, startHttpTestServer } from './http-helpers.js';
import { makeRepo, pipe, setup } from './helpers.js';

const DAY = 86_400_000;
const sh = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir }).toString().trim();
const notLive = { isLive: () => false, isPlanning: () => false };

/** Commit `files` on a run branch from `base` and come back to main; returns the commit. */
function runCommit(dir: string, branch: string, base: string, files: Record<string, string>): string {
  sh(dir, 'checkout', '-q', '-b', branch, base);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', branch);
  const sha = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', 'main');
  return sha;
}

/** A run that started at the repo's base and committed once; finished unless `live`. */
function recordRun(store: Store, o: { id: string; repo: string; base: string; commit: string; task: string; live?: boolean; probe?: boolean }) {
  store.append(o.id, { type: 'run.started', pipeline: pipe([{ id: 'code', role: 'coder' }], []), task: o.task, repo: o.repo, workdir: `/wt/${o.id}`, baseSha: o.base, branch: `aorch/${o.id}`, ...(o.probe ? { probe: { proposal: 'coder-0000000000000000', side: 'baseline' } } : {}) } as never);
  store.append(o.id, { type: 'node.started', node: 'code', attempt: 1 });
  store.append(o.id, { type: 'node.finished', node: 'code', status: 'done', output: '', durationMs: 1, attempt: 1, commit: o.commit });
  if (!o.live) store.append(o.id, { type: 'run.finished', status: 'done' });
}

function fixture(store: Store) {
  const dir = realpathSync(makeRepo());
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'one\ntwo\nthree\nfour\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'base');
  const base = sh(dir, 'rev-parse', 'HEAD');
  const c1 = runCommit(dir, 'aorch/r-1', base, { 'src/a.ts': 'one\nTWO\n2b\nthree\nfour\n' });
  const c2 = runCommit(dir, 'aorch/r-2', base, { 'src/a.ts': 'one\ntwo\nthree\nFOUR\n', 'src/b.ts': 'new\n' });
  const c3 = runCommit(dir, 'aorch/p-1', base, { 'src/a.ts': 'probe\n' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() - 40 * DAY);
  const c0 = runCommit(dir, 'aorch/r-0', base, { 'old.ts': 'old\n' });
  recordRun(store, { id: 'r-0', repo: dir, base, commit: c0, task: 'Old work' });
  vi.useRealTimers();
  recordRun(store, { id: 'r-1', repo: dir, base, commit: c1, task: 'Add rate limiting\nwith details' });
  recordRun(store, { id: 'p-1', repo: dir, base, commit: c3, task: 'probe', probe: true });
  recordRun(store, { id: 'r-2', repo: join(dir, 'src'), base, commit: c2, task: 'Tune the window', live: true });
  return { dir, base };
}

afterEach(() => vi.useRealTimers());

describe('runsForFile', () => {
  it('lists the runs whose commits touch the file, newest first, with counts, hunks and a patch; probes left out', async () => {
    const { store } = setup();
    const { dir } = fixture(store);
    const runs = await runsForFile(store, notLive, dir, 'src/a.ts');
    expect(runs.map((r) => r.runId)).toEqual(['r-2', 'r-1']);
    expect(runs[1]).toMatchObject({ title: 'Add rate limiting', label: 'test', status: 'done', live: false, add: 2, del: 1, hunks: [{ start: 2, lines: 2 }] });
    expect(runs[1]!.patch.split('\n')).toEqual(['@@ -1,4 +1,5 @@', ' one', '-two', '+TWO', '+2b', ' three', ' four']);
    expect(runs[0]).toMatchObject({ title: 'Tune the window', status: 'running', live: true, add: 1, del: 1, hunks: [{ start: 4, lines: 1 }] });
    expect(typeof runs[0]!.at).toBe('number');
    expect(await runsForFile(store, notLive, dir, 'src/b.ts')).toHaveLength(1);
    expect(await runsForFile(store, notLive, dir, 'README.md')).toEqual([]);
  });

  it('works for a project that is a subfolder of the repo', async () => {
    const { store } = setup();
    const { dir } = fixture(store);
    expect((await runsForFile(store, notLive, join(dir, 'src'), 'a.ts')).map((r) => r.runId)).toEqual(['r-2', 'r-1']);
  });
});

describe('changedByRuns', () => {
  it('lists the paths runs touched in the last 30 days', async () => {
    const { store } = setup();
    const { dir } = fixture(store);
    expect(await changedByRuns(store, dir)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(await changedByRuns(store, dir, 60)).toEqual(['old.ts', 'src/a.ts', 'src/b.ts']);
  });
});

describe('the runs routes', () => {
  it('answer runs-for-file and changed for a workspace, and nothing for a folder that is not a repo', async () => {
    const s = await startHttpTestServer({ register: false });
    try {
      const { dir } = fixture(s.store);
      initWorkspace(s.home, dir, { id: 'shop', write: false });
      const r = await s.api('GET', `/api/code/runs-for-file?ws=shop&path=${enc('src/a.ts')}`);
      expect(r.status).toBe(200);
      expect(r.json.map((x: { runId: string }) => x.runId)).toEqual(['r-2', 'r-1']);
      expect((await s.api('GET', '/api/code/changed?ws=shop')).json).toEqual({ paths: ['src/a.ts', 'src/b.ts'] });
      expect((await s.api('GET', `/api/code/runs-for-file?ws=shop&path=${enc('../x')}`)).status).toBe(400);
    } finally {
      await s.close();
    }
  });
});
