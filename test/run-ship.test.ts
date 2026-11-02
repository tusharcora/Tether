import { execFileSync } from 'node:child_process';
import { readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/exec.js';
import { shippable, snapshotDirty } from '../src/history.js';
import { RunShip } from '../src/runShip.js';
import { startServer } from '../src/server.js';
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
    expect(ship.error).toBe('b.txt changed since this work started, so nothing was put in the folder. Keep your version, or send this back.');
    expect(ship.landed).toBeUndefined();
    expect(read(r.folder, 'b.txt')).toBe('mine\n');
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
    expect(r.store.state(fork)!.ship?.error).toBeUndefined();
    expect(r.store.state(fork)!.ship?.landed).toBeTruthy();
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
