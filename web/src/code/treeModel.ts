import type { TreeEntry } from './codeApi';

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

export type TreeMove = { focus: number } | { expand: string } | { collapse: string } | { open: string } | undefined;

/**
 * What a key does on row `at`: ↑/↓ move, Home/End jump, → opens a folder (or steps into an open one), ← closes it (or
 * steps out to the parent folder), Enter opens a file or flips a folder.
 */
export function keyMove(rows: Row[], at: number, key: string, expanded: ReadonlySet<string>): TreeMove {
  const r = rows[at];
  if (!r) return undefined;
  const open = r.kind === 'dir' && expanded.has(r.path);
  switch (key) {
    case 'ArrowDown':
      return { focus: Math.min(at + 1, rows.length - 1) };
    case 'ArrowUp':
      return { focus: Math.max(at - 1, 0) };
    case 'Home':
      return { focus: 0 };
    case 'End':
      return { focus: rows.length - 1 };
    case 'ArrowRight':
      return r.kind !== 'dir' ? undefined : open ? (rows[at + 1]?.depth ?? 0) > r.depth ? { focus: at + 1 } : undefined : { expand: r.path };
    case 'ArrowLeft': {
      if (open) return { collapse: r.path };
      const parent = r.path.split('/').slice(0, -1).join('/');
      const i = rows.findIndex((x) => x.path === parent);
      return i >= 0 ? { focus: i } : undefined;
    }
    case 'Enter':
      return r.kind === 'file' ? { open: r.path } : open ? { collapse: r.path } : { expand: r.path };
    default:
      return undefined;
  }
}
