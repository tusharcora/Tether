import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/exec.js';
import { commitAll } from '../src/git.js';
import { realOr, shippable, snapshotDirty } from '../src/history.js';
import { landRun, RunShip } from '../src/runShip.js';
import { startServer } from '../src/server.js';
import { shipBranch } from '../src/teams/ship.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, plainFolder, setup, tmp } from './helpers.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const flow = () =>
  pipe(
    [
      { id: 'code', role: 'coder', mock: { writeFile: { path: 'fix.txt', content: 'fixed\n' } } },
      { id: 'ok', kind: 'approval', title: 'You approve' },
    ],
    [['code', 'ok']],
  );
const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 25));
  expect(f()).toBe(true);
};

/** A run paused at its approval, in a repo with a bare `origin`; `gh` faked (checks: `checks`). */
async function rig(checks: string[] = []) {
  const s = setup();
  const repo = makeRepo();
  const bare = tmp('bare-');
  git(bare, 'init', '-q', '--bare');
  git(repo, 'remote', 'add', 'origin', bare);
  const calls: string[][] = [];
  const exec: Exec = async (_cmd, args) => {
    calls.push(args);
    if (args[1] === 'create') return { code: 0, stdout: 'https://github.com/o/r/pull/9\n', stderr: '' };
    if (args[1] === 'view') return { code: 0, stdout: JSON.stringify({ state: 'OPEN', statusCheckRollup: (checks.shift() ?? 'SUCCESS') === 'PENDING' ? [{ status: 'IN_PROGRESS' }] : [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false, pollMs: 10 });
  const id = await s.engine.start({ pipeline: flow(), task: 'Write fix.txt\n\nmore', repo });
  await s.engine.wait(id);
  return { ...s, repo, bare, calls, ship, id };
}

describe('the decision banner', () => {
  it('Merge to main approves, ships the branch once the run is done, and merges when the checks pass', async () => {
    const r = await rig(['PENDING', 'SUCCESS']);
    expect(r.store.state(r.id)!.nodes.ok!.status).toBe('awaiting');
    await r.ship.decide(r.id, true);
    await until(() => !!r.store.state(r.id)!.ship?.merged);
    expect(r.store.state(r.id)!.ship).toMatchObject({ url: 'https://github.com/o/r/pull/9', number: 9, merged: true });
    expect(r.calls.find((c) => c[1] === 'create')).toEqual(['pr', 'create', '--head', r.store.state(r.id)!.branch, '--title', 'Write fix.txt', '--body', expect.stringContaining(r.id)]);
    expect(r.calls.filter((c) => c[1] === 'view')).toHaveLength(2);
    expect(r.calls.find((c) => c[1] === 'merge')).toEqual(['pr', 'merge', 'https://github.com/o/r/pull/9', '--merge']);
    expect(git(r.bare, 'branch', '--list')).toContain(r.store.state(r.id)!.branch);
  });

  it('Open PR instead opens the PR and merges nothing; a second decision is refused', async () => {
    const r = await rig();
    await r.ship.decide(r.id, false);
    await until(() => !!r.store.state(r.id)!.ship?.url);
    await r.ship.idle();
    expect(r.calls.some((c) => c[1] === 'merge')).toBe(false);
    await expect(r.ship.decide(r.id, true)).rejects.toThrow(/already shipped as PR #9/);
  });

  it('a run that waits on nobody and is not done has nothing to decide; a team run is only approved', async () => {
    const r = await rig();
    const team = new RunShip({ store: r.store, engine: r.engine, exec: async () => ({ code: 1, stdout: '', stderr: 'no' }), home: r.home, teamOwns: () => true });
    await team.decide(r.id, true);
    await r.engine.wait(r.id);
    await team.idle();
    expect(r.store.state(r.id)!.status).toBe('done');
    expect(r.store.state(r.id)!.ship).toBeUndefined();
    const other = await r.engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { failFirst: 9 } }], []), task: 'x', repo: r.repo });
    await r.engine.wait(other);
    await expect(r.ship.decide(other, true)).rejects.toThrow(/nothing in this run waits on you/);
  });

  it('Send back reruns the step with the note as its guidance, and every step after it asks again', async () => {
    const r = await rig();
    await r.engine.sendBack(r.id, 'code', 'Also reject protocol-relative //evil.com');
    const s = await r.engine.wait(r.id);
    expect(s.nodes.code!.attempts).toBe(2);
    expect(s.nodes.ok!.status).toBe('awaiting');
    expect(r.mock.calls.filter((c) => c.nodeId === 'code').at(-1)!.prompt).toContain('Sent back by the person: Also reject protocol-relative //evil.com');
    r.engine.approve(r.id, 'ok', true);
    await r.engine.resume(r.id);
    await r.engine.wait(r.id);
    await expect(r.engine.sendBack(r.id, 'code', 'more')).rejects.toThrow(/finished/);
  });
});

