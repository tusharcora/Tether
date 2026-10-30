import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rewindBase } from '../src/engine.js';
import type { RunState } from '../src/types.js';
import { makeRepo, pipe, setup } from './helpers.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
/** Two writing steps, then your approval. */
const flow = () =>
  pipe(
    [
      { id: 'a', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'a\n' }, costUsd: 0.1 } },
      { id: 'b', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'b\n' }, costUsd: 0.2 } },
      { id: 'ok', kind: 'approval', title: 'You approve' },
    ],
    [
      ['a', 'b'],
      ['b', 'ok'],
    ],
  );

async function paused() {
  const s = setup();
  const repo = makeRepo();
  const id = await s.engine.start({ pipeline: flow(), task: 'two files', repo });
  const st = await s.engine.wait(id);
  expect(st.nodes.ok!.status).toBe('awaiting');
  return { ...s, repo, id, st };
}

describe('rewind', () => {
  it('records each step’s base: HEAD when it started', async () => {
    const r = await paused();
    expect(r.st.nodes.a!.base).toBe(r.st.baseSha);
    expect(r.st.nodes.b!.base).toBe(r.st.nodes.a!.commit);
  });

  it('resets the worktree to before the step, queues it and everything after, and leaves the run stopped', async () => {
    const r = await paused();
    const head = git(r.st.workdir, 'rev-parse', 'HEAD');
    writeFileSync(join(r.st.workdir, 'junk.txt'), 'left over\n');
    const s = await r.engine.rewind(r.id, 'b');
    expect(git(s.workdir, 'rev-parse', 'HEAD')).toBe(r.st.nodes.a!.commit);
    expect(existsSync(join(s.workdir, 'b.txt'))).toBe(false);
    expect(existsSync(join(s.workdir, 'junk.txt'))).toBe(false);
    expect(existsSync(join(s.workdir, 'a.txt'))).toBe(true);
    expect(s.status).toBe('stopped');
    expect(s.nodes.a!.status).toBe('done');
    expect(s.nodes.b).toMatchObject({ status: 'queued', attempts: 1, costUsd: 0.2 });
    expect(s.nodes.b!.commit).toBeUndefined();
    expect(s.nodes.ok!.status).toBe('queued');
    expect(s.costUsd).toBeCloseTo(0.3);
    expect(s.rewind).toMatchObject({ node: 'b', ref: `refs/tether/rewind/${r.id}/1` });
    // the old HEAD, with the uncommitted file committed on top, is kept at the ref
    const kept = git(r.repo, 'rev-parse', `refs/tether/rewind/${r.id}/1`);
    expect(git(r.repo, 'rev-parse', `${kept}~1`)).toBe(head);
    expect(git(r.repo, 'show', `${kept}:junk.txt`)).toBe('left over');
  });

  it('Resume carries on from the rewound step', async () => {
    const r = await paused();
    await r.engine.rewind(r.id, 'b');
    await r.engine.resume(r.id);
    const s = await r.engine.wait(r.id);
    expect(s.nodes.b).toMatchObject({ status: 'done', attempts: 2 });
    expect(s.nodes.ok!.status).toBe('awaiting');
    expect(existsSync(join(s.workdir, 'b.txt'))).toBe(true);
    expect(s.rewind).toBeUndefined();
    await expect(r.engine.undoRewind(r.id)).rejects.toThrow(/nothing to undo/);
  });

  it('undo puts the worktree and the steps back while nothing has run since', async () => {
    const r = await paused();
    const head = git(r.st.workdir, 'rev-parse', 'HEAD');
    await r.engine.rewind(r.id, 'b');
    const s = await r.engine.undoRewind(r.id);
    expect(git(s.workdir, 'rev-parse', 'HEAD')).toBe(head);
    expect(existsSync(join(s.workdir, 'b.txt'))).toBe(true);
    expect(s.status).toBe('paused');
    expect(s.nodes.b).toMatchObject({ status: 'done', commit: r.st.nodes.b!.commit });
    expect(s.nodes.ok!.status).toBe('awaiting');
    expect(git(r.repo, 'for-each-ref', `refs/tether/rewind/${r.id}/`)).toBe('');
  });

  it('undo is refused once the worktree moved on', async () => {
    const r = await paused();
    await r.engine.rewind(r.id, 'b');
    writeFileSync(join(r.st.workdir, 'x.txt'), 'x');
    git(r.st.workdir, 'add', '-A');
    git(r.st.workdir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'by hand');
    await expect(r.engine.undoRewind(r.id)).rejects.toThrow(/moved on/);
  });

  it('is refused while the run is live and for a step that never finished', async () => {
    const s = setup();
    const repo = makeRepo();
    const p = pipe(
      [
        { id: 'a', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'a\n' } } },
        { id: 'b', role: 'coder', mock: { delayMs: 5000 } },
      ],
      [['a', 'b']],
    );
    const id = await s.engine.start({ pipeline: p, task: 't', repo });
    for (let i = 0; i < 200 && s.store.state(id)!.nodes.b!.status !== 'running'; i++) await new Promise((x) => setTimeout(x, 10));
    await expect(s.engine.rewind(id, 'a')).rejects.toThrow(/stop it first/);
    s.engine.stop(id);
    await s.engine.wait(id);
    await expect(s.engine.rewind(id, 'b')).rejects.toThrow(/has not finished/);
    await expect(s.engine.rewind(id, 'nope')).rejects.toThrow(/no step/);
    // a step cut short by Stop left nothing committed; a rewind to a still works
    const st = await s.engine.rewind(id, 'a');
    expect(st.nodes.a!.status).toBe('queued');
  });

  it('a run from before bases goes back to the previous step’s commit, else to where it started', () => {
    const s = {
      baseSha: 'start',
      pipeline: pipe([{ id: 'a' }, { id: 'g', kind: 'gate', command: 'true' }, { id: 'b' }], [['a', 'g'], ['g', 'b']]),
      nodes: { a: { status: 'done', commit: 'c1' }, g: { status: 'done' }, b: { status: 'done', commit: 'c2' } },
    } as unknown as RunState;
    expect(rewindBase(s, 'b')).toBe('c1');
    expect(rewindBase(s, 'g')).toBe('c1');
    expect(rewindBase(s, 'a')).toBe('start');
    expect(rewindBase({ ...s, nodes: { ...s.nodes, b: { ...s.nodes.b!, base: 'bb' } } }, 'b')).toBe('bb');
  });
});

