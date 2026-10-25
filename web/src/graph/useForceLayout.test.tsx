import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForceLayout } from './useForceLayout';

const graph = { nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}` })), edges: Array.from({ length: 7 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) };
const NONE: ReadonlySet<string> = new Set();

/** A hand-cranked requestAnimationFrame. */
function frames() {
  const q = new Map<number, FrameRequestCallback>();
  let id = 0;
  return {
    raf: (cb: FrameRequestCallback) => (q.set(++id, cb), id),
    caf: (h: number) => void q.delete(h),
    /** Run queued frames (and the frames they queue) until none is left or `max` ran; returns how many ran. */
    flush(max = 5000) {
      let n = 0;
      while (q.size && n < max) {
        const [k, cb] = q.entries().next().value as [number, FrameRequestCallback];
        q.delete(k);
        cb(n * 16);
        n++;
      }
      return n;
    },
    get size() {
      return q.size;
    },
  };
}

describe('useForceLayout', () => {
  it('settles at once under reduced motion and never asks for a frame', () => {
    const f = frames();
    const paint = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: true, paint, onSettled, raf: f.raf, caf: f.caf }));
    expect(f.size).toBe(0);
    expect(result.current.version).toBe(1);
    expect(result.current.running).toBe(false);
    expect(paint).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.points()).toHaveLength(8);
  });

  it('runs one frame loop that stops when the layout comes to rest', () => {
    const f = frames();
    const paint = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, paint, onSettled, raf: f.raf, caf: f.caf }));
    expect(result.current.running).toBe(true);
    expect(f.size).toBe(1);
    let ran = 0;
    act(() => void (ran = f.flush()));
    expect(ran).toBeGreaterThan(1);
    expect(ran).toBeLessThan(1000);
    expect(f.size).toBe(0);
    expect(result.current.running).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledTimes(ran + 1);
  });

  it('holds a dragged note, keeps the loop awake until it is let go, then settles', () => {
    const f = frames();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, raf: f.raf, caf: f.caf }));
    act(() => void f.flush());
    act(() => result.current.drag('n0', 500, 500));
    expect(f.size).toBe(1);
    act(() => void f.flush(60));
    expect(f.size).toBe(1);
    expect(result.current.position('n0')).toEqual({ x: 500, y: 500 });
    act(() => result.current.release('n0'));
    act(() => void f.flush());
    expect(f.size).toBe(0);
    expect(result.current.running).toBe(false);
  });

  it('treats a graph over the live limit like reduced motion', () => {
    const f = frames();
    const { result } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, liveMax: 5, raf: f.raf, caf: f.caf }));
    expect(f.size).toBe(0);
    expect(result.current.running).toBe(false);
  });

  it('re-settles when notes are hidden and re-runs on request', () => {
    const f = frames();
    const paint = vi.fn();
    const { result, rerender } = renderHook(({ hidden }) => useForceLayout(graph, hidden, { reduced: true, paint, raf: f.raf, caf: f.caf }), { initialProps: { hidden: NONE } });
    const before = result.current.position('n3');
    rerender({ hidden: new Set(['n0', 'n1']) });
    expect(paint).toHaveBeenCalledTimes(2);
    expect(result.current.points()).toHaveLength(6);
    act(() => result.current.rerun());
    expect(paint).toHaveBeenCalledTimes(3);
    expect(result.current.position('n3')).not.toEqual(before);
    expect(f.size).toBe(0);
  });

  it('cancels its frame when unmounted', () => {
    const f = frames();
    const { unmount } = renderHook(() => useForceLayout(graph, NONE, { reduced: false, raf: f.raf, caf: f.caf }));
    expect(f.size).toBe(1);
    unmount();
    expect(f.size).toBe(0);
  });
});
