import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, pipe, plainFolder, setup } from './helpers.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const readOnly = () => pipe([{ id: 'r', role: 'planner', readOnly: true, mock: { output: 'ok' } }], []);

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

  it('starts a team run', async () => {
    const { engine, store } = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const id = await engine.startTeam({ task: 't', repo: folder, workspace: false, roster: ['coder'], mock: { plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'c', mode: 'read' }] } } as never });
    expect(store.state(id)!.history).toBeTruthy();
    expect(readdirSync(folder)).toEqual(['a.txt']);
  });

  it('deleting the run removes its worktree and branch from the history', async () => {
    const { engine } = setup();
    const s = await engine.wait(await engine.start({ pipeline: readOnly(), task: 't', repo: plainFolder({ 'a.txt': '1' }) }));
    expect(git(s.history!, 'branch')).toContain('aorch/');
    await engine.deleteRun(s.id);
    expect(git(s.history!, 'branch')).not.toContain('aorch/');
    expect(existsSync(s.workdir)).toBe(false);
  });

  it('rewinds in a plain folder', async () => {
    const { engine } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'coder', mock: { writeFile: { path: 'a2.txt', content: 'a\n' } } },
        { id: 'b', role: 'coder', mock: { writeFile: { path: 'b2.txt', content: 'b\n' } } },
        { id: 'ok', kind: 'approval', title: 'You approve' },
      ],
      [['a', 'b'], ['b', 'ok']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: plainFolder({ 'a.txt': '1' }) });
    await engine.wait(id);
    const s = await engine.rewind(id, 'b');
    expect(existsSync(join(s.workdir, 'b2.txt'))).toBe(false);
    expect(existsSync(join(s.workdir, 'a2.txt'))).toBe(true);
  });

  it('gives a linked worktree its left-out files and a notice naming them', async () => {
    const { engine } = setup();
    const folder = plainFolder({ 'a.txt': '1', 'node_modules/x/i.js': 'dep' });
    const s = await engine.wait(await engine.start({ pipeline: readOnly(), task: 't', repo: folder }));
    expect(readFileSync(join(s.workdir, 'node_modules/x/i.js'), 'utf8')).toBe('dep');
    expect((s.notices ?? []).map((n) => n.text).join()).toContain('node_modules');
    expect(git(s.workdir, 'status', '--porcelain')).toBe('');
  });

  it('a real repo with uncommitted work carries it into the run', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    writeFileSync(join(repo, 'wip.txt'), 'mine\n');
    const s = await engine.wait(await engine.start({ pipeline: readOnly(), task: 't', repo }));
    expect(readFileSync(join(s.workdir, 'wip.txt'), 'utf8')).toBe('mine\n');
    expect(s.history).toBeUndefined();
  });

  it('a run from a ref ignores uncommitted work', async () => {
    const { engine } = setup();
    const repo = makeRepo();
    writeFileSync(join(repo, 'wip.txt'), 'mine\n');
    const s = await engine.wait(await engine.start({ pipeline: readOnly(), task: 't', repo, ref: git(repo, 'rev-parse', 'HEAD') }));
    expect(existsSync(join(s.workdir, 'wip.txt'))).toBe(false);
  });
});