describe('fork', () => {
  it('starts a new run from after the step, with it and the steps before it done from the parent', async () => {
    const r = await paused();
    const before = r.mock.calls.length;
    const child = await r.engine.fork(r.id, 'a');
    const c = await r.engine.wait(child);
    expect(c.origin).toEqual({ kind: 'fork', id: r.id, node: 'a' });
    expect(c.baseSha).toBe(r.st.nodes.a!.commit);
    expect(c.task).toBe('two files');
    expect(c.nodes.a).toMatchObject({ status: 'done', attempts: 0, commit: r.st.nodes.a!.commit, output: `From run ${r.id}.` });
    expect(c.nodes.b).toMatchObject({ status: 'done', attempts: 1 });
    expect(c.nodes.ok!.status).toBe('awaiting');
    expect(r.mock.calls.slice(before).map((x) => x.nodeId)).toEqual(['b']);
    expect(git(c.workdir, 'log', '--format=%s', '-1')).toMatch(/aorch: b \(coder\) attempt 1/);
    // the parent is untouched
    expect(r.store.state(r.id)!.nodes.b!.status).toBe('done');
  });

  it('is refused for a step that is not done, an unknown step and an unknown run', async () => {
    const r = await paused();
    await expect(r.engine.fork(r.id, 'ok')).rejects.toThrow(/has not finished/);
    await expect(r.engine.fork(r.id, 'zz')).rejects.toThrow(/no step/);
    await expect(r.engine.fork('rnope', 'a')).rejects.toThrow(/unknown run/);
  });
});
