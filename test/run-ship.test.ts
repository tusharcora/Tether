import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/exec.js';
import { RunShip } from '../src/runShip.js';
import { startServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

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
  const ship = new RunShip({ store: s.store, engine: s.engine, exec, teamOwns: () => false, pollMs: 10 });
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
    const team = new RunShip({ store: r.store, engine: r.engine, exec: async () => ({ code: 1, stdout: '', stderr: 'no' }), teamOwns: () => true });
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
