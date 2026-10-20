/**
 * Tiny pixel canvas drawn with half-block characters: every terminal cell is two stacked pixels.
 * Works anywhere that can show colour (and degrades to plain blocks without it). Used for the
 * run timeline and cost charts.
 */
import { bgCode, caps, fgCode, type RGB } from './ui.js';
import type { RunState } from './types.js';

export type Px = RGB | null;

export class Canvas {
  readonly px: Px[];
  constructor(readonly w: number, readonly h: number) {
    this.px = new Array<Px>(Math.max(0, w) * Math.max(0, h)).fill(null);
  }
  set(x: number, y: number, c: Px) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): Px {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x]! : null;
  }
  /** Fill [x0,x1) × [y0,y1). */
  rect(x0: number, y0: number, x1: number, y1: number, c: Px) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.px[y * this.w + x] = c;
  }
}

const same = (a: Px, b: Px) => (a === b) || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

/** One string per two pixel rows; each is exactly `canvas.w` cells wide. */
export function toLines(c: Canvas): string[] {
  const out: string[] = [];
  for (let y = 0; y < c.h; y += 2) {
    let line = '';
    let x = 0;
    while (x < c.w) {
      const t = c.get(x, y);
      const b = c.get(x, y + 1);
      let run = 1;
      while (x + run < c.w && same(c.get(x + run, y), t) && same(c.get(x + run, y + 1), b)) run++;
      if (!t && !b) line += ' '.repeat(run);
      else if (!caps.level) line += (t && b ? '█' : t ? '▀' : '▄').repeat(run);
      else if (t && b) line += `${fgCode(t)}${bgCode(b)}${'▀'.repeat(run)}\x1b[0m`;
      else if (t) line += `${fgCode(t)}${'▀'.repeat(run)}\x1b[0m`;
      else line += `${fgCode(b!)}${'▄'.repeat(run)}\x1b[0m`;
      x += run;
    }
    out.push(line);
  }
  return out;
}

const scale = (c: RGB, k: number): RGB => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];

export interface Lane {
  id: string;
  label: string;
  color: RGB;
}

/**
 * Gantt chart of a run: one lane (two pixels tall) per started step, drawn from when it began to when it
 * ended (or now). Failed steps are drawn in `fail`. Returns the canvas and the lanes drawn, top to bottom.
 */
export function timelineChart(st: RunState, now: number, width: number, colorOf: (nodeId: string) => RGB, fail: RGB, maxLanes = 6): { canvas: Canvas; lanes: Lane[] } {
  const started = st.pipeline.nodes.filter((n) => st.nodes[n.id]?.startedAt).slice(-maxLanes);
  const canvas = new Canvas(width, Math.max(2, started.length * 2));
  const t0 = st.startedAt;
  const t1 = Math.max((st.finishedAt ?? now), t0 + 1000);
  const span = t1 - t0;
  const at = (t: number) => Math.max(0, Math.min(width, Math.round(((t - t0) / span) * width)));
  const lanes: Lane[] = [];
  started.forEach((n, i) => {
    const ns = st.nodes[n.id]!;
    const running = ns.status === 'running' || ns.status === 'awaiting';
    const end = running || !ns.finishedAt ? now : ns.finishedAt;
    const x0 = at(ns.startedAt!);
    const x1 = Math.max(x0 + 1, at(end));
    const base = ns.status === 'error' ? fail : colorOf(n.id);
    canvas.rect(x0, i * 2, x1, i * 2 + 2, running ? base : scale(base, 0.8));
    lanes.push({ id: n.id, label: n.title ?? n.role ?? n.kind, color: base });
  });
  return { canvas, lanes };
}

/** Area chart of cumulative cost: `series` resampled to the width, the line bright and the fill dim. */
export function costChart(series: number[], width: number, rows: number, line: RGB, cap?: number, capColor?: RGB): Canvas {
  const h = Math.max(2, rows * 2);
  const c = new Canvas(width, h);
  const peak = Math.max(...series, 1e-9);
  // the budget line only joins the scale when it is within reach; otherwise the curve would flatten against it
  const showCap = !!cap && cap <= peak * 4;
  const top = showCap ? Math.max(cap!, peak) : peak;
  if (showCap && capColor) {
    const y = Math.max(0, Math.min(h - 1, h - 1 - Math.round((cap! / top) * (h - 1))));
    for (let x = 0; x < width; x += 2) c.set(x, y, capColor);
  }
  if (series.length < 2) return c;
  for (let x = 0; x < width; x++) {
    const f = (x / Math.max(1, width - 1)) * (series.length - 1);
    const i = Math.floor(f);
    const v = series[i]! + ((series[Math.min(series.length - 1, i + 1)]! - series[i]!) * (f - i));
    const y = Math.max(0, Math.min(h - 1, h - 1 - Math.round((v / top) * (h - 1))));
    c.set(x, y, line);
    for (let yy = y + 1; yy < h; yy++) if (!c.get(x, yy)) c.set(x, yy, scale(line, 0.35));
  }
  return c;
}
