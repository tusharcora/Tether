import { expect, it } from 'vitest';
import { layout } from './graphLayout';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));

it('is deterministic and finite', () => {
  const a = layout(nodes, edges);
  const b = layout(nodes, edges);
  expect([...a.entries()]).toEqual([...b.entries()]);
  for (const p of a.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
});

it('handles no nodes and edges to unknown nodes', () => {
  expect(layout([], []).size).toBe(0);
  expect(layout([{ id: 'a' }], [{ from: 'a', to: 'ghost' }]).size).toBe(1);
});
