import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contrast } from '../src/color.js';
import { DONE_MS, FAIL_MS, SLEEP_MS, face, faceMoodFor, type FaceMood } from '../src/face.js';
import { Tui } from '../src/tui.js';
import { THEMES, caps, pal, setTheme, strip, vlen, type RGB } from '../src/ui.js';
import { setup, tmp } from './helpers.js';

const keep = caps.level;
beforeEach(() => void (caps.level = 3));
afterEach(() => {
  caps.level = keep;
  setTheme('aurora');
});

const BAND: Record<FaceMood, [string, string]> = {
  idle: ['  ●  ●  ', ' '],
  working: ['  ◉  ◉  ', '⠋'],
  waiting: ['  ◔  ◔  ', '?'],
  done: ['  ^  ^  ', '✓'],
  failed: ['  ╥  ╥  ', '!'],
  asleep: ['  –  –  ', 'z'],
};

describe('face band', () => {
  it.each(Object.keys(BAND) as FaceMood[])('draws the %s face: band, eyes and glyph', (mood) => {
    const f = face(mood, 0, 100);
    const [eyes, glyph] = BAND[mood];
    expect(strip(f.text)).toBe(`▐${eyes}▌ ${glyph}`);
    expect(vlen(f.text)).toBe(f.width);
    expect(f.width).toBe(12);
  });

  const sgr = (t: string) => {
    const m = /48;2;(\d+);(\d+);(\d+)m\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(t)!;
    return { band: [+m[1]!, +m[2]!, +m[3]!] as RGB, ink: [+m[4]!, +m[5]!, +m[6]!] as RGB };
  };

  it('is a filled band: mood colour behind the eyes, a different ink for the eyes, edges in the band colour', () => {
    const want: Record<FaceMood, RGB> = { idle: [34, 211, 238], working: [34, 211, 238], waiting: [251, 191, 36], done: [74, 222, 128], failed: [248, 113, 113], asleep: [120, 130, 150] };
    for (const mood of Object.keys(want) as FaceMood[]) {
      const t = face(mood, 0, 100).text;
      const { band, ink } = sgr(t);
      expect(band).toEqual(want[mood]);
      expect(ink).not.toEqual(band);
      expect(t.startsWith(`\x1b[38;2;${band.join(';')}m▐`)).toBe(true);
      expect(t).toContain(`\x1b[38;2;${band.join(';')}m▌`);
    }
  });

  it('follows the theme and keeps the eyes readable on every theme, light bands included', () => {
    setTheme('sunset');
    expect(sgr(face('idle', 0, 100).text).band).toEqual([251, 146, 60]);
    for (const name of Object.keys(THEMES)) {
      setTheme(name);
      for (const mood of ['idle', 'waiting', 'done', 'failed', 'asleep'] as FaceMood[]) {
        const { band, ink } = sgr(face(mood, 0, 100).text);
        expect(contrast(band, ink), `${name}/${mood}`).toBeGreaterThanOrEqual(3);
      }
    }
    setTheme('mono'); // near-white accent: dark eyes
    const mono = sgr(face('idle', 0, 100).text);
    expect(mono.ink.every((v, k) => v < mono.band[k]! - 100)).toBe(true);
    const keepCyan = [...pal.cyan] as RGB;
    pal.cyan = [250, 245, 200]; // a light theme with a pale accent
    const pale = sgr(face('idle', 0, 100).text);
    expect(contrast(pale.band, pale.ink)).toBeGreaterThanOrEqual(7);
    pal.cyan = [20, 40, 90]; // and a dark accent on a light terminal: light eyes
    const deep = sgr(face('idle', 0, 100).text);
    expect(contrast(deep.band, deep.ink)).toBeGreaterThanOrEqual(7);
    expect(deep.ink[0]).toBeGreaterThan(150);
    pal.cyan = keepCyan;
  });

  it('blinks for one frame every few seconds, only when idle', () => {
    const frames = Array.from({ length: 120 }, (_, t) => strip(face('idle', t, 100).text));
    expect(frames.filter((f) => f.includes('─'))).toHaveLength(3);
    expect(frames[39]).toBe('▐  ─  ─  ▌  ');
    for (let t = 0; t < 80; t++) expect(strip(face('working', t, 100).text)).not.toContain('─');
  });

  it('does not blink when animation is off', () => {
    for (let t = 0; t < 120; t++) expect(strip(face('idle', t, 100, false).text)).toBe('▐  ●  ●  ▌  ');
  });

  it('spins a braille glyph while working', () => {
    const glyphs = new Set(Array.from({ length: 10 }, (_, t) => strip(face('working', t, 100).text).slice(-1)));
    expect(glyphs.size).toBe(10);
  });

  it('shrinks to ▐●●▌ under 40 columns', () => {
    const f = face('idle', 0, 39);
    expect(strip(f.text)).toBe('▐●●▌  ');
    expect(vlen(f.text)).toBe(f.width);
    expect(strip(face('failed', 0, 30).text)).toBe('▐╥╥▌ !');
    expect(strip(face('idle', 0, 40).text)).toBe('▐  ●  ●  ▌  ');
  });

  it('has no colour escapes without colour', () => {
    caps.level = 0;
    expect(face('idle', 0, 100).text).toBe('▐  ●  ●  ▌  ');
  });
});