describe('POST /api/runs/:id/ship and /sendback', () => {
  it('validate their input', async () => {
    const r = await rig();
    const vault = new Vault(tmp('vault-'));
    const srv = await startServer({ engine: r.engine, store: r.store, vault, registry: r.registry, cfg: { home: r.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    const u = new URL(srv.url);
    const call = (path: string, body: unknown) =>
      new Promise<number>((resolve, reject) => {
        const q = request({ host: u.hostname, port: u.port, method: 'POST', path, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode ?? 0))));
        q.on('error', reject);
        q.end(JSON.stringify(body));
      });
    try {
      expect(await call(`/api/runs/${r.id}/ship`, { merge: 'yes' })).toBe(400);
      expect(await call('/api/runs/rnope/ship', { merge: true })).toBe(404);
      expect(await call(`/api/runs/${r.id}/sendback`, { node: 'ok', note: 'x' })).toBe(400);
      expect(await call(`/api/runs/${r.id}/sendback`, { node: 'code', note: '  ' })).toBe(400);
      expect(await call(`/api/runs/${r.id}/sendback`, { node: 'code', note: 'x'.repeat(1001) })).toBe(400);
      expect(await call(`/api/runs/${r.id}/sendback`, { node: 'code', note: 'tighten it' })).toBe(200);
    } finally {
      await srv.close();
    }
  });
});

describe('shipping work that started from uncommitted files', () => {
  async function dirtyRig(write: { path: string; content: string }) {
    const s = setup();
    const repo = makeRepo();
    const bare = tmp('bare-');
    git(bare, 'init', '-q', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    writeFileSync(join(repo, 'wip.txt'), 'scratch\n');
    const exec: Exec = async (_c, args) => (args[1] === 'create' ? { code: 0, stdout: 'https://github.com/o/r/pull/9\n', stderr: '' } : { code: 0, stdout: '', stderr: '' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: write } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['code', 'ok']]);
    const id = await s.engine.start({ pipeline: p, task: 'Write it', repo });
    await s.engine.wait(id);
    await ship.decide(id, false);
    await ship.idle();
    return { ...s, repo, bare, id };
  }

  it('pushes the run without the uncommitted files, and leaves the run branch alone', async () => {
    const r = await dirtyRig({ path: 'b.txt', content: 'b\n' });
    const st = r.store.state(r.id)!;
    const before = git(r.repo, 'rev-parse', st.branch);
    expect(st.ship?.url).toBeTruthy();
    expect(git(r.bare, 'branch', '--list')).toContain(`${st.branch}-pr`);
    const files = git(r.bare, 'ls-tree', '-r', '--name-only', `${st.branch}-pr`);
    expect(files).toContain('b.txt');
    expect(files).not.toContain('wip.txt');
    expect(git(r.repo, 'rev-parse', st.branch)).toBe(before);
    expect(git(r.repo, 'show', `${st.branch}:wip.txt`)).toBe('scratch');
  });

  it('refuses when the run edits an uncommitted file, and pushes nothing', async () => {
    const r = await dirtyRig({ path: 'wip.txt', content: 'changed\n' });
    const st = r.store.state(r.id)!;
    expect(st.ship?.error).toContain("depends on changes you haven't committed");
    expect(git(r.bare, 'branch', '--list')).toBe('');
    expect(git(r.repo, 'branch', '--list', '*-pr')).toBe('');
  });

  /** A run with two steps, paused at its approval, on a repo with `wip.txt` uncommitted and a bare `origin`. */
  async function twoSteps() {
    const s = setup();
    const repo = makeRepo();
    const bare = tmp('bare-');
    git(bare, 'init', '-q', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    writeFileSync(join(repo, 'wip.txt'), 'token\n');
    const exec: Exec = async (_c, args) => (args[1] === 'create' ? { code: 0, stdout: 'https://github.com/o/r/pull/9\n', stderr: '' } : { code: 0, stdout: '', stderr: '' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const p = pipe(
      [
        { id: 'a', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'a\n' } } },
        { id: 'b', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'b\n' } } },
        { id: 'ok', kind: 'approval', title: 'You approve' },
      ],
      [['a', 'b'], ['b', 'ok']],
    );
    const id = await s.engine.start({ pipeline: p, task: 'Write it', repo });
    await s.engine.wait(id);
    return { ...s, repo, bare, ship, id };
  }
  /** Fails if any commit the remote holds has the file, or the uncommitted-work commit is among them. */
  function neverPushed(bare: string, file: string) {
    const commits = git(bare, 'rev-list', '--all').split('\n').filter(Boolean);
    expect(commits.length).toBeGreaterThan(0);
    for (const c of commits) expect(git(bare, 'ls-tree', '-r', '--name-only', c)).not.toContain(file);
    expect(git(bare, 'log', '--all', '--format=%s')).not.toContain('tether: uncommitted work');
  }

  it('a fork of such a run pushes its parent\'s commits and none of the uncommitted files', async () => {
    const r = await twoSteps();
    const fork = await r.engine.fork(r.id, 'a');
    await r.engine.wait(fork);
    await r.ship.decide(fork, false);
    await r.ship.idle();
    const st = r.store.state(fork)!;
    expect(st.ship?.url).toBeTruthy();
    expect(git(r.bare, 'branch', '--list')).toContain(`${st.branch}-pr`);
    const files = git(r.bare, 'ls-tree', '-r', '--name-only', `${st.branch}-pr`);
    expect(files).toContain('a.txt');
    expect(files).toContain('b.txt');
    neverPushed(r.bare, 'wip.txt');
    expect(git(r.repo, 'show', `${st.branch}:wip.txt`)).toBe('token');
  });

  it('a run started from an earlier run\'s branch pushes none of the uncommitted files', async () => {
    const r = await twoSteps();
    const p = pipe([{ id: 'more', role: 'coder', mock: { writeFile: { path: 'c.txt', content: 'c\n' } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['more', 'ok']]);
    const next = await r.engine.start({ pipeline: p, task: 'More', repo: r.repo, ref: r.store.state(r.id)!.branch });
    await r.engine.wait(next);
    await r.ship.decide(next, false);
    await r.ship.idle();
    expect(r.store.state(next)!.ship?.url).toBeTruthy();
    neverPushed(r.bare, 'wip.txt');
  });

  const CHANGED = "This run's history was changed, so it can't be shipped safely. Nothing was pushed.";
  const remoteEmpty = (bare: string) => expect(git(bare, 'for-each-ref')).toBe('');

  /** Paused before its first step, on `wip.txt` uncommitted: the worktree's HEAD is the snapshot itself. */
  async function pausedOnSnapshot() {
    const s = setup();
    const repo = makeRepo();
    const bare = tmp('bare-');
    git(bare, 'init', '-q', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    writeFileSync(join(repo, 'wip.txt'), 'token\n');
    const exec: Exec = async (_c, args) => (args[1] === 'create' ? { code: 0, stdout: 'https://github.com/o/r/pull/9\n', stderr: '' } : { code: 0, stdout: '', stderr: '' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const p = pipe([{ id: 'first', kind: 'approval', title: 'Go on' }, { id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'b\n' } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['first', 'code'], ['code', 'ok']]);
    const id = await s.engine.start({ pipeline: p, task: 'Write it', repo });
    await s.engine.wait(id);
    const go = async () => {
      s.engine.approve(id, 'first', true);
      await s.engine.resume(id);
      await s.engine.wait(id);
    };
    return { ...s, repo, bare, ship, id, go };
  }

  it('records the snapshot on a run that began from uncommitted work, and on what comes from it; not on a clean run', async () => {
    const r = await twoSteps();
    const st = r.store.state(r.id)!;
    expect(st.dirty).toBe(st.baseSha);
    const fork = await r.engine.fork(r.id, 'a');
    await r.engine.wait(fork);
    expect(r.store.state(fork)!.dirty).toBe(st.baseSha);
    const p = pipe([{ id: 'more', role: 'coder', mock: { writeFile: { path: 'c.txt', content: 'c\n' } } }], []);
    const next = await r.engine.start({ pipeline: p, task: 'More', repo: r.repo, ref: st.branch });
    await r.engine.wait(next);
    expect(r.store.state(next)!.dirty).toBe(st.baseSha);
    const clean = await rig();
    expect(clean.store.state(clean.id)!.dirty).toBeUndefined();
  });

  it('an amended snapshot pushes nothing, and neither does a fork of that run', async () => {
    const r = await pausedOnSnapshot();
    git(r.store.state(r.id)!.workdir, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '--amend', '-m', 'tidy');
    await r.go();
    await r.ship.decide(r.id, false);
    await r.ship.idle();
    expect(r.store.state(r.id)!.ship?.error).toBe(CHANGED);
    expect(r.store.state(r.id)!.ship?.url).toBeUndefined();
    remoteEmpty(r.bare);
    const fork = await r.engine.fork(r.id, 'code');
    await r.engine.wait(fork);
    await r.ship.decide(fork, false);
    await r.ship.idle();
    expect(r.store.state(fork)!.ship?.error).toBe(CHANGED);
    remoteEmpty(r.bare);
  });

  it('reset --soft then commit pushes nothing, and a run started from that branch pushes nothing', async () => {
    const r = await twoSteps();
    const st = r.store.state(r.id)!;
    git(st.workdir, 'reset', '-q', '--soft', `${st.baseSha}^`);
    git(st.workdir, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '-m', 'all of it');
    await r.ship.decide(r.id, false);
    await r.ship.idle();
    expect(r.store.state(r.id)!.ship?.error).toBe(CHANGED);
    remoteEmpty(r.bare);
    const p = pipe([{ id: 'more', role: 'coder', mock: { writeFile: { path: 'c.txt', content: 'c\n' } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['more', 'ok']]);
    const next = await r.engine.start({ pipeline: p, task: 'More', repo: r.repo, ref: st.branch });
    await r.engine.wait(next);
    await r.ship.decide(next, false);
    await r.ship.idle();
    expect(r.store.state(next)!.ship?.error).toBe(CHANGED);
    remoteEmpty(r.bare);
  });

  it('a file taken out and put back with the same bytes is not brought along by the replay', async () => {
    const r = await twoSteps();
    const dir = r.store.state(r.id)!.workdir;
    const commit = (m: string) => (git(dir, 'add', '-A'), git(dir, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '-m', m));
    rmSync(join(dir, 'wip.txt'));
    writeFileSync(join(dir, 'c.txt'), 'c\n'); // a commit left empty by the replay would stop it, which hides the leak
    commit('out');
    writeFileSync(join(dir, 'wip.txt'), 'token\n');
    commit('back');
    await r.ship.decide(r.id, false);
    await r.ship.idle();
    expect(r.store.state(r.id)!.ship?.error).toBe(CHANGED);
    remoteEmpty(r.bare);
    expect(git(r.repo, 'branch', '--list', '*-pr')).toBe('');
  });

  it('an uncommitted edit to a tracked file is not brought back by the replay either', async () => {
    const s = setup();
    const repo = makeRepo();
    const bare = tmp('bare-');
    git(bare, 'init', '-q', '--bare');
    git(repo, 'remote', 'add', 'origin', bare);
    const was = readFileSync(join(repo, 'README.md'), 'utf8');
    writeFileSync(join(repo, 'README.md'), 'token\n');
    const exec: Exec = async () => ({ code: 0, stdout: 'https://github.com/o/r/pull/9\n', stderr: '' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'b\n' } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['code', 'ok']]);
    const id = await s.engine.start({ pipeline: p, task: 'Write it', repo });
    await s.engine.wait(id);
    const dir = s.store.state(id)!.workdir;
    const commit = (m: string) => (git(dir, 'add', '-A'), git(dir, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '-q', '-m', m));
    writeFileSync(join(dir, 'README.md'), was);
    writeFileSync(join(dir, 'c.txt'), 'c\n');
    commit('old');
    writeFileSync(join(dir, 'README.md'), 'token\n');
    commit('new');
    await ship.decide(id, false);
    await ship.idle();
    expect(s.store.state(id)!.ship?.error).toBe(CHANGED);
    remoteEmpty(bare);
  });

  it('shipping again after an undo replaces the run\'s own PR branch, without the uncommitted files', async () => {
    const r = await dirtyRig({ path: 'b.txt', content: 'b\n' });
    const st = r.store.state(r.id)!;
    const pushed = git(r.bare, 'rev-parse', `${st.branch}-pr`);
    await new Promise((d) => setTimeout(d, 1100)); // a replay in the same second has the same shas
    const out = await shippable(r.repo, r.home, r.id, st.branch, st.baseSha, st.dirty);
    if ('error' in out) throw new Error(out.error);
    const exec: Exec = async () => ({ code: 0, stdout: 'https://github.com/o/r/pull/10\n', stderr: '' });
    expect(await shipBranch({ repo: r.repo, branch: out.branch, base: out.base, title: 't', body: 'b', exec })).toEqual({ url: 'https://github.com/o/r/pull/10', number: 10 });
    expect(git(r.bare, 'rev-parse', `${st.branch}-pr`)).not.toBe(pushed);
    expect(git(r.bare, 'rev-parse', `${st.branch}-pr`)).toBe(git(r.repo, 'rev-parse', `${st.branch}-pr`));
    expect(git(r.bare, 'ls-tree', '-r', '--name-only', `${st.branch}-pr`)).not.toContain('wip.txt');
  });

  it('a commit quoting the marker neither hides the uncommitted work nor counts as it', async () => {
    const repo = makeRepo();
    const quoted = 'Explain\n\ntether: uncommitted work';
    writeFileSync(join(repo, 'old.txt'), 'real\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', quoted);
    writeFileSync(join(repo, 'wip.txt'), 'token\n');
    git(repo, 'branch', 't', await snapshotDirty(repo));
    git(repo, 'clean', '-fdq');
    git(repo, 'checkout', '-q', 't');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', quoted);
    const base = git(repo, 'rev-parse', 'HEAD');
    const out = await shippable(repo, tmp('home-'), 'x', 't', base);
    expect(out).toMatchObject({ branch: 'aorch/x-pr' });
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'aorch/x-pr').split('\n').sort()).toEqual(['README.md', 'c.txt', 'old.txt']);
  });

  it('leaves out every uncommitted-work commit when a run was started from an earlier run\'s checkout', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'wip1.txt'), 'token\n');
    git(repo, 'branch', 't', await snapshotDirty(repo));
    git(repo, 'clean', '-fdq');
    git(repo, 'checkout', '-q', 't');
    writeFileSync(join(repo, 'c1.txt'), '1\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'one');
    writeFileSync(join(repo, 'wip2.txt'), 'token\n');
    git(repo, 'branch', 'u', await snapshotDirty(repo));
    git(repo, 'clean', '-fdq');
    git(repo, 'checkout', '-q', 'u');
    writeFileSync(join(repo, 'c2.txt'), '2\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'two');
    expect(await shippable(repo, tmp('home-'), 'x', 'u', git(repo, 'rev-parse', 'HEAD'))).toMatchObject({ branch: 'aorch/x-pr' });
    for (const c of git(repo, 'rev-list', 'aorch/x-pr').split('\n')) expect(git(repo, 'ls-tree', '-r', '--name-only', c)).not.toContain('wip');
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'aorch/x-pr').split('\n').sort()).toEqual(['README.md', 'c1.txt', 'c2.txt']);
  });
});

describe('shipping a run in a plain folder', () => {
  const calls: string[][] = [];
  const exec: Exec = async (_c, args) => (calls.push(args), { code: 0, stdout: '', stderr: '' });
  async function plainRun(files: Record<string, string> = { 'a.txt': 'one\n' }, content = 'two\n') {
    const s = setup();
    const folder = plainFolder(files);
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['code', 'ok']]);
    const id = await s.engine.start({ pipeline: p, task: 'Write b', repo: folder });
    await s.engine.wait(id);
    return { ...s, ship, folder, id };
  }
  const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8');

  it('lands the work in the folder instead of pushing', async () => {
    calls.length = 0;
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    expect(read(r.folder, 'b.txt')).toBe('two\n');
    expect(r.store.state(r.id)!.ship).toMatchObject({ merged: true, landed: { files: ['b.txt'] } });
    expect(calls).toEqual([]);
    await expect(r.ship.decide(r.id, false)).rejects.toThrow(/already in the folder/);
  });

  it('a conflict is recorded in plain words and changes nothing', async () => {
    const r = await plainRun();
    writeFileSync(join(r.folder, 'b.txt'), 'mine\n');
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    // the run is done by now, so it can't be sent back
    expect(ship.error).toBe('b.txt changed since this work started, so nothing in the folder was changed. Keep your version, or rewind this run from its page and run it again.');
    expect(ship.landed).toBeUndefined();
    expect(read(r.folder, 'b.txt')).toBe('mine\n');
  });

  it('a squad, which can send it back, keeps its words', async () => {
    const r = await plainRun();
    r.engine.approve(r.id, 'ok', true, 'dashboard');
    if (!r.engine.isLive(r.id)) await r.engine.resume(r.id);
    await r.engine.wait(r.id);
    writeFileSync(join(r.folder, 'b.txt'), 'mine\n');
    expect(await landRun(r, r.id)).toMatchObject({ error: 'b.txt changed since this work started, so nothing was put in the folder. Keep your version, or send this back.' });
  });

  it("a ticket's done run is refused by hand, and lands from its ticket", async () => {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const id = await s.engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'two\n' } } }], []), task: 'Write b', repo: folder, origin: { kind: 'goal', id: 'g1' } });
    await s.engine.wait(id);
    await expect(ship.decide(id, true)).rejects.toMatchObject({ status: 409, message: 'Finish this from its ticket.' });
    await ship.idle();
    expect(s.store.state(id)!.ship).toBeUndefined();
    await ship.decide(id, true, true);
    await ship.idle();
    expect(read(folder, 'b.txt')).toBe('two\n');
  });

  it('undo takes it back out, keeps the run, and lets it land again', async () => {
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    await r.ship.undo(r.id);
    expect(existsSync(join(r.folder, 'b.txt'))).toBe(false);
    expect(r.store.state(r.id)!.ship).toBeUndefined();
    expect(existsSync(r.store.state(r.id)!.workdir)).toBe(true);
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    expect(read(r.folder, 'b.txt')).toBe('two\n');
  });

  it('undo after the person edited a landed file is a 409 naming it, and changes nothing', async () => {
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    writeFileSync(join(r.folder, 'b.txt'), 'mine\n');
    await expect(r.ship.undo(r.id)).rejects.toMatchObject({ status: 409, message: "These files can't be undone automatically: b.txt. Nothing was changed." });
    expect(read(r.folder, 'b.txt')).toBe('mine\n');
    expect(r.store.state(r.id)!.ship?.landed).toBeTruthy();
  });

  it('nothing to undo before it landed', async () => {
    const r = await plainRun();
    await expect(r.ship.undo(r.id)).rejects.toMatchObject({ status: 409 });
  });

  it('two runs that changed one file do not both land: the second sees the first as a conflict', async () => {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const mk = async (content: string) => {
      const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'a.txt', content } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['code', 'ok']]);
      const id = await s.engine.start({ pipeline: p, task: 't', repo: folder });
      await s.engine.wait(id);
      return id;
    };
    const [a, b] = [await mk('A\n'), await mk('B\n')];
    await Promise.all([ship.decide(a, true), ship.decide(b, true)]);
    await ship.idle();
    const landed = [a, b].filter((id) => s.store.state(id)!.ship?.landed);
    expect(landed).toHaveLength(1);
    const other = [a, b].find((id) => !landed.includes(id))!;
    expect(s.store.state(other)!.ship?.error).toContain('a.txt changed since');
    expect(read(folder, 'a.txt')).toBe(landed[0] === a ? 'A\n' : 'B\n');
  });

  it('two spellings of one folder take the same turn: the second sees the first as a conflict', async () => {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const other = join(tmp('links-'), 'same');
    symlinkSync(folder, other);
    const mk = async (content: string, repo: string) => {
      const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'a.txt', content } } }], []);
      const id = await s.engine.start({ pipeline: p, task: 't', repo });
      await s.engine.wait(id);
      return id;
    };
    const [a, b] = [await mk('A\n', folder), await mk('B\n', other)];
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    await Promise.all([ship.decide(a, true), ship.decide(b, true)]);
    await ship.idle();
    expect([a, b].filter((id) => s.store.state(id)!.ship?.landed)).toHaveLength(1);
    expect([a, b].map((id) => s.store.state(id)!.ship?.error).find(Boolean)).toContain('a.txt changed since');
  });

  it('a spelling that differs only in case takes the same turn', async () => {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const other = join(dirname(folder), basename(folder).toUpperCase());
    if (!existsSync(other)) return; // a case-sensitive disk has no such spelling
    expect(realOr(other)).toBe(realOr(folder));
    const mk = async (content: string, repo: string) => {
      const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'a.txt', content } } }], []);
      const id = await s.engine.start({ pipeline: p, task: 't', repo });
      await s.engine.wait(id);
      return id;
    };
    const [a, b] = [await mk('A\n', folder), await mk('B\n', other)];
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    await Promise.all([ship.decide(a, true), ship.decide(b, true)]);
    await ship.idle();
    expect([a, b].filter((id) => s.store.state(id)!.ship?.landed)).toHaveLength(1);
    expect([a, b].map((id) => s.store.state(id)!.ship?.error).find(Boolean)).toContain('a.txt changed since');
  });

  it('a landing with nothing to change records none, and says so', async () => {
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    await r.ship.undo(r.id);
    writeFileSync(join(r.folder, 'b.txt'), 'two\n');
    const before = r.store.state(r.id)!.ship;
    expect(before).toBeUndefined();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    expect(ship.landed).toBeUndefined();
    expect(ship.merged).toBeUndefined();
    expect(ship.error).toBe('Nothing to put in the folder: it already has this work.');
    await expect(r.ship.undo(r.id)).rejects.toMatchObject({ status: 409 });
  });

  it('a run remembers it was undone, until it lands again', async () => {
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    await r.ship.undo(r.id);
    expect(r.store.state(r.id)).toMatchObject({ undone: true });
    expect(r.store.state(r.id)!.ship).toBeUndefined();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    expect(r.store.state(r.id)!.ship?.landed).toBeTruthy();
    expect(r.store.state(r.id)!.undone).toBeUndefined();
  });

  it('undo takes out what is landed when its turn comes, not what was landed when it was asked', async () => {
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    const asked = r.store.state(r.id)!.ship!.landed!;
    const undo = r.ship.undo(r.id);
    r.store.append(r.id, { type: 'run.shipped', undone: true });
    r.store.append(r.id, { type: 'run.shipped', merged: true, landed: { ...asked, files: [] } });
    await undo;
    expect(read(r.folder, 'b.txt')).toBe('two\n');
  });

  /** A run in a plain folder: three steps, each changing the folder, paused at its approval. */
  async function chain() {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
    const p = pipe(
      [
        { id: 'a', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'A\n' } } },
        { id: 'c', role: 'coder', mock: { writeFile: { path: 'c.txt', content: 'c\n' } } },
        { id: 'b', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'B\n' } } },
        { id: 'ok', kind: 'approval', title: 'You approve' },
      ],
      [['a', 'c'], ['c', 'b'], ['b', 'ok']],
    );
    const id = await s.engine.start({ pipeline: p, task: 't', repo: folder });
    await s.engine.wait(id);
    return { ...s, ship, folder, id };
  }

  it('a fork of a run that never landed lands the parent\'s work with its own, with no false conflict', async () => {
    const r = await chain();
    const fork = await r.engine.fork(r.id, 'c');
    await r.engine.wait(fork);
    await r.ship.decide(fork, true);
    await r.ship.idle();
    const ship = r.store.state(fork)!.ship!;
    expect(ship.error).toBeUndefined();
    expect(ship.landed!.files.sort()).toEqual(['a.txt', 'c.txt']);
    expect(read(r.folder, 'a.txt')).toBe('B\n');
    expect(read(r.folder, 'c.txt')).toBe('c\n');
    await r.ship.undo(fork);
    expect(read(r.folder, 'a.txt')).toBe('one\n');
    expect(existsSync(join(r.folder, 'c.txt'))).toBe(false);
  });

  it('a fork of a landed run is not stopped by the parent\'s own files', async () => {
    const r = await chain();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    const fork = await r.engine.fork(r.id, 'c');
    await r.engine.wait(fork);
    await r.ship.decide(fork, true);
    await r.ship.idle();
    expect(r.store.state(fork)!.ship?.error).toBe('Nothing to put in the folder: it already has this work.');
    expect(read(r.folder, 'a.txt')).toBe('B\n');
  });

  it('a person\'s edit to a file the parent changed still stops a fork', async () => {
    const r = await chain();
    const fork = await r.engine.fork(r.id, 'c');
    await r.engine.wait(fork);
    writeFileSync(join(r.folder, 'a.txt'), 'mine\n');
    await r.ship.decide(fork, true);
    await r.ship.idle();
    expect(r.store.state(fork)!.ship?.error).toContain('a.txt changed since');
    expect(read(r.folder, 'a.txt')).toBe('mine\n');
    expect(existsSync(join(r.folder, 'c.txt'))).toBe(false);
  });

  describe('a fork of a landed run', () => {
    /** Two steps paused at the approval: `x.txt` then `y.txt`, on a folder holding the old `x.txt` and `n.txt`. */
    async function parent() {
      const s = setup();
      const folder = plainFolder({ 'x.txt': 'one\n', 'n.txt': 'old\n' });
      const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => false });
      const p = pipe(
        [
          { id: 'a', role: 'coder', mock: { writeFile: { path: 'x.txt', content: 'A\n' } } },
          { id: 'b', role: 'coder', mock: { writeFile: { path: 'y.txt', content: 'B\n' } } },
          { id: 'ok', kind: 'approval', title: 'You approve' },
        ],
        [['a', 'b'], ['b', 'ok']],
      );
      const id = await s.engine.start({ pipeline: p, task: 't', repo: folder });
      await s.engine.wait(id);
      const land = async (run: string) => {
        await ship.decide(run, true);
        await ship.idle();
        return s.store.state(run)!.ship!;
      };
      /** A fork from `node` whose own work is `files` (null deletes one), committed by hand since the pipeline's steps are the parent's. */
      const fork = async (from: string, node: string, files: Record<string, string | null>) => {
        const f = await s.engine.fork(from, node);
        await s.engine.wait(f);
        const dir = s.store.state(f)!.workdir;
        for (const [name, text] of Object.entries(files)) text === null ? rmSync(join(dir, name)) : writeFileSync(join(dir, name), text);
        const commit = await commitAll(dir, 'fork');
        // so a fork of this fork starts after that commit, as it would after a step that made it
        if (commit) s.store.append(f, { type: 'node.finished', node, status: 'done', output: 'done', durationMs: 0, attempt: 0, commit });
        return f;
      };
      return { ...s, folder, ship, id, land, fork };
    }
    const here = (dir: string, f: string) => existsSync(join(dir, f));

    it('leaves a file the person put back as it was (scenario 1)', async () => {
      const r = await parent();
      await r.land(r.id);
      writeFileSync(join(r.folder, 'x.txt'), 'one\n');
      const ship = await r.land(await r.fork(r.id, 'b', { 'z.txt': 'z\n' }));
      expect(ship.error).toBeUndefined();
      expect(ship.landed!.files).toEqual(['z.txt']);
      expect(read(r.folder, 'x.txt')).toBe('one\n');
      expect(read(r.folder, 'z.txt')).toBe('z\n');
    });

    it('leaves a file the person deleted deleted (scenario 2)', async () => {
      const r = await parent();
      await r.land(r.id);
      rmSync(join(r.folder, 'y.txt'));
      const ship = await r.land(await r.fork(r.id, 'b', { 'z.txt': 'z\n' }));
      expect(ship.landed!.files).toEqual(['z.txt']);
      expect(here(r.folder, 'y.txt')).toBe(false);
    });

    it('changes a file the parent gave with no false conflict, and Undo restores what the parent gave (scenario 3)', async () => {
      const r = await parent();
      await r.land(r.id);
      const f = await r.fork(r.id, 'b', { 'x.txt': 'F\n' });
      const ship = await r.land(f);
      expect(ship.error).toBeUndefined();
      expect(ship.landed!.files).toEqual(['x.txt']);
      expect(read(r.folder, 'x.txt')).toBe('F\n');
      await r.ship.undo(f);
      expect(read(r.folder, 'x.txt')).toBe('A\n');
      expect(read(r.folder, 'y.txt')).toBe('B\n');
    });

    it('stops on a file the parent gave that the person changed too, naming it (scenario 4)', async () => {
      const r = await parent();
      await r.land(r.id);
      writeFileSync(join(r.folder, 'x.txt'), 'mine\n');
      const ship = await r.land(await r.fork(r.id, 'b', { 'x.txt': 'F\n', 'z.txt': 'z\n' }));
      expect(ship.error).toContain('x.txt changed since');
      expect(ship.landed).toBeUndefined();
      expect(read(r.folder, 'x.txt')).toBe('mine\n');
      expect(here(r.folder, 'z.txt')).toBe(false);
    });

    it('leaves a person\'s edit from before the parent landed', async () => {
      const r = await parent();
      writeFileSync(join(r.folder, 'n.txt'), 'mine\n');
      await r.land(r.id);
      const ship = await r.land(await r.fork(r.id, 'b', { 'z.txt': 'z\n' }));
      expect(ship.landed!.files).toEqual(['z.txt']);
      expect(read(r.folder, 'n.txt')).toBe('mine\n');
    });

    it('leaves a file the person made before the parent landed', async () => {
      const r = await parent();
      writeFileSync(join(r.folder, 'mine.txt'), 'mine\n');
      await r.land(r.id);
      const ship = await r.land(await r.fork(r.id, 'b', { 'z.txt': 'z\n' }));
      expect(ship.landed!.files).toEqual(['z.txt']);
      expect(read(r.folder, 'mine.txt')).toBe('mine\n');
    });

    it('leaves another run\'s landed file', async () => {
      const r = await parent();
      const q = await r.engine.start({ pipeline: pipe([{ id: 'q', role: 'coder', mock: { writeFile: { path: 'q.txt', content: 'q\n' } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['q', 'ok']]), task: 'q', repo: r.folder });
      await r.engine.wait(q);
      await r.land(q);
      await r.land(r.id);
      const ship = await r.land(await r.fork(r.id, 'b', { 'z.txt': 'z\n' }));
      expect(ship.landed!.files).toEqual(['z.txt']);
      expect(read(r.folder, 'q.txt')).toBe('q\n');
    });

    it('stops on a file only the fork changed, if the person edited it before the parent landed', async () => {
      const r = await parent();
      writeFileSync(join(r.folder, 'n.txt'), 'mine\n');
      await r.land(r.id);
      const ship = await r.land(await r.fork(r.id, 'b', { 'n.txt': 'F\n' }));
      expect(ship.error).toContain('n.txt changed since');
      expect(read(r.folder, 'n.txt')).toBe('mine\n');
    });

    it('from an earlier step leaves the parent\'s later changes in the folder', async () => {
      const r = await parent();
      await r.land(r.id);
      // the fork runs step b again: this time it leaves no y.txt
      const ship = await r.land(await r.fork(r.id, 'a', { 'y.txt': null, 'z.txt': 'z\n' }));
      expect(ship.error).toBeUndefined();
      expect(ship.landed!.files).toEqual(['z.txt']);
      expect(read(r.folder, 'y.txt')).toBe('B\n');
    });

    it('from an earlier step stops on a file the parent changed later, and changes nothing', async () => {
      const r = await parent();
      await r.land(r.id);
      const ship = await r.land(await r.fork(r.id, 'a', { 'y.txt': 'F\n', 'z.txt': 'z\n' }));
      expect(ship.error).toContain('y.txt changed since');
      expect(read(r.folder, 'y.txt')).toBe('B\n');
      expect(here(r.folder, 'z.txt')).toBe(false);
    });

    describe('a fork of an unlanded fork, from a step they share', () => {
      /** A lands; B forks A at its last step; C forks B at the first, so B's fork point isn't below C. */
      async function below(work: Record<string, string | null>, prepare?: (r: Awaited<ReturnType<typeof parent>>, b: string) => Promise<void>, before?: (folder: string) => void) {
        const r = await parent();
        before?.(r.folder);
        await r.land(r.id);
        const b = await r.fork(r.id, 'b', {});
        await prepare?.(r, b);
        return { ...r, landing: await r.land(await r.fork(b, 'a', work)) };
      }

      it('dropping the parent\'s later file leaves it', async () => {
        const r = await below({ 'y.txt': null, 'w.txt': 'w\n' });
        expect(r.landing.landed!.files).toEqual(['w.txt']);
        expect(read(r.folder, 'y.txt')).toBe('B\n');
      });

      it('changing the parent\'s later file stops, naming it', async () => {
        const r = await below({ 'y.txt': 'F\n', 'w.txt': 'w\n' });
        expect(r.landing.error).toContain('y.txt changed since');
        expect(read(r.folder, 'y.txt')).toBe('B\n');
        expect(here(r.folder, 'w.txt')).toBe(false);
      });

      it('the same with the middle run landed and undone', async () => {
        const r = await parent();
        await r.land(r.id);
        const b = await r.fork(r.id, 'b', { 'h.txt': 'h\n' });
        await r.land(b);
        await r.ship.undo(b);
        const landing = await r.land(await r.fork(b, 'a', { 'y.txt': null, 'w.txt': 'w\n' }));
        expect(landing.landed!.files).toEqual(['w.txt']);
        expect(read(r.folder, 'y.txt')).toBe('B\n');
      });

      it('a file the person already had as A did stays', async () => {
        const r = await below({ 'y.txt': null, 'w.txt': 'w\n' }, undefined, (f) => writeFileSync(join(f, 'y.txt'), 'B\n'));
        expect(r.landing.landed!.files).toEqual(['w.txt']);
        expect(read(r.folder, 'y.txt')).toBe('B\n');
      });
    });

    it('a parent whose record is gone: the fork touches only its own work, and a revert stays', async () => {
      const r = await parent();
      await r.land(r.id);
      const f = await r.fork(r.id, 'b', { 'z.txt': 'z\n' });
      writeFileSync(join(r.folder, 'x.txt'), 'one\n');
      await r.engine.deleteRun(r.id);
      expect(r.store.state(r.id)).toBeUndefined();
      const landing = await r.land(f);
      expect(landing.landed!.files).toEqual(['z.txt']);
      expect(read(r.folder, 'x.txt')).toBe('one\n');
    });

    it('a run undone further up: a deletion a later run carries is not brought back or redone (U6)', async () => {
      const r = await parent();
      await r.land(r.id);
      const k = await r.fork(r.id, 'b', { 'n.txt': null });
      await r.land(k);
      const l = await r.fork(k, 'b', { 'l.txt': 'l\n' });
      await r.land(l);
      await r.ship.undo(k);
      expect(read(r.folder, 'n.txt')).toBe('old\n');
      const m = await r.fork(l, 'b', { 'm.txt': 'm\n' });
      await r.land(m);
      const ship = await r.land(await r.fork(m, 'b', { 'v.txt': 'v\n' }));
      expect(ship.landed!.files).toEqual(['v.txt']);
      expect(read(r.folder, 'n.txt')).toBe('old\n');
    });

    it('the oldest run undone: a later fork leaves what that took out (U5)', async () => {
      const r = await parent();
      await r.land(r.id);
      const b = await r.fork(r.id, 'b', { 'h.txt': 'h\n' });
      await r.land(b);
      await r.ship.undo(r.id);
      const c = await r.fork(b, 'b', { 'c.txt': 'c\n' });
      await r.land(c);
      const ship = await r.land(await r.fork(c, 'b', { 'v.txt': 'v\n' }));
      expect(ship.landed!.files).toEqual(['v.txt']);
      expect(read(r.folder, 'x.txt')).toBe('one\n');
      expect(here(r.folder, 'y.txt')).toBe(false);
    });

    it('the middle run undone after the next landed: a later fork leaves what that took out (U4b)', async () => {
      const r = await parent();
      await r.land(r.id);
      const b = await r.fork(r.id, 'b', { 'x.txt': 'B\n', 'h.txt': 'h\n' });
      await r.land(b);
      const c = await r.fork(b, 'b', { 'c.txt': 'c\n' });
      await r.land(c);
      await r.ship.undo(b);
      const ship = await r.land(await r.fork(c, 'b', { 'v.txt': 'v\n' }));
      expect(ship.landed!.files).toEqual(['v.txt']);
      expect(read(r.folder, 'x.txt')).toBe('A\n');
      expect(here(r.folder, 'h.txt')).toBe(false);
    });

    it('the middle run undone before the next: that fork brings its parent\'s work back, and a fork of it adds only its own (U4b)', async () => {
      const r = await parent();
      await r.land(r.id);
      const b = await r.fork(r.id, 'b', { 'h.txt': 'h\n' });
      await r.land(b);
      await r.ship.undo(b);
      const c = await r.fork(b, 'b', { 'c.txt': 'c\n' });
      expect((await r.land(c)).landed!.files.sort()).toEqual(['c.txt', 'h.txt']);
      const ship = await r.land(await r.fork(c, 'b', { 'v.txt': 'v\n' }));
      expect(ship.landed!.files).toEqual(['v.txt']);
      expect(read(r.folder, 'x.txt')).toBe('A\n');
    });

    it('a file the person already had as the run did, then reverted, stays reverted (C1)', async () => {
      const r = await parent();
      writeFileSync(join(r.folder, 'x.txt'), 'A\n');
      expect((await r.land(r.id)).landed!.files).toEqual(['y.txt']);
      writeFileSync(join(r.folder, 'x.txt'), 'one\n');
      const b = await r.fork(r.id, 'b', { 'h.txt': 'h\n' });
      await r.land(b);
      const ship = await r.land(await r.fork(b, 'b', { 'w.txt': 'w\n' }));
      expect(ship.landed!.files).toEqual(['w.txt']);
      expect(read(r.folder, 'x.txt')).toBe('one\n');
    });

    it('a file a run left because the person had it the same, put back later, stays put back (C2)', async () => {
      const r = await parent();
      await r.land(r.id);
      writeFileSync(join(r.folder, 'x.txt'), 'M\n');
      const b = await r.fork(r.id, 'b', { 'x.txt': 'M\n', 'h.txt': 'h\n' });
      expect((await r.land(b)).landed!.files).toEqual(['h.txt']);
      writeFileSync(join(r.folder, 'x.txt'), 'A\n');
      const ship = await r.land(await r.fork(b, 'b', { 'w.txt': 'w\n' }));
      expect(ship.landed!.files).toEqual(['w.txt']);
      expect(read(r.folder, 'x.txt')).toBe('A\n');
    });

    it('walks forks to the nearest run still landed: a person\'s revert of a grandparent\'s file stays', async () => {
      const r = await parent();
      await r.land(r.id);
      const mid = await r.fork(r.id, 'b', { 'z.txt': 'z\n' });
      await r.land(mid);
      writeFileSync(join(r.folder, 'x.txt'), 'one\n');
      const ship = await r.land(await r.fork(mid, 'b', { 'w.txt': 'w\n' }));
      expect(ship.landed!.files).toEqual(['w.txt']);
      expect(read(r.folder, 'x.txt')).toBe('one\n');
      expect(read(r.folder, 'z.txt')).toBe('z\n');
    });

    it('a fork changing a grandparent\'s file is not a false conflict', async () => {
      const r = await parent();
      await r.land(r.id);
      const mid = await r.fork(r.id, 'b', { 'z.txt': 'z\n' });
      await r.land(mid);
      const ship = await r.land(await r.fork(mid, 'b', { 'x.txt': 'F\n' }));
      expect(ship.error).toBeUndefined();
      expect(read(r.folder, 'x.txt')).toBe('F\n');
    });

    describe.each([2, 3])('%i hops down the chain, the person acting before the nearer runs land', (hops) => {
      /** A lands, the person acts, then each fork lands in turn; returns the last run, a fork of them all. */
      async function chainOf(act: (folder: string) => void, last: Record<string, string>) {
        const r = await parent();
        await r.land(r.id);
        act(r.folder);
        let run = r.id;
        for (let i = 1; i < hops; i++) {
          run = await r.fork(run, 'b', { [`h${i}.txt`]: 'h\n' });
          expect((await r.land(run)).landed).toBeTruthy();
        }
        return { ...r, ship: await r.land(await r.fork(run, 'b', last)) };
      }
      const hopFiles = () => Array.from({ length: hops - 1 }, (_, i) => `h${i + 1}.txt`);

      it('a fork changing a file the person edited stops, naming it, and changes nothing', async () => {
        const r = await chainOf((f) => writeFileSync(join(f, 'x.txt'), 'mine\n'), { 'x.txt': 'F\n', 'w.txt': 'w\n' });
        expect(r.ship.error).toContain('x.txt changed since');
        expect(r.ship.landed).toBeUndefined();
        expect(read(r.folder, 'x.txt')).toBe('mine\n');
        expect(here(r.folder, 'w.txt')).toBe(false);
      });

      it('an edit to a file the fork left alone stays, and the fork\'s additions land', async () => {
        const r = await chainOf((f) => writeFileSync(join(f, 'x.txt'), 'mine\n'), { 'w.txt': 'w\n' });
        expect(r.ship.error).toBeUndefined();
        expect(r.ship.landed!.files).toEqual(['w.txt']);
        expect(read(r.folder, 'x.txt')).toBe('mine\n');
        expect(read(r.folder, 'w.txt')).toBe('w\n');
      });

      it('a revert stays the person\'s', async () => {
        const r = await chainOf((f) => writeFileSync(join(f, 'x.txt'), 'one\n'), { 'w.txt': 'w\n' });
        expect(r.ship.landed!.files).toEqual(['w.txt']);
        expect(read(r.folder, 'x.txt')).toBe('one\n');
      });

      it('a deletion stays deleted', async () => {
        const r = await chainOf((f) => rmSync(join(f, 'y.txt')), { 'w.txt': 'w\n' });
        expect(r.ship.landed!.files).toEqual(['w.txt']);
        expect(here(r.folder, 'y.txt')).toBe(false);
        for (const h of hopFiles()) expect(here(r.folder, h)).toBe(true);
      });

      it('a fork changing a file an older run gave, untouched since, lands with no false conflict', async () => {
        const r = await chainOf(() => {}, { 'x.txt': 'F\n' });
        expect(r.ship.error).toBeUndefined();
        expect(read(r.folder, 'x.txt')).toBe('F\n');
      });
    });

    it('a file both runs gave is measured from the nearer one', async () => {
      const r = await parent();
      await r.land(r.id);
      const mid = await r.fork(r.id, 'b', { 'x.txt': 'M\n' });
      await r.land(mid);
      writeFileSync(join(r.folder, 'x.txt'), 'A\n');
      const ship = await r.land(await r.fork(mid, 'b', { 'x.txt': 'F\n' }));
      expect(ship.error).toContain('x.txt changed since');
      expect(read(r.folder, 'x.txt')).toBe('A\n');
    });

    it('an undone parent no longer counts: the fork brings its work in again', async () => {
      const r = await parent();
      await r.land(r.id);
      await r.ship.undo(r.id);
      const ship = await r.land(await r.fork(r.id, 'b', { 'z.txt': 'z\n' }));
      expect(ship.landed!.files.sort()).toEqual(['x.txt', 'y.txt', 'z.txt']);
      expect(read(r.folder, 'x.txt')).toBe('A\n');
    });
  });

  it('a landed run cannot be rewound, in plain words', async () => {
    const r = await plainRun();
    await r.ship.decide(r.id, true);
    await r.ship.idle();
    await expect(r.engine.rewind(r.id, 'code')).rejects.toThrow('This work is already in the folder. Undo that first.');
  });
});

