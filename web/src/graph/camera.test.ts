import { describe, expect, it } from 'vitest';
import { ease, fitView, focusView, K_MAX, K_MIN, lerpView, toWorld, zoomAt } from './camera';

describe('camera', () => {
  it('zooms about a point and clamps the zoom', () => {
    const v = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 100);
    expect(v).toEqual({ k: 2, x: -100, y: -100 });
    expect(zoomAt(v, 100, 0, 0).k).toBe(K_MAX);
    expect(zoomAt(v, 0.001, 0, 0).k).toBe(K_MIN);
  });

  it('fits points into a box and centres one note', () => {
    expect(fitView([{ x: -100, y: -50 }, { x: 100, y: 50 }], 800, 600)).toEqual({ k: 1.4, x: 400, y: 300 });
    expect(fitView([], 800, 600)).toEqual({ k: 1, x: 400, y: 300 });
    expect(focusView({ x: 10, y: 20 }, 2, 800, 600)).toEqual({ k: 2, x: 380, y: 260 });
  });

  it('maps the screen to the world and eases between views', () => {
    expect(toWorld({ x: 10, y: 20, k: 2 }, 30, 60)).toEqual({ x: 10, y: 20 });
    const a = { x: 0, y: 0, k: 1 };
    const b = { x: 100, y: -50, k: 2 };
    expect(lerpView(a, b, 0)).toEqual(a);
    expect(lerpView(a, b, 1)).toEqual(b);
    expect([ease(0), ease(1)]).toEqual([0, 1]);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });
});