describe('face mood', () => {
  const base = { waiting: false, working: false, live: false, now: 10_000_000, failedAt: 0, doneUntil: 0, lastInput: 10_000_000 };
  it('is derived from global state with a fixed priority', () => {
    expect(faceMoodFor(base)).toBe('idle');
    expect(faceMoodFor({ ...base, working: true, live: true })).toBe('working');
    expect(faceMoodFor({ ...base, waiting: true, working: true, live: true })).toBe('waiting');
    expect(faceMoodFor({ ...base, doneUntil: base.now + DONE_MS })).toBe('done');
    expect(faceMoodFor({ ...base, doneUntil: base.now - 1 })).toBe('idle');
    expect(faceMoodFor({ ...base, failedAt: base.now - 1000 })).toBe('failed');
    expect(faceMoodFor({ ...base, failedAt: base.now - 1000, doneUntil: base.now + 5000 })).toBe('failed');
    expect(faceMoodFor({ ...base, failedAt: base.now - FAIL_MS - 1, lastInput: base.now - FAIL_MS - 1 })).toBe('idle');
    expect(faceMoodFor({ ...base, lastInput: base.now - SLEEP_MS })).toBe('asleep');
    expect(faceMoodFor({ ...base, lastInput: base.now - SLEEP_MS + 1 })).toBe('idle');
    expect(faceMoodFor({ ...base, lastInput: base.now - SLEEP_MS, live: true })).toBe('idle');
  });
});

type Row = { id: string; status: string; pipeline: string; costUsd: number; startedAt: number; task: string };
interface Probe {
  header(): string[];
  draw(): void;
  key(k: string): void;
  trackRuns(): void;
  runs: () => Row[];
  mine: Map<string, string>;
  lastInput: number;
  failedAt: number;
  tick: number;
  prefs: { animate?: boolean };
  stack: unknown[];
  busyIds: Set<string>;
  hits: { y: number; x0: number; x1: number; act: () => void }[];
  bodyY: number;
  screen: { tab: string };
  stripHits(rel: number, count: number, sel: number, pick: (i: number) => void): void;
}
const row = (id: string, status: string): Row => ({ id, status, pipeline: 'p', costUsd: 0, startedAt: Date.now(), task: 'task' });
function make(cols = 100) {
  const { home, engine, store } = setup();
  const out = { write: () => true, columns: cols, rows: 40 } as unknown as NodeJS.WriteStream;
  const ui = new Tui({ cfg: { home, vault: tmp('v-'), adapters: {}, endpoints: {} } as never, store, engine }, out) as unknown as Probe;
  let rows: Row[] = [];
  ui.runs = () => rows;
  return { ui, set: (r: Row[]) => (rows = r) };
}
const faceOf = (ui: Probe) => strip(ui.header()[0]!).slice(0, 12);

