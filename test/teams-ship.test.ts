import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/exec.js';
import { mergePr, prChecks, shipBranch } from '../src/teams/ship.js';
import { makeRepo, tmp } from './helpers.js';

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

/** A repo with a local bare `origin` and a run branch one commit ahead of main. */
function rig(remote = true) {
  const repo = makeRepo();
  const base = g(repo, 'rev-parse', 'HEAD');
  const bare = tmp('bare-');
  g(bare, 'init', '-q', '--bare');
  if (remote) g(repo, 'remote', 'add', 'origin', bare);
  g(repo, 'checkout', '-q', '-b', 'aorch/r1');
  writeFileSync(join(repo, 'fix.txt'), 'fixed\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'fix');
  g(repo, 'checkout', '-q', 'main');
  return { repo, base, bare };
}
/** A fake `gh` answering from a table keyed by its first two args; records every call. */
function fakeGh(answers: Record<string, { code: number | null; stdout?: string; stderr?: string }>) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const exec: Exec = async (cmd, args, cwd) => {
    calls.push({ args, cwd });
    const a = answers[`${cmd} ${args.slice(0, 2).join(' ')}`] ?? { code: 1, stderr: 'unexpected call' };
    return { code: a.code, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
  return { exec, calls };
}
const ship = (r: ReturnType<typeof rig>, exec: Exec, branch = 'aorch/r1') => shipBranch({ repo: r.repo, branch, base: r.base, title: 'Fix the thing', body: 'Opened by Bolt', exec });

describe('shipping a run', () => {
  it('pushes the branch and opens a PR in the repo', async () => {
    const r = rig();
    const gh = fakeGh({ 'gh pr create': { code: 0, stdout: 'https://github.com/o/r/pull/7\n' } });
    expect(await ship(r, gh.exec)).toEqual({ url: 'https://github.com/o/r/pull/7', number: 7 });
    expect(g(r.bare, 'rev-parse', 'aorch/r1')).toBe(g(r.repo, 'rev-parse', 'aorch/r1'));
    expect(gh.calls[0]).toEqual({ args: ['pr', 'create', '--head', 'aorch/r1', '--title', 'Fix the thing', '--body', 'Opened by Bolt'], cwd: r.repo });
  });

  it('says so, and pushes nothing, when there is nothing to ship, no origin, or no gh', async () => {
    const r = rig();
    g(r.repo, 'branch', 'aorch/empty', 'main');
    const gh = fakeGh({});
    expect(await ship(r, gh.exec, 'aorch/empty')).toEqual({ error: 'Nothing to ship: the run changed no files.' });
    expect(gh.calls).toEqual([]);
    expect(await ship(rig(false), gh.exec)).toMatchObject({ error: expect.stringMatching(/^Could not push aorch\/r1/) });
    const missing = fakeGh({ 'gh pr create': { code: null, stderr: 'spawn gh ENOENT' } });
    expect(await ship(r, missing.exec)).toMatchObject({ error: expect.stringMatching(/GitHub CLI \(gh\) is not installed/) });
  });
});

describe('checks and merge', () => {
  const view = (rollup: unknown[], state = 'OPEN') => fakeGh({ 'gh pr view': { code: 0, stdout: JSON.stringify({ state, statusCheckRollup: rollup }) } }).exec;
  it('reads the PR checks as pass, pending, fail or merged', async () => {
    const url = 'https://github.com/o/r/pull/7';
    expect(await prChecks(url, view([]))).toBe('pass');
    expect(await prChecks(url, view([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', state: 'SUCCESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }]))).toBe('pass');
    expect(await prChecks(url, view([{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }]))).toBe('pending');
    expect(await prChecks(url, view([{ __typename: 'StatusContext', state: 'PENDING' }]))).toBe('pending');
    expect(await prChecks(url, view([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }]))).toBe('fail');
    expect(await prChecks(url, view([], 'MERGED'))).toBe('merged');
    await expect(prChecks(url, fakeGh({}).exec)).rejects.toThrow(/unexpected call/);
  });
  it('merges with a merge commit, or says why not', async () => {
    const ok = fakeGh({ 'gh pr merge': { code: 0 } });
    expect(await mergePr('https://github.com/o/r/pull/7', ok.exec)).toBeUndefined();
    expect(ok.calls[0]!.args).toEqual(['pr', 'merge', 'https://github.com/o/r/pull/7', '--merge']);
    expect(await mergePr('https://github.com/o/r/pull/7', fakeGh({ 'gh pr merge': { code: 1, stderr: 'Pull request is not mergeable\nmore' } }).exec)).toBe('Pull request is not mergeable');
  });
});
