import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBounds, MIN_HEIGHT, MIN_WIDTH, saveBounds } from '../src/app/windowState.js';
import { tmp } from './helpers.js';

const screen = [{ x: 0, y: 0, width: 1800, height: 1100 }];

describe('window bounds', () => {
  it('saves and reloads where the window was', () => {
    const home = tmp('home-');
    saveBounds(home, { x: 40, y: 60, width: 1300, height: 900 });
    expect(JSON.parse(readFileSync(join(home, 'app-window.json'), 'utf8'))).toEqual({ x: 40, y: 60, width: 1300, height: 900 });
    expect(loadBounds(home, screen)).toEqual({ x: 40, y: 60, width: 1300, height: 900 });
  });

  it('forgets a window left on a monitor that is gone, and never comes back below the minimum size', () => {
    const home = tmp('home-');
    saveBounds(home, { x: 2400, y: 60, width: 1300, height: 900 });
    expect(loadBounds(home, screen)).toBeUndefined();
    expect(loadBounds(home, [...screen, { x: 1800, y: 0, width: 1920, height: 1080 }])).toBeDefined();
    saveBounds(home, { x: 10, y: 10, width: 300, height: 200 });
    expect(loadBounds(home, screen)).toEqual({ x: 10, y: 10, width: MIN_WIDTH, height: MIN_HEIGHT });
  });

  it('ignores a missing or broken file', () => {
    const home = tmp('home-');
    expect(loadBounds(home, screen)).toBeUndefined();
    writeFileSync(join(home, 'app-window.json'), '{ "x": "left" }');
    expect(loadBounds(home, screen)).toBeUndefined();
  });
});
