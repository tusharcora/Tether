import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, COL_GAP, edgeState, layersOf, PAD, placeCards, ROW_GAP, stepOrder } from './graphModel';

const N = (...ids: string[]) => ids.map((id) => ({ id }));

describe('graphModel', () => {
  it('layers by longest path from a root', () => {
    expect(layersOf(N('a', 'b', 'c', 'd'), [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }])).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(layersOf(N('a', 'b'), [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toEqual([['a'], ['b']]);
    expect(layersOf(N('x', 'y'), [])).toEqual([['x', 'y']]);
  });
  it('takes the longest path, ignores unknown ids and keeps pipeline order inside a layer', () => {
    expect(layersOf(N('a', 'b', 'c'), [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }, { from: 'ghost', to: 'a' }])).toEqual([['a'], ['b'], ['c']]);
    expect(stepOrder(N('d', 'a', 'b'), [{ from: 'a', to: 'b' }])).toEqual(['d', 'a', 'b']);
  });
  it('colours edges by the state of their ends', () => {
    expect(edgeState('done', 'running')).toBe('live');
    expect(edgeState('done', 'error')).toBe('failed');
    expect(edgeState('done', 'queued')).toBe('done');
    expect(edgeState('queued', 'queued')).toBe('idle');
  });
  it('places cards in columns and centres short columns', () => {
    const { pos, width, height } = placeCards([['a'], ['b', 'c']]);
    expect(pos.b!.x).toBe(PAD + CARD_W + COL_GAP);
    expect(pos.a!.y).toBe(PAD + 0.5 * (CARD_H + ROW_GAP));
    expect(width).toBe(2 * PAD + 2 * CARD_W + COL_GAP);
    expect(height).toBe(2 * PAD + 2 * CARD_H + ROW_GAP);
  });
});
