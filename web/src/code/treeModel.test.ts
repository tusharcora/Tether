import { describe, expect, it } from 'vitest';
import { ancestors, dirsFromPaths, keyMove, visibleRows, type Dirs } from './treeModel';

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

  it('moves with the arrow keys like a tree', () => {
    const open = new Set(['src']);
    const rows = visibleRows(dirs, open); // src, src/http, src/a.ts, README.md
    expect(keyMove(rows, 0, 'ArrowDown', open)).toEqual({ focus: 1 });
    expect(keyMove(rows, 3, 'ArrowDown', open)).toEqual({ focus: 3 });
    expect(keyMove(rows, 0, 'ArrowUp', open)).toEqual({ focus: 0 });
    expect(keyMove(rows, 0, 'ArrowRight', open)).toEqual({ focus: 1 });
    expect(keyMove(rows, 1, 'ArrowRight', open)).toEqual({ expand: 'src/http' });
    expect(keyMove(rows, 0, 'ArrowLeft', open)).toEqual({ collapse: 'src' });
    expect(keyMove(rows, 2, 'ArrowLeft', open)).toEqual({ focus: 0 });
    expect(keyMove(rows, 2, 'Enter', open)).toEqual({ open: 'src/a.ts' });
    expect(keyMove(rows, 1, 'Enter', open)).toEqual({ expand: 'src/http' });
    expect(keyMove(rows, 0, 'End', open)).toEqual({ focus: 3 });
    expect(keyMove(rows, 3, 'ArrowRight', open)).toBeUndefined();
  });
});
