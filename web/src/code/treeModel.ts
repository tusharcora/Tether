import type { GitBadge, TreeEntry } from './codeApi';

/** Each loaded folder's entries, by its project-relative path ('' is the project folder). */
export type Dirs = Record<string, TreeEntry[]>;
export type Row = TreeEntry & { depth: number };

/** The rows on screen: depth first, an expanded folder's entries right under it (once loaded). */
export function visibleRows(dirs: Dirs, expanded: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of dirs[dir] ?? []) {
      out.push({ ...e, depth });
      if (e.kind === 'dir' && expanded.has(e.path)) walk(e.path, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

/** The folders that hold `path`, outermost first: 'src/http/limit.ts' → ['src', 'src/http']. */
export const ancestors = (path: string): string[] => path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'));

/** A whole tree built from a list of file paths (the "Changed by runs" filter), folders first, then by name. */
export function dirsFromPaths(paths: string[]): Dirs {
  const dirs: Record<string, Map<string, TreeEntry>> = {};
  for (const path of paths) {
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const parent = parts.slice(0, i).join('/');
      const at = parts.slice(0, i + 1).join('/');
      (dirs[parent] ??= new Map()).set(name, { name, path: at, kind: i < parts.length - 1 ? 'dir' : 'file' });
    });
  }
  const order = (a: TreeEntry, b: TreeEntry) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1);
  return Object.fromEntries(Object.entries(dirs).map(([d, m]) => [d, [...m.values()].sort(order)]));
}

export interface TreeNode {
  path: string;
  name: string;
  kind: 'dir' | 'file';
  git?: GitBadge;
  children: TreeNode[];
}

/** The visible rows (depth first, with depths) as nested nodes, for beui's FileTree. */
export function nestRows(rows: Row[]): TreeNode[] {
  const top: TreeNode[] = [];
  const open: TreeNode[] = [];
  for (const r of rows) {
    const n: TreeNode = { path: r.path, name: r.name, kind: r.kind, ...(r.git ? { git: r.git } : {}), children: [] };
    open.length = r.depth;
    (open[r.depth - 1]?.children ?? top).push(n);
    open.push(n);
  }
  return top;
}

/** beui reports the whole expanded list; Code expands or collapses one folder at a time. */
export function expandDiff(prev: ReadonlySet<string>, next: string[]): { expand?: string; collapse?: string } {
  const expand = next.find((x) => !prev.has(x));
  if (expand) return { expand };
  const collapse = [...prev].find((x) => !next.includes(x));
  return collapse ? { collapse } : {};
}
