import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFor, projectFromCwd } from '../src/http/workspace.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

describe('project lookup', () => {
  it('server: ?ws, else the default workspace, else none', () => {
    const home = tmp('home-');
    expect(projectFor(home)).toBeUndefined();
    const dir = makeRepo();
    initWorkspace(home, dir, { id: 'api', write: false });
    expect(projectFor(home)).toMatchObject({ scope: 'api', workspaceId: 'api' });
    expect(() => projectFor(home, 'nope')).toThrow('unknown workspace "nope"');
  });

  it('cli: the registered workspace for the folder, also from a git worktree of it; else scope default', () => {
    const home = tmp('home-');
    const repo = makeRepo();
    initWorkspace(home, repo, { id: 'api' });
    expect(projectFromCwd(home, repo)).toMatchObject({ scope: 'api', dir: repo });
    const wt = `${tmp('wt-')}/w`;
    execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: repo });
    const p = projectFromCwd(home, wt);
    expect(p.scope).toBe('api');
    expect(p.dir).toBe(wt);
    expect(projectFromCwd(home, tmp('loose-'))).toMatchObject({ scope: 'default' });
  });

  it('cli: finds the project folder above the current directory', () => {
    const home = tmp('home-');
    const root = tmp('proj-');
    mkdirSync(join(root, '.aorch'));
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    expect(projectFromCwd(home, join(root, 'a', 'b'))).toEqual({ scope: 'default', dir: root, envDir: root });
  });

  it('cli: never takes the aorch home for a project, and stops looking there', () => {
    const base = realpathSync(tmp('user-'));
    const home = join(base, '.aorch'); // the layout of ~/.aorch
    mkdirSync(join(home, 'http'), { recursive: true });
    const cwd = join(base, 'sub');
    mkdirSync(cwd);
    expect(projectFromCwd(home, cwd)).toEqual({ scope: 'default', dir: cwd, envDir: cwd });
    // the folder that holds the home itself (~) would put requests in ~/.aorch/http: refused
    expect(() => projectFromCwd(home, base)).toThrow('is the aorch home, not a project');
    // a project folder further up is not reached through the home's parent
    const outer = realpathSync(tmp('outer-'));
    mkdirSync(join(outer, '.aorch'));
    const home2 = join(outer, 'u', '.aorch');
    mkdirSync(home2, { recursive: true });
    const cwd2 = join(outer, 'u', 'sub');
    mkdirSync(cwd2);
    expect(projectFromCwd(home2, cwd2).dir).toBe(cwd2);
    // also when the home is given by a different spelling of the same folder
    expect(projectFromCwd(join(outer, 'u', 'sub', '..', '.aorch'), cwd2).dir).toBe(cwd2);
  });
});
