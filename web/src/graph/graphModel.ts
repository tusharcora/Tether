/** What the Graph knows about notes: their type (drawn as a shape, never a hue), neighbourhoods and local search. */
export type GraphType = 'run' | 'pipeline' | 'role' | 'file' | 'lesson' | 'note';
export const TYPES: GraphType[] = ['run', 'pipeline', 'role', 'file', 'lesson', 'note'];
export const TYPE_LABEL: Record<GraphType, string> = { run: 'runs', pipeline: 'pipelines', role: 'roles', file: 'files', lesson: 'lessons', note: 'notes' };

export function typeOf(t?: string): GraphType {
  if (t === 'lesson-retired') return 'lesson';
  return t && (TYPES as string[]).includes(t) ? (t as GraphType) : 'note';
}

/** Busier notes are a little larger, with a ceiling so hubs never swamp the board. */
export const nodeRadius = (degree: number): number => 6 + Math.min(10, Math.sqrt(degree) * 2.2);

const f = (n: number) => Number(n.toFixed(2));
const circle = (r: number) => `M${f(-r)},0a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0`;

/** The note's outline centred on 0,0. */
export function shapePath(t: GraphType, r: number): string {
  switch (t) {
    case 'run':
      return `M${f(-r)},${f(-r)}h${f(2 * r)}v${f(2 * r)}h${f(-2 * r)}z`;
    case 'lesson': {
      const d = r * 1.25;
      return `M0,${f(-d)}L${f(d)},0L0,${f(d)}L${f(-d)},0z`;
    }
    case 'role': {
      const h = r * 1.25;
      return `M0,${f(-h)}L${f(h * 1.05)},${f(h * 0.8)}L${f(-h * 1.05)},${f(h * 0.8)}z`;
    }
    case 'pipeline': {
      const R = r * 1.15;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return `${f(Math.cos(a) * R)},${f(Math.sin(a) * R)}`;
      });
      return `M${pts.join('L')}z`;
    }
    default:
      return circle(r);
  }
}

/** 12×12 glyphs for the type filters, the reader and the note list. */
export const GLYPH: Record<GraphType, string> = {
  run: 'M2,2h8v8h-8z',
  pipeline: 'M11,6L8.5,10.3L3.5,10.3L1,6L3.5,1.7L8.5,1.7z',
  role: 'M6,1.5L11,10L1,10z',
  file: 'M2,6a4,4 0 1,0 8,0a4,4 0 1,0 -8,0',
  lesson: 'M6,1L11,6L6,11L1,6z',
  note: 'M2,6a4,4 0 1,0 8,0a4,4 0 1,0 -8,0',
};

export function adjacency(edges: { from: string; to: string }[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return adj;
}

/** The focus note and everything within `depth` links of it; empty with no focus. */
export function neighbourhood(adj: Map<string, Set<string>>, focus: string | undefined, depth: number): Set<string> {
  const near = new Set<string>();
  if (!focus) return near;
  near.add(focus);
  let frontier = [focus];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const o of adj.get(id) ?? [])
        if (!near.has(o)) {
          near.add(o);
          next.push(o);
        }
    frontier = next;
  }
  return near;
}

/** Notes whose title, path or tags contain the query (a leading # searches tags only). */
export function matchLocal(nodes: { id: string; title: string; tags: string[] }[], q: string): Set<string> {
  const raw = q.trim().toLowerCase();
  const hits = new Set<string>();
  if (!raw) return hits;
  const tagOnly = raw.startsWith('#');
  const needle = tagOnly ? raw.slice(1) : raw;
  if (!needle) return hits;
  for (const n of nodes) {
    const tag = n.tags.some((t) => t.toLowerCase().includes(needle));
    if (tag || (!tagOnly && (n.title.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle)))) hits.add(n.id);
  }
  return hits;
}