describe('header', () => {
  const header = (cols: number) => {
    const { ui } = make(cols);
    return { ui, lines: ui.header() };
  };

  it('is face + title, tabs, status, rule: 4 rows, each within the terminal width', () => {
    const { ui, lines } = header(100);
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(vlen(l)).toBeLessThanOrEqual(100);
    const p = lines.map(strip);
    expect(p[0]!.startsWith('▐  ●  ●  ▌  Tether')).toBe(true);
    expect(p[1]!.startsWith(' '.repeat(12) + '1 chat   2 runs')).toBe(true);
    expect(p[2]!.startsWith(' '.repeat(12))).toBe(true);
    expect(p[2]!.trim().length).toBeGreaterThan(5);
    expect(p[3]).toMatch(/^─+$/);
    expect(vlen(lines[3]!)).toBe(98); // rule() is two cells short of the width
    const first = ui.hits.filter((h) => h.y === 1).sort((a, b) => a.x0 - b.x0)[0]!;
    expect(first.x0).toBe(12);
    expect(first.x1).toBe(12 + '1 chat'.length - 1);
  });

  it('draws no crew sprite glyphs', () => {
    const { lines } = header(100);
    expect(strip(lines.join('\n'))).not.toMatch(/[▀▄█]|\(•|•\)/);
  });

  it.each([36, 39, 40, 41, 60, 69, 70, 75, 76, 100, 160])('fits at %i columns with the face first and tab targets inside the line', (cols) => {
    const { ui, lines } = header(cols);
    const p = lines.map(strip);
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(vlen(l)).toBeLessThanOrEqual(cols);
    const fw = cols < 40 ? 6 : 12;
    expect(p[0]!.startsWith(cols < 40 ? '▐●●▌' : '▐  ●  ●  ▌')).toBe(true);
    expect(p[1]!.startsWith(' '.repeat(fw))).toBe(true);
    const hits = ui.hits.filter((h) => h.y === 1).sort((a, b) => a.x0 - b.x0);
    expect(hits).toHaveLength(6);
    expect(hits[0]!.x0).toBe(fw);
    // each target sits exactly over its label in the rendered tab line
    const labels = cols < 76 ? ['1', '2', '3', '4', '5', '6'] : ['1 chat', '2 runs', '3 workflows', '4 crew', '5 triggers', '6 settings'];
    hits.forEach((h, k) => {
      expect(p[1]!.slice(h.x0, h.x1 + 1)).toBe(labels[k]);
      expect(h.x1).toBeLessThan(cols);
    });
  });

  it('under 70 columns shows a one-sentence status; the clock goes under 40', () => {
    const { lines } = header(60);
    expect(lines.map(strip)[2]!.trim()).toBe('All quiet.');
    expect(strip(header(100).lines[0]!)).toMatch(/\d\d:\d\d:\d\d$/);
    expect(strip(header(39).lines[0]!)).not.toMatch(/\d\d:\d\d:\d\d/);
  });

  it('hit targets at 36 columns start after the 6-cell compact face', () => {
    const { ui } = header(36);
    expect(ui.hits.filter((h) => h.y === 1).map((h) => h.x0).sort((a, b) => a - b)).toEqual([6, 10, 14, 18, 22, 26]);
  });

  it('long breadcrumbs are clipped, never wrap the header', () => {
    for (const cols of [36, 60, 100]) {
      const { ui } = make(cols);
      ui.stack.push({ kind: 'editor', pipeline: { name: 'x'.repeat(200) }, dirty: true, sel: 0 }, { kind: 'run', runId: 'r'.repeat(40), sel: 0 });
      const ls = ui.header();
      expect(ls).toHaveLength(4);
      for (const l of ls) expect(vlen(l)).toBeLessThanOrEqual(cols);
      expect(strip(ls[0]!).startsWith(cols < 40 ? '▐●●▌' : '▐  ●  ●  ▌')).toBe(true);
    }
  });

  it('scans the run store once per render', () => {
    const { ui, set } = make();
    let n = 0;
    set([row('a', 'running')]);
    const inner = ui.runs;
    ui.runs = () => (n++, inner());
    ui.header();
    expect(n).toBe(1);
  });

  it('does not blink with animation off', () => {
    const { ui } = make();
    ui.prefs = { animate: false };
    ui.tick = 39;
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
    ui.prefs = {};
    expect(faceOf(ui)).toBe('▐  ─  ─  ▌  ');
  });
});

