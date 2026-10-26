/** Where the Tether window was and how big: <home>/app-window.json, so the app reopens the way it was left. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WIDTH = 960;
export const MIN_HEIGHT = 640;
const file = (home: string) => join(home, 'app-window.json');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The saved bounds when they are sane and their top-left corner is on one of `displays` (a monitor that is gone is not). */
export function loadBounds(home: string, displays: Bounds[]): Bounds | undefined {
  let b: Partial<Bounds>;
  try {
    b = JSON.parse(readFileSync(file(home), 'utf8')) as Partial<Bounds>;
  } catch {
    return undefined;
  }
  if (!isNum(b.x) || !isNum(b.y) || !isNum(b.width) || !isNum(b.height)) return undefined;
  const { x, y } = b;
  const onScreen = displays.some((d) => x >= d.x && y >= d.y && x < d.x + d.width && y < d.y + d.height);
  return onScreen ? { x, y, width: Math.max(MIN_WIDTH, b.width), height: Math.max(MIN_HEIGHT, b.height) } : undefined;
}

export function saveBounds(home: string, b: Bounds): void {
  mkdirSync(home, { recursive: true });
  const { x, y, width, height } = b;
  writeFileSync(`${file(home)}.tmp`, JSON.stringify({ x, y, width, height }) + '\n');
  renameSync(`${file(home)}.tmp`, file(home));
}