describe('POST /api/runs/:id/undo-land', () => {
  it('is a 409 naming the files when nothing can be undone, and 200 once it can', async () => {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const vault = new Vault(tmp('vault-'));
    const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'two\n' } } }, { id: 'ok', kind: 'approval', title: 'You approve' }], [['code', 'ok']]);
    const id = await s.engine.start({ pipeline: p, task: 't', repo: folder });
    await s.engine.wait(id);
    const srv = await startServer({ engine: s.engine, store: s.store, vault, registry: s.registry, cfg: { home: s.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    const u = new URL(srv.url);
    const call = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const q = request({ host: u.hostname, port: u.port, method: 'POST', path, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        q.on('error', reject);
        q.end('{}');
      });
    try {
      expect((await call(`/api/runs/${id}/ship`)).status).toBe(400);
      expect((await call(`/api/runs/${id}/undo-land`)).status).toBe(409);
      await new Promise<void>((resolve, reject) => {
        const q = request({ host: u.hostname, port: u.port, method: 'POST', path: `/api/runs/${id}/ship`, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => (res.resume(), res.on('end', () => resolve())));
        q.on('error', reject);
        q.end('{"merge":true}');
      });
      for (let i = 0; i < 100 && !s.store.state(id)!.ship?.landed; i++) await new Promise((r) => setTimeout(r, 25));
      writeFileSync(join(folder, 'b.txt'), 'mine\n');
      const bad = await call(`/api/runs/${id}/undo-land`);
      expect(bad.status).toBe(409);
      expect(JSON.parse(bad.body).error).toContain('b.txt');
      writeFileSync(join(folder, 'b.txt'), 'two\n');
      expect((await call(`/api/runs/${id}/undo-land`)).status).toBe(200);
      expect(existsSync(join(folder, 'b.txt'))).toBe(false);
    } finally {
      await srv.close();
    }
  });
});