describe('header face mood (global, from run state)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('a run you started: working, then done for ten seconds, then idle', () => {
    const { ui, set } = make();
    ui.mine.set('r1', 'running');
    set([row('r1', 'running')]);
    ui.trackRuns();
    expect(faceOf(ui)).toBe('▐  ◉  ◉  ▌ ⠋');
    set([row('r1', 'done')]);
    ui.trackRuns();
    expect(faceOf(ui)).toBe('▐  ^  ^  ▌ ✓');
    vi.advanceTimersByTime(DONE_MS - 1);
    expect(faceOf(ui)).toBe('▐  ^  ^  ▌ ✓');
    vi.advanceTimersByTime(2);
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
  });

  it('a run started elsewhere finishing does not trigger done', () => {
    const { ui, set } = make();
    set([row('x', 'running')]);
    ui.trackRuns();
    set([row('x', 'done')]);
    ui.trackRuns();
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
  });

  it('failed: shows after an own run errors, clears after ten idle seconds or on the next start', () => {
    const { ui, set } = make();
    ui.mine.set('r1', 'running');
    set([row('r1', 'running')]);
    ui.trackRuns();
    set([row('r1', 'error')]);
    ui.trackRuns();
    expect(faceOf(ui)).toBe('▐  ╥  ╥  ▌ !');
    ui.lastInput = Date.now();
    vi.advanceTimersByTime(FAIL_MS - 1);
    expect(faceOf(ui)).toBe('▐  ╥  ╥  ▌ !');
    vi.advanceTimersByTime(2);
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
    // next start clears it at once
    ui.failedAt = Date.now();
    expect(faceOf(ui)).toBe('▐  ╥  ╥  ▌ !');
    ui.failedAt = 0;
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
  });

  it('waiting: any run awaiting approval, whatever the screen; working: any live run or Maestro replying', () => {
    const { ui, set } = make();
    set([row('a', 'paused'), row('b', 'running')]);
    expect(faceOf(ui)).toBe('▐  ◔  ◔  ▌ ?');
    set([row('b', 'running')]);
    expect(faceOf(ui)).toMatch(/^▐  ◉  ◉  ▌ [⠋-⠿]$/);
    set([]);
    ui.busyIds.add('main');
    expect(faceOf(ui)).toMatch(/^▐  ◉  ◉  ▌ /);
  });

  it('falls asleep after ten idle minutes with nothing live; any key wakes it', () => {
    const { ui, set } = make();
    ui.lastInput = Date.now() - SLEEP_MS;
    expect(faceOf(ui)).toBe('▐  –  –  ▌ z');
    expect(strip(ui.header()[2]!)).toContain('Asleep');
    set([row('a', 'running')]);
    expect(faceOf(ui)).toMatch(/◉/);
    set([]);
    ui.key('down');
    ui.lastInput = Date.now();
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
  });

  it('does not depend on the screen (editor, bot editor, session, plan)', () => {
    const { ui, set } = make();
    const screens: unknown[] = [
      { kind: 'editor', pipeline: { name: 'wf', nodes: [] }, dirty: false, sel: 0 },
      { kind: 'botedit', bot: { name: 'Bolt' }, dirty: false, sel: 0 },
      { kind: 'session', runId: 'zz', nodeId: 'n', pane: 'output' },
      { kind: 'plan', task: 't', repo: '/r' },
      { kind: 'plan', task: 't', repo: '/r', error: 'boom' },
    ];
    for (const runs of [[], [row('a', 'running')], [row('a', 'paused')], [row('a', 'error')]]) {
      set(runs);
      const dash = faceOf(ui);
      for (const sc of screens) {
        ui.stack.push(sc);
        expect(faceOf(ui), `${(sc as { kind: string }).kind} with ${runs[0]?.status ?? 'no runs'}`).toBe(dash);
        ui.stack.pop();
      }
    }
    set([]);
    expect(faceOf(ui)).toBe('▐  ●  ●  ▌  ');
  });
});

describe('click targets line up with what is drawn', () => {
  it('strip hits cover the 4 rows of each cell, 13 columns wide', () => {
    const { ui } = make();
    ui.bodyY = 4;
    const picked: number[] = [];
    ui.stripHits(2, 3, 0, (i) => picked.push(i));
    const ys = [...new Set(ui.hits.map((h) => h.y))].sort((a, b) => a - b);
    expect(ys).toEqual([6, 7, 8, 9]);
    const second = ui.hits.filter((h) => h.x0 === 14);
    expect(second).toHaveLength(4);
    expect(second[0]!.x1).toBe(26);
    second[0]!.act();
    expect(picked).toEqual([1]);
  });

  it('runs and crew list rows are clickable on the rows they are drawn on', () => {
    const { ui, set } = make();
    set([row('run-aaaaaaaa', 'done'), row('run-bbbbbbbb', 'error')]);
    ui.screen.tab = 'runs';
    ui.draw();
    const body = ui.bodyY;
    expect(body).toBe(4);
    expect(ui.hits.filter((h) => h.y === body || h.y === body + 1).length).toBeGreaterThanOrEqual(2);
    ui.screen.tab = 'crew';
    ui.draw();
    expect(ui.hits.some((h) => h.y === body + 1 && h.x0 === 0)).toBe(true); // first crew row, under the blank line
    expect(ui.hits.some((h) => h.y === body + 2 && h.x0 === 0)).toBe(true);
  });
});
