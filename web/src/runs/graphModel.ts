import type { Edge, NodeState } from '../api';

export const CARD_W = 176, CARD_H = 56, COL_GAP = 44, ROW_GAP = 12, PAD = 16;

/**
 * Columns by dependency: a node's layer is the longest path to it from a root (a node nothing points at), pipeline order
 * inside a layer. Edges to unknown ids are ignored, and so is an edge that would close a cycle (a DFS back edge).
 */
export function layersOf(nodes: { id: string }[], edges: Edge[]): string[][] {
  const next = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) if (next.has(e.to)) next.get(e.from)?.push(e.to);
  const preds = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const seen = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    seen.set(id, 'open');
    for (const to of next.get(id)!) {
      if (seen.get(to) === 'open') continue;
      preds.get(to)!.push(id);
      if (!seen.has(to)) visit(to);
    }
    seen.set(id, 'done');
  };
  for (const n of nodes) if (!seen.has(n.id)) visit(n.id);
  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    let d = layer.get(id);
    if (d === undefined) layer.set(id, (d = Math.max(0, ...preds.get(id)!.map((p) => depth(p) + 1))));
    return d;
  };
  const cols: string[][] = [];
  for (const n of nodes) (cols[depth(n.id)] ??= []).push(n.id);
  return cols;
}

/** Steps in graph order: layer by layer, left to right. */
export const stepOrder = (nodes: { id: string }[], edges: Edge[]): string[] => layersOf(nodes, edges).flat();

export type EdgeState = 'done' | 'live' | 'failed' | 'idle';
export function edgeState(from?: NodeState['status'], to?: NodeState['status']): EdgeState {
  if (to === 'running' && from === 'done') return 'live';
  if (from === 'error' || to === 'error') return 'failed';
  return from === 'done' ? 'done' : 'idle';
}

/** Card positions: one column per layer, a short column centred against the tallest. */
export function placeCards(layers: string[][]): { pos: Record<string, { x: number; y: number }>; width: number; height: number } {
  const rows = Math.max(0, ...layers.map((l) => l.length));
  const pos: Record<string, { x: number; y: number }> = {};
  layers.forEach((l, col) => l.forEach((id, row) => (pos[id] = { x: PAD + col * (CARD_W + COL_GAP), y: PAD + (row + (rows - l.length) / 2) * (CARD_H + ROW_GAP) })));
  return { pos, width: 2 * PAD + layers.length * CARD_W + (layers.length - 1) * COL_GAP, height: 2 * PAD + rows * CARD_H + (rows - 1) * ROW_GAP };
}
