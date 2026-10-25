import { describe, expect, it } from 'vitest';
import { createSim, kick, pin, positions, release, REST, setHidden, settle, tick } from './forceSim';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('force simulation', () => {
  it('starts the same way every time and comes to rest', () => {
    const a = createSim(nodes, edges);
    expect(positions(a)).toEqual(positions(createSim(nodes, edges)));
    const ticks = settle(a);
    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(1000);
    expect(a.energy).toBeLessThan(REST);
    for (const p of positions(a).values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('keeps linked notes closer than distant ones', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const p = positions(s);
    expect(dist(p.get('n0')!, p.get('n1')!)).toBeLessThan(dist(p.get('n0')!, p.get('n11')!));
  });

  it('holds a pinned note where it is dragged and springs its neighbours after it', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const target = { x: 600, y: 600 };
    const before = dist(positions(s).get('n1')!, target);
    pin(s, 'n0', target.x, target.y);
    for (let i = 0; i < 40; i++) tick(s);
    expect(positions(s).get('n0')).toEqual(target);
    expect(dist(positions(s).get('n1')!, target)).toBeLessThan(before);
    release(s, 'n0');
    settle(s);
    expect(s.energy).toBeLessThan(REST);
  });

  it('leaves hidden notes out of the forces and where they were', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const was = positions(s).get('n5');
    setHidden(s, new Set(['n5']));
    kick(s, 1);
    settle(s);
    expect(positions(s).get('n5')).toEqual(was);
  });

  it('keeps known positions and starts a new note next to a linked one', () => {
    const s = createSim(nodes, edges);
    settle(s);
    const prev = positions(s);
    const t = createSim([...nodes, { id: 'new' }], [...edges, { from: 'n3', to: 'new' }], prev);
    expect(positions(t).get('n3')).toEqual(prev.get('n3'));
    expect(dist(positions(t).get('new')!, prev.get('n3')!)).toBeLessThan(60);
  });

  it('re-runs the layout the same way for the same seed', () => {
    const a = createSim(nodes, edges);
    const b = createSim(nodes, edges);
    settle(a);
    settle(b);
    kick(a, 7);
    kick(b, 7);
    settle(a);
    settle(b);
    expect(positions(a)).toEqual(positions(b));
  });

  it('copes with no notes, self links and links to unknown notes', () => {
    expect(settle(createSim([], []))).toBe(0);
    const s = createSim([{ id: 'a' }], [{ from: 'a', to: 'a' }, { from: 'a', to: 'ghost' }]);
    expect(s.links).toEqual([]);
    settle(s);
    expect(Number.isFinite(positions(s).get('a')!.x)).toBe(true);
  });
});
