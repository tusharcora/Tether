import { describe, expect, it } from 'vitest';
import { ancestors, dirsFromPaths, expandDiff, nestRows, visibleRows, type Dirs, type Row } from './treeModel';

const dirs: Dirs = {
  '': [{ name: 'src', path: 'src', kind: 'dir' }, { name: 'README.md', path: 'README.md', kind: 'file' }],
  src: [{ name: 'http', path: 'src/http', kind: 'dir' }, { name: 'a.ts', path: 'src/a.ts', kind: 'file', git: 'M' }],
  'src/http': [{ name: 'limit.ts', path: 'src/http/limit.ts', kind: 'file' }],
};

describe('treeModel', () => {
  it('shows expanded folders’ entries under them, depth first', () => {
    expect(visibleRows(dirs, new Set()).map((r) => r.path)).toEqual(['src', 'README.md']);
    expect(visibleRows(dirs, new Set(['src', 'src/http'])).map((r) => [r.path, r.depth])).toEqual([['src', 0], ['src/http', 1], ['src/http/limit.ts', 2], ['src/a.ts', 1], ['README.md', 0]]);
    expect(visibleRows(dirs, new Set(['src/http'])).map((r) => r.path)).toEqual(['src', 'README.md']);
  });

  it('names the folders that hold a path', () => {
    expect(ancestors('src/http/limit.ts')).toEqual(['src', 'src/http']);
    expect(ancestors('README.md')).toEqual([]);
  });

  it('builds a whole tree from changed paths', () => {
    const d = dirsFromPaths(['src/http/limit.ts', 'test/limit.test.ts', 'package.json', 'src/a.ts']);
    expect(d['']!.map((e) => e.path)).toEqual(['src', 'test', 'package.json']);
    expect(d.src!.map((e) => [e.path, e.kind])).toEqual([['src/http', 'dir'], ['src/a.ts', 'file']]);
  });

  it('nests flat depth rows into a tree', () => {
    const rows: Row[] = [{ name: 'src', path: 'src', kind: 'dir', depth: 0 }, { name: 'a.ts', path: 'src/a.ts', kind: 'file', depth: 1, git: 'M' }, { name: 'README.md', path: 'README.md', kind: 'file', depth: 0 }];
    expect(nestRows(rows)).toEqual([{ path: 'src', name: 'src', kind: 'dir', children: [{ path: 'src/a.ts', name: 'a.ts', kind: 'file', git: 'M', children: [] }] }, { path: 'README.md', name: 'README.md', kind: 'file', children: [] }]);
    expect(nestRows(visibleRows(dirs, new Set(['src', 'src/http'])))[0]!.children[0]!.children.map((n) => n.path)).toEqual(['src/http/limit.ts']);
  });

  it('turns beui’s expanded list into one expand or collapse', () => {
    expect(expandDiff(new Set(['a']), ['a', 'b'])).toEqual({ expand: 'b' });
    expect(expandDiff(new Set(['a', 'b']), ['a'])).toEqual({ collapse: 'b' });
    expect(expandDiff(new Set(['a']), ['a'])).toEqual({});
  });
});
