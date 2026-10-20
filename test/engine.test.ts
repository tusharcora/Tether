import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, pipe, setup } from './helpers.js';

const fullPipeline = () =>
  pipe(
    [
      { id: 'plan', role: 'planner', readOnly: true, mock: { output: 'PLAN: add done.txt' } },
      { id: 'code', role: 'coder', mock: { writeFile: { path: 'done.txt', content: 'ok\n' }, writeFileFromAttempt: 2 } },
      { id: 'tests', kind: 'gate', command: 'test -f done.txt', fixNode: 'code', maxLoops: 2 },
      { id: 'review', role: 'reviewer', verdict: true, readOnly: true, includeDiff: true, mock: { verdicts: ['PASS'] } },
      { id: 'ok', kind: 'approval' },
    ],
    [['plan', 'code'], ['code', 'tests'], ['tests', 'review'], ['review', 'ok']],
  );

describe('engine', () => {
  it('loops a failing gate back to the fixing agent, pauses at approval, and resumes without re-running finished nodes', async () => {
    const { engine, mock, store } = setup();
    const repo = makeRepo();
    const id = await engine.start({ pipeline: fullPipeline(), task: 'add done.txt', repo });
    let s = await engine.wait(id);

    expect(s.status).toBe('paused');
    expect(s.nodes.code!.attempts).toBe(2); // first attempt failed the gate, second fixed it
    expect(s.nodes.tests!.loops).toBe(1);
    expect(s.nodes.tests!.status).toBe('done');
    expect(s.nodes.review!.verdict).toBe('PASS');
    expect(s.nodes.ok!.status).toBe('awaiting');
    expect(s.nodes.code!.commit).toBeTruthy();

    // the fix attempt was told why it was sent back
    const fixPrompt = mock.calls.filter((c) => c.nodeId === 'code')[1]!.prompt;
    expect(fixPrompt).toContain('A check failed');
    // the reviewer saw the diff
    expect(mock.calls.find((c) => c.nodeId === 'review')!.prompt).toContain('done.txt');
    // the user's own checkout is untouched
    expect(existsSync(join(repo, 'done.txt'))).toBe(false);
    expect(existsSync(join(s.workdir, 'done.txt'))).toBe(true);

    const callsBefore = mock.calls.length;
    engine.approve(id, 'ok', true);
    await engine.resume(id);
    s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.length).toBe(callsBefore); // nothing re-ran
    expect(store.events(id).some((e) => e.event.type === 'run.resumed')).toBe(true);
  });

  it('a rejected approval fails the run', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: fullPipeline(), task: 't', repo: makeRepo() });
    await engine.wait(id);
    engine.approve(id, 'ok', false);
    await engine.resume(id);
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
  });

  it('autoApprove runs straight through', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: fullPipeline(), task: 't', repo: makeRepo(), autoApprove: true });
    expect((await engine.wait(id)).status).toBe('done');
  });

  it('stop leaves the interrupted node recoverable; resume runs only what is left', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true },
        { id: 'b', role: 'coder', mock: { delayMs: 800, writeFile: { path: 'b.txt', content: 'b' } } },
        { id: 'c', role: 'tester', readOnly: true },
      ],
      [['a', 'b'], ['b', 'c']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    await new Promise((r) => setTimeout(r, 250));
    expect(engine.stop(id)).toBe(true);
    let s = await engine.wait(id);
    expect(s.status).toBe('stopped');
    expect(s.nodes.a!.status).toBe('done');
    expect(s.nodes.b!.output).toBeUndefined(); // never recorded a result

    await engine.resume(id);
    s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.filter((c) => c.nodeId === 'a')).toHaveLength(1); // a was not re-run
    expect(s.nodes.b!.status).toBe('done');
    expect(s.nodes.b!.attempts).toBe(2);
  });

  it('a failed node skips its downstream, lets siblings finish, and the run errors', async () => {
    const { engine } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true },
        { id: 'bad', role: 'coder', mock: { failFirst: 5 } },
        { id: 'sib', role: 'architect', readOnly: true },
        { id: 'after', role: 'tester', readOnly: true },
      ],
      [['a', 'bad'], ['a', 'sib'], ['bad', 'after']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.nodes.bad!.status).toBe('error');
    expect(s.nodes.sib!.status).toBe('done');
    expect(s.nodes.after!.status).toBe('skipped');
  });

  it('resume with retryFailed re-runs only the failed branch', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true },
        { id: 'flaky', role: 'coder', mock: { failFirst: 1 } },
      ],
      [['a', 'flaky']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    expect((await engine.wait(id)).status).toBe('error');
    await engine.resume(id);
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.filter((c) => c.nodeId === 'a')).toHaveLength(1);
  });

  it('reverts and fails a read-only node that modifies files', async () => {
    const { engine } = setup();
    const p = pipe([{ id: 'sneaky', role: 'planner', readOnly: true, mock: { writeFile: { path: 'oops.txt', content: 'x' } } }], []);
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.nodes.sneaky!.status).toBe('error');
    expect(s.nodes.sneaky!.error).toMatch(/read-only/);
    expect(existsSync(join(s.workdir, 'oops.txt'))).toBe(false);
  });

  it('stops spending once the cap is reached', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true, mock: { costUsd: 0.6 } },
        { id: 'b', role: 'coder', mock: { costUsd: 0.6 } },
      ],
      [['a', 'b']],
      { maxCostUsd: 0.5 },
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/budget/);
    expect(s.nodes.b!.status).toBe('skipped');
    expect(mock.calls.some((c) => c.nodeId === 'b')).toBe(false);
  });

  it('a gate that never passes ends the run in error after the loop limit', async () => {
    const { engine } = setup();
    const p = pipe(
      [
        { id: 'code', role: 'coder', mock: { output: 'tried' } },
        { id: 'tests', kind: 'gate', command: 'echo nope >&2; exit 3', fixNode: 'code', maxLoops: 1 },
      ],
      [['code', 'tests']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.nodes.tests!.loops).toBe(1);
    expect(s.nodes.tests!.gate!.exitCode).toBe(3);
    expect(s.nodes.code!.attempts).toBe(2);
  });

  it('passes upstream output downstream and runs setup once', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true, mock: { output: 'UNIQUE-UPSTREAM-TEXT' } },
        { id: 'b', role: 'coder', mock: { output: 'done' } },
      ],
      [['a', 'b']],
      { setup: 'echo hi > setup.marker' },
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.find((c) => c.nodeId === 'b')!.prompt).toContain('UNIQUE-UPSTREAM-TEXT');
    expect(s.setupDone).toBe(true);
    // setup output stays out of the agent's commits (it is not the agent's work), and out of the read-only check
    expect(s.setupArtifacts).toContain('setup.marker');
    expect(s.nodes.b!.commit).toBeUndefined();
    expect(s.nodes.a!.status).toBe('done');
  });

  it('refuses unsupported modes in the engine itself, not just preflight', async () => {
    const { engine, store } = setup();
    const p = pipe([{ id: 'a' }], []);
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    await engine.wait(id);
    // tamper: hand the engine a swarm run directly
    const swarm = { ...p, mode: 'swarm' as const };
    const repo = makeRepo();
    await expect(engine.start({ pipeline: swarm, task: 't', repo })).rejects.toThrow(/no scheduler/);
    expect(store.list().length).toBe(1);
  });
});
