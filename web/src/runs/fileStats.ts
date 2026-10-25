export interface FileStat {
  file: string;
  add: number;
  del: number;
}

/** Per-file added/removed line counts from a unified diff (headers and hunk markers are not counted). */
export function fileStats(diff: string): FileStat[] {
  const out: FileStat[] = [];
  let cur: FileStat | undefined;
  for (const l of diff.split('\n')) {
    const m = /^diff --git a\/.+? b\/(.+)$/.exec(l);
    if (m) {
      cur = { file: m[1]!, add: 0, del: 0 };
      out.push(cur);
      continue;
    }
    if (!cur || l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) cur.add++;
    else if (l.startsWith('-')) cur.del++;
  }
  return out;
}
