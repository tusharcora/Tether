import { describe, expect, it } from 'vitest';
import { adjacency, matchLocal, neighbourhood, shapePath, typeOf } from './graphModel';

describe('graph model', () => {
  it('maps vault note types onto six shapes', () => {
    expect(['run', 'pipeline', 'role', 'file', 'lesson', 'lesson-retired', 'harness-adopted', undefined, 'whatever'].map((t) => typeOf(t))).toEqual([
      'run', 'pipeline', 'role', 'file', 'lesson', 'lesson', 'note', 'note', 'note',
    ]);
  });

  it('draws a distinct finite outline for every shaped type', () => {
    const d = (['run', 'pipeline', 'role', 'lesson', 'file'] as const).map((t) => shapePath(t, 8));
    expect(new Set(d).size).toBe(5);
    expect(shapePath('note', 8)).toBe(shapePath('file', 8));
    for (const p of [...d, shapePath('note', 8)]) expect(p).not.toMatch(/NaN|Infinity/);
  });

  it('collects the neighbourhood of a note up to n hops', () => {
    const adj = adjacency([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }]);
    expect([...neighbourhood(adj, 'b', 1)].sort()).toEqual(['a', 'b', 'c']);
    expect([...neighbourhood(adj, 'b', 2)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...neighbourhood(adj, 'a', 3)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(neighbourhood(adj, undefined, 2).size).toBe(0);
  });

  it('matches notes by title, path and tag, with or without #', () => {
    const nodes = [
      { id: 'Roles/coder.md', title: 'Coder', tags: [] },
      { id: 'decisions/loopback.md', title: 'Loopback-only server', tags: ['security'] },
    ];
    expect([...matchLocal(nodes, 'cod')]).toEqual(['Roles/coder.md']);
    expect([...matchLocal(nodes, '#security')]).toEqual(['decisions/loopback.md']);
    expect([...matchLocal(nodes, 'roles/')]).toEqual(['Roles/coder.md']);
    expect(matchLocal(nodes, '  ').size).toBe(0);
  });
});
