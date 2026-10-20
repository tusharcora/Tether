/** Fuzzy matching for the command palette: subsequence match with word-start and run bonuses. */

/** Score `text` against `query` (higher is better), or null when the query is not a subsequence. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    const boundary = at === 0 || /[\s/_:.-]/.test(t[at - 1]!);
    score += 1 + (boundary ? 4 : 0) + (at === prev + 1 ? 3 : 0) - Math.min(2, (at - ti) * 0.1);
    prev = at;
    ti = at + 1;
  }
  const exact = t.indexOf(q);
  if (exact >= 0) score += 6 + (exact === 0 ? 4 : 0);
  return score - t.length * 0.01;
}

/** Keep the items that match, best first. An empty query keeps the original order. */
export function rank<T>(items: T[], query: string, text: (t: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((it, i) => ({ it, i, s: fuzzyScore(query, text(it)) }))
    .filter((x): x is { it: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it);
}
