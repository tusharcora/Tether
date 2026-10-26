import { describe, expect, it } from 'vitest';
import { makeRow } from '../test/fixtures';
import { liveProjects, projectOf, runProject } from './projects';

const ws = (id: string, path: string) => ({ id, name: id, path, isDefault: false, exists: true, repos: [] });
const list = [ws('repo', '/private/tmp/smoke/repo'), ws('shop', '/code/shop'), ws('api', '/code/shop/api')];

describe('which project a run belongs to', () => {
  it('matches by the repo’s real path, so /tmp/… finds the project registered as /private/tmp/…', () => {
    expect(projectOf(list, '/tmp/smoke/repo')).toBeUndefined();
    expect(runProject(list, makeRow({ repo: '/tmp/smoke/repo', repoReal: '/private/tmp/smoke/repo' }))?.id).toBe('repo');
  });

  it('falls back to the path as given, and the deepest project wins', () => {
    expect(runProject(list, { repo: '/code/shop/api/src' })?.id).toBe('api');
    expect(runProject(list, makeRow({ repo: '/code/shop', repoReal: '/elsewhere' }))?.id).toBe('shop');
  });

  it('marks the project of a live run reached through a symlinked path', () => {
    expect([...liveProjects(list, [makeRow({ live: true, repo: '/tmp/smoke/repo', repoReal: '/private/tmp/smoke/repo' }), makeRow({ live: false, repo: '/code/shop', repoReal: '/code/shop' })])]).toEqual(['repo']);
  });
});
