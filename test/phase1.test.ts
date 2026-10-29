import { describe, expect, it } from 'vitest';
import { clean, parseLine, recent, redact, toolChunk } from '../src/activity.js';
import { jumpPoints, parseDiff, renderSplit, renderUnified } from '../src/diffview.js';
import { Pulse, costSeries, stepDurations } from '../src/metrics.js';
import { spark, strip, vlen } from '../src/ui.js';
import type { RunState, StoredEvent } from '../src/types.js';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ function head
 import x from 'x';
-const a = 1;
+const a = 2; // changed
+const b = "s";
 export {};
@@ -20,2 +21,2 @@
 keep
-old
+new
diff --git a/b.py b/b.py
new file mode 100644
--- /dev/null
+++ b/b.py
@@ -0,0 +1,2 @@
+def f():
+    return None
`;

describe('activity', () => {
  it('builds tool chunks with the target and parses them back', () => {
    expect(toolChunk('Edit', { file_path: 'src/limiter.ts', old_string: 'x' })).toBe('[tool] Edit src/limiter.ts\n');
    expect(parseLine('[tool] Edit src/limiter.ts')).toEqual({ verb: 'edit', text: 'src/limiter.ts' });
    expect(parseLine('[tool] Bash npm test')).toEqual({ verb: 'run', text: 'npm test' });
    expect(parseLine('[tool] Mystery thing')).toEqual({ verb: 'tool', text: 'Mystery thing' });
    expect(parseLine('   ')).toBeUndefined();
  });
  it('redacts credentials and strips control characters', () => {
    expect(redact('curl -H "Authorization: Bearer abcdefghijklmnop123" x')).not.toContain('abcdefghijklmnop123');
    expect(redact('export TOKEN=hunter2hunter2')).not.toContain('hunter2');
    expect(redact('key sk-abcdefghijklmnopqrstuv')).toContain('***');
    expect(redact('NVIDIA_API_KEY nvapi-AbCdEfGhIjKlMnOpQrSt_uv-0123')).toBe('NVIDIA_API_KEY ***');
    expect(toolChunk('Bash', { command: 'echo ghp_abcdefghijklmnopqrstuvwxyz0123' })).not.toContain('ghp_abcdef');
    expect(clean('a\x1b[31mred\x1b[0m\x07 b')).toBe('ared b');
    expect(clean('\x1b]0;evil\x07ok')).not.toContain('\x1b');
  });
  it('returns the last few activities, oldest first', () => {
    const live = '[tool] Read a.ts\n[tool] Edit b.ts\nthinking out loud\n\n';
    expect(recent(live, 2).map((a) => a.verb)).toEqual(['edit', 'say']);
    expect(recent(undefined)).toEqual([]);
  });
});

describe('metrics', () => {
  const ev = (event: StoredEvent['event'], seq = 1): StoredEvent => ({ runId: 'r', seq, ts: 1000 + seq, event });
  it('accumulates cost over finished steps', () => {
    const s = costSeries([
      ev({ type: 'node.finished', node: 'a', status: 'done', output: '', durationMs: 1, attempt: 1, costUsd: 0.1 }),
      ev({ type: 'node.finished', node: 'b', status: 'done', output: '', durationMs: 1, attempt: 1 }),
      ev({ type: 'node.finished', node: 'c', status: 'done', output: '', durationMs: 1, attempt: 1, costUsd: 0.25 }),
    ]);
    expect(s[0]).toBe(0);
    expect(s[1]).toBeCloseTo(0.1);
    expect(s[2]).toBeCloseTo(0.35);
    expect(s).toHaveLength(3);
  });
  it('measures running and finished step durations', () => {
    const st = {
      pipeline: { nodes: [{ id: 'a', kind: 'agent', role: 'coder' }, { id: 'b', kind: 'gate', title: 'tests' }, { id: 'c', kind: 'agent' }] },
      nodes: { a: { status: 'done', startedAt: 1000, finishedAt: 4000 }, b: { status: 'running', startedAt: 5000 }, c: { status: 'queued' } },
    } as unknown as RunState;
    const d = stepDurations(st, 9000);
    expect(d.map((x) => [x.id, x.ms, x.running])).toEqual([['a', 3000, false], ['b', 4000, true]]);
  });
  it('tracks streaming rate over a sliding window', () => {
    const p = new Pulse(10_000);
    p.observe('r', { type: 'node.chunk', node: 'a', text: 'x'.repeat(500) }, 1000);
    p.observe('r', { type: 'node.chunk', node: 'a', text: 'x'.repeat(500) }, 5000);
    expect(p.rate('r', 6000)).toBe(100);
    expect(p.rate('r', 20_000)).toBe(0);
    expect(p.rate('other', 6000)).toBe(0);
    expect(p.series('r', 6000, 10).reduce((t, x) => t + x, 0)).toBe(1000);
  });
  it('draws a sparkline of the requested width', () => {
    expect(vlen(spark([1, 2, 3, 5, 8], 5))).toBe(5);
    expect(strip(spark([1, 2, 3, 5, 8], 5))).toBe('▁▂▃▅█');
    expect(vlen(spark([], 10))).toBeGreaterThan(0);
  });
});

describe('diff view', () => {
  const p = parseDiff(DIFF);
  it('parses files, hunks, counts and line numbers', () => {
    expect(p.files.map((f) => [f.path, f.add, f.del])).toEqual([['src/a.ts', 3, 2], ['b.py', 2, 0]]);
    expect(p.hunks).toHaveLength(3);
    expect(p.add).toBe(5);
    expect(p.del).toBe(2);
    const del = p.rows.find((r) => r.k === 'del')!;
    expect(del.o).toBe(2);
    const add = p.rows.filter((r) => r.k === 'add');
    expect(add[0]!.n).toBe(2);
    expect(p.rows.filter((r) => r.k === 'meta').map((r) => r.text)).toContain('new file mode 100644');
  });
  it('renders unified and split without exceeding the width', () => {
    for (const w of [60, 100, 140]) {
      for (const l of renderUnified(p, w)) expect(vlen(l)).toBeLessThanOrEqual(w);
      for (const l of renderSplit(p, w)) expect(vlen(l)).toBeLessThanOrEqual(w);
    }
    const u = renderUnified(p, 100).map(strip).join('\n');
    expect(u).toContain('const a = 2; // changed');
    expect(u).toContain('▎src/a.ts');
  });
  it('pairs changed lines in split view and keeps jump points on real hunk lines', () => {
    const s = renderSplit(p, 120).map(strip);
    const j = jumpPoints(p, true);
    expect(j.hunks).toHaveLength(3);
    for (const i of j.hunks) expect(s[i]).toMatch(/^@@/);
    for (const i of j.files) expect(s[i]).toMatch(/^▎/);
    const u = renderUnified(p, 120).map(strip);
    for (const i of jumpPoints(p, false).hunks) expect(u[i]).toMatch(/@@/);
  });
  it('handles empty and binary diffs', () => {
    expect(parseDiff('').rows).toEqual([]);
    expect(parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n').rows.map((r) => r.k)).toEqual(['file', 'meta']);
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contrast, hslToRgb, nudge, parseHex, rgbToHsl, toHex } from '../src/color.js';
import { deleteTheme, loadPrefs, savePrefs } from '../src/prefs.js';
import { THEMES, registerThemes, sanitizeTheme } from '../src/ui.js';

describe('colour maths', () => {
  it('round-trips hex and HSL', () => {
    expect(parseHex('#22d3ee')).toEqual([34, 211, 238]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
    expect(parseHex('#12')).toBeUndefined();
    expect(parseHex('rgb(1,2,3)')).toBeUndefined();
    expect(toHex([34, 211, 238])).toBe('#22d3ee');
    for (const c of [[34, 211, 238], [250, 20, 90], [120, 130, 150], [0, 0, 0], [255, 255, 255]] as [number, number, number][]) {
      const back = hslToRgb(rgbToHsl(c));
      c.forEach((v, i) => expect(Math.abs(v - back[i]!)).toBeLessThanOrEqual(1));
    }
  });
  it('nudges hue, wraps around, and keeps lightness readable', () => {
    const [h0] = rgbToHsl([34, 211, 238]);
    const [h1] = rgbToHsl(nudge([34, 211, 238], { h: 8 }));
    expect(Math.abs(h1 - h0 - 8)).toBeLessThan(2);
    expect(() => nudge([200, 30, 30], { h: 400 })).not.toThrow();
    const dark = rgbToHsl(nudge([20, 20, 20], { l: -1 }))[2];
    const light = rgbToHsl(nudge([240, 240, 240], { l: 1 }))[2];
    expect(dark).toBeGreaterThanOrEqual(0.11);
    expect(light).toBeLessThanOrEqual(0.93);
  });
  it('computes WCAG contrast', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([100, 100, 100], [100, 100, 100])).toBeCloseTo(1, 5);
  });
});

describe('custom themes and display prefs', () => {
  it('drops malformed colours and unknown keys from a theme read off disk', () => {
    const t = sanitizeTheme({ label: 'x', pal: { cyan: [1, 2, 3], blue: [999, 0, 0], green: 'red', nope: [1, 1, 1], text: [1.5, 2, 3] }, brand: [[1, 2, 3]] })!;
    expect(t.pal).toEqual({ cyan: [1, 2, 3] });
    expect(t.brand.length).toBeGreaterThanOrEqual(2);
    expect(sanitizeTheme(null)).toBeUndefined();
    expect(sanitizeTheme('nope')).toBeUndefined();
  });
  it('registers custom themes but never replaces built-ins or accepts odd names', () => {
    const before = JSON.stringify(THEMES.aurora);
    registerThemes({ aurora: { pal: { cyan: [1, 1, 1] } }, 'Bad Name': { pal: {} }, '../evil': { pal: {} }, mine: { pal: { cyan: [5, 6, 7] } } });
    expect(JSON.stringify(THEMES.aurora)).toBe(before);
    expect(THEMES['Bad Name']).toBeUndefined();
    expect(THEMES['../evil']).toBeUndefined();
    expect(THEMES.mine!.pal.cyan).toEqual([5, 6, 7]);
    delete THEMES.mine;
  });
  it('saves, validates and deletes preferences', () => {
    const home = mkdtempSync(join(tmpdir(), 'aorch-prefs-'));
    expect(loadPrefs(home)).toEqual({});
    savePrefs(home, { theme: 'sunset', metrics: false, diff: 'split', activity: true });
    savePrefs(home, { animate: false, themes: { mine: { pal: { cyan: [1, 2, 3] } } } });
    const p = loadPrefs(home);
    expect(p).toMatchObject({ theme: 'sunset', metrics: false, diff: 'split', activity: true, animate: false });
    expect(Object.keys(p.themes!)).toEqual(['mine']);
    deleteTheme(home, 'mine');
    expect(Object.keys(loadPrefs(home).themes!)).toEqual([]);
    savePrefs(home, { diff: 'bogus' as never });
    expect(loadPrefs(home).diff).toBeUndefined();
  });
});
