import { describe, expect, it } from 'vitest';
import { Canvas, costChart, timelineChart, toLines } from '../src/raster.js';
import { strip, vlen } from '../src/ui.js';
import { sampleRun } from '../src/sample.js';

describe('raster', () => {
  it('draws two pixels per cell and clips out-of-range writes', () => {
    const c = new Canvas(4, 4);
    c.rect(0, 0, 2, 4, [255, 0, 0]);
    c.set(99, 99, [1, 2, 3]);
    c.set(-1, 0, [1, 2, 3]);
    expect(toLines(c).map(strip)).toEqual(['██  ', '██  ']);
    const d = new Canvas(2, 2);
    d.set(0, 0, [1, 1, 1]);
    d.set(1, 1, [1, 1, 1]);
    expect(toLines(d).map(strip)).toEqual(['▀▄']);
  });
  it('every line is exactly the canvas width', () => {
    const c = new Canvas(7, 5);
    c.rect(1, 0, 6, 5, [10, 200, 30]);
    for (const l of toLines(c)) expect(vlen(l)).toBe(7);
  });
  it('timeline: one lane per started step, bars within the canvas', () => {
    const st = sampleRun(Date.now());
    const { canvas, lanes } = timelineChart(st, Date.now(), 40, () => [0, 200, 0], [255, 0, 0]);
    expect(lanes.length).toBeGreaterThan(0);
    expect(canvas.h).toBe(lanes.length * 2);
    expect(canvas.px.some((p) => p)).toBe(true);
    expect(toLines(canvas).every((l) => vlen(l) === 40)).toBe(true);
  });
  it('cost chart fills under the line and is empty for a flat series', () => {
    const c = costChart([0, 1, 2, 4], 20, 3, [0, 255, 255]);
    expect(c.h).toBe(6);
    expect(c.get(19, 0)).not.toBeNull(); // highest point reaches the top
    expect(c.get(19, 5)).not.toBeNull(); // filled down to the base
    expect(c.get(0, 0)).toBeNull();
    expect(costChart([0], 10, 2, [1, 1, 1]).px.every((p) => p === null)).toBe(true);
  });
});
