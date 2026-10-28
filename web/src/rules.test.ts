import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Files are read from disk (vitest blanks CSS imports); the base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;
const root = fileURLToPath(new URL('./', here));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
/** Product sources: CSS, TS and TSX, without tests (they hold violet literals to assert their absence) or the test helpers. */
const sources = walk(root)
  .filter((p) => /\.(css|tsx?)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith(join(root, 'test')))
  .map((p) => ({ path: relative(root, p), text: readFileSync(p, 'utf8') }));
const css = sources.filter((s) => s.path.endsWith('.css'));

/**
 * Bot-face colour sources keep their hues (faces are identity art, exempt from the no-purple rule). Nothing else is allowed.
 * Face.tsx holds no colour literals (it draws from a bot's look), so it needs no entry; the server's built-in looks
 * (src/crew.ts) sit outside web/src, and crewStore.ts is their dashboard mirror.
 */
const FACE_ALLOW = [
  { path: 'Crew.tsx', value: '#b58bff' }, // face editor swatch
  { path: 'crewStore.ts', value: '#9b7bff' }, // built-in look: Tether
];

type RGB = [number, number, number];
/** HSL hue (degrees) and chroma (0–1) of an sRGB colour with channels in 0–1. */
function hueOf([r, g, b]: RGB): { h: number; chroma: number } {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return { h: 0, chroma: 0 };
  let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue *= 60;
  return { h: hue < 0 ? hue + 360 : hue, chroma: d };
}
const hexRgb = (hex: string): RGB => {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
};
/** OKLCH to gamma-encoded sRGB (clamped), so every notation is judged on the same HSL hue scale. */
const oklchRgb = (l: number, c: number, hDeg: number): RGB => {
  const a = c * Math.cos((hDeg * Math.PI) / 180), b = c * Math.sin((hDeg * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
  const enc = (x: number) => { const v = Math.min(1, Math.max(0, x)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
  return lin.map(enc) as RGB;
};
const num = (s: string, pctScale = 1) => (s.endsWith('%') ? (Number(s.slice(0, -1)) / 100) * pctScale : Number(s));

/** Violet, purple and indigo: HSL hue 235–320° (Arc's own violet sits at ~255°, Tailwind violet at 258°, indigo at ~239°). */
const VIOLET = (h: number) => h >= 235 && h <= 320;
function violetHits(text: string): string[] {
  const hits: string[] = [];
  const judge = (lit: string, rgb: RGB, minChroma = 0.1) => {
    const { h, chroma } = hueOf(rgb);
    if (chroma > minChroma && VIOLET(h)) hits.push(lit);
  };
  for (const m of text.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) judge(m[0], hexRgb(m[0]));
  for (const m of text.matchAll(/rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/g)) judge(m[0], [m[1]!, m[2]!, m[3]!].map((v) => num(v, 255) / 255) as RGB);
  for (const m of text.matchAll(/oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?/g)) {
    const c = num(m[2]!, 0.4);
    if (c > 0.02) judge(m[0], oklchRgb(num(m[1]!), c, Number(m[3])), 0);
  }
  for (const m of text.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%/g)) if (Number(m[2]) > 5 && VIOLET(Number(m[1]))) hits.push(m[0]);
  return hits;
}

describe('no purple', () => {
  it('the scan recognises violet in every notation and leaves the Studio blues alone', () => {
    for (const v of ['#7747ff', '#8b5cf6', '#6366f1', '#7747ffcc', '#a7f', 'rgb(119 71 255 / .13)', 'rgba(139, 92, 246, 0.5)', 'oklch(90% .045 300)', 'oklch(48% .15 285)', 'hsl(258 90% 66%)'])
      expect(violetHits(v), v).toHaveLength(1);
    for (const v of ['#2563eb', '#1d4ed8', '#93c5fd', '#3b82f6', 'rgba(59, 130, 246, .15)', 'oklch(46% .13 230)', 'rgba(9, 9, 11, .08)', '#86868f', 'oklch(90% 0 0)'])
      expect(violetHits(v), v).toEqual([]);
  });
  it('finds no violet colours outside the face sources', () => {
    const found = sources.flatMap((s) => violetHits(s.text).filter((v) => !FACE_ALLOW.some((a) => a.path === s.path && a.value.toLowerCase() === v.toLowerCase())).map((v) => `${s.path}: ${v}`));
    expect(found).toEqual([]);
  });
  it('keeps every face allow-list entry live (no stale exemptions)', () => {
    for (const a of FACE_ALLOW) expect(violetHits(read(a.path)).map((v) => v.toLowerCase()), a.path).toContain(a.value);
  });
  it('names no purple accent in stylesheets', () => {
    expect(css.filter((s) => /\b(purple|violet|indigo)\b/i.test(s.text)).map((s) => s.path)).toEqual([]);
  });
});

describe('no gradient decoration and no glow', () => {
  const ARC_FADES = ['tabs.module.css', 'segmented-control.module.css', 'timeline.module.css', 'json-viewer.module.css', 'sortable-data-table.module.css'];
  it('paints no gradient as a background outside Arc’s functional fades', () => {
    const bad = css.filter((s) => !ARC_FADES.some((f) => s.path.endsWith(f))).filter((s) => /background[\w-]*\s*:[^;{}]*-gradient\(/.test(s.text)).map((s) => s.path);
    expect(bad).toEqual([]);
  });
  it('never defines an --arc-gradient token as a gradient', () => {
    expect(css.filter((s) => /--arc-gradient[\w-]*\s*:[^;]*gradient\(/.test(s.text)).map((s) => s.path)).toEqual([]);
  });
  it('draws no glow (a zero-offset blurred shadow)', () => {
    expect(css.filter((s) => /box-shadow:\s*0 0 [1-9]\d*px/.test(s.text)).map((s) => s.path)).toEqual([]);
  });
});

describe('beui, bencho and aicss components keep the rules', () => {
  const VENDORED = ['components/beui/', 'components/bencho/', 'components/aicss/', 'components/faces/'];
  const vendored = sources.filter((s) => VENDORED.some((d) => s.path.startsWith(d)));
  /** Tether's own files in those folders (no MIT header: nothing was copied). */
  const OWN = ['components/beui/lib/highlight.ts'];
  /** Tether's own wrappers over the copied components (kit/): they carry no MIT header but obey every other rule here. */
  const isOwn = (path: string) => OWN.includes(path) || path.startsWith('components/beui/kit/');
  it('paints no gradient: no Tailwind gradient utilities and no gradient values', () => {
    const bad = vendored.filter((s) => /\bbg-(gradient|linear|radial|conic)-|\b(from|via|to)-(violet|purple|indigo|fuchsia)|-gradient\(/.test(s.text)).map((s) => s.path);
    expect(bad).toEqual([]);
  });
  it('draws no glow: no zero-offset blurred shadow utilities or values, no drop-shadow glow', () => {
    const bad = vendored.filter((s) => /shadow-\[0_0_[1-9]|box-shadow:\s*0 0 [1-9]|boxShadow:\s*['"]0 0 [1-9]|\bglow\b/i.test(s.text)).map((s) => s.path);
    expect(bad).toEqual([]);
  });
  it('names no purple accent and ships no metallic or magnetic button', () => {
    expect(vendored.filter((s) => /\b(violet|purple|indigo|fuchsia)\b|--color-violet|--neon/i.test(s.text)).map((s) => s.path)).toEqual([]);
    expect(vendored.filter((s) => /\b(Metallic|Magnetic)(Button)?\b/.test(s.text)).map((s) => s.path)).toEqual([]);
  });
  it('switches dark mode through our variant only (no .dark class selectors)', () => {
    expect(vendored.filter((s) => /\.dark\b|classList\.(add|contains)\(['"]dark/.test(s.text)).map((s) => s.path)).toEqual([]);
  });
  it('gives no global class the name of a bare Tailwind utility (unlayered utilities would restyle it)', () => {
    const BARE = 'hidden|block|inline|inline-block|inline-flex|inline-grid|flex|grid|table|contents|flow-root|list-item|ring|outline|border|shadow|rounded|container|collapse|visible|invisible|static|fixed|absolute|relative|sticky|italic|underline|overline|line-through|truncate|uppercase|lowercase|capitalize|grow|shrink|transition|transform|filter|blur|resize|isolate|sr-only|antialiased|ordinal|invert|grayscale|sepia|ease-in|ease-out|ease-linear|ease-in-out';
    const re = new RegExp(`\\.(${BARE})(?![\\w-])`, 'g');
    const bad = css.filter((s) => !s.path.endsWith('.module.css')).flatMap((s) => [...s.text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)].map((m) => `${s.path}: ${m[0]}`));
    expect(bad).toEqual([]);
  });
  it('keeps the MIT notice in every copied file', () => {
    const NOTICE = { 'components/beui/': 'Copyright (c) 2026 Saurabh Chauhan', 'components/bencho/': 'Copyright (c) 2026 Lorenzo Cabra', 'components/faces/': 'Copyright (c) 2026 Lorenzo Cabra', 'components/aicss/': 'Copyright (c) 2026 AICSS' };
    const missing = vendored
      .filter((s) => !isOwn(s.path))
      .filter((s) => !s.text.includes('MIT License') || !s.text.includes(Object.entries(NOTICE).find(([d]) => s.path.startsWith(d))![1]))
      .map((s) => s.path);
    expect(missing).toEqual([]);
    for (const d of Object.keys(NOTICE)) if (vendored.some((s) => s.path.startsWith(d))) expect(read(`${d}LICENSE`)).toContain('Permission is hereby granted');
  });
});

// ---------- contrast ----------
type RGBA = [number, number, number, number];
const tokenBlock = (selector: string): Record<string, string> => {
  const text = read('studio.css');
  const start = text.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = text.slice(start + selector.length + 2, text.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
};
const parse = (v: string): RGBA => {
  if (v.startsWith('#')) {
    const h = v.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const n = /rgba?\(([^)]+)\)/.exec(v)![1]!.split(',').map((x) => Number(x.trim()));
  return [n[0]!, n[1]!, n[2]!, n[3] ?? 1];
};
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe.each([
  ['light', ':root:root'],
  ['dark', ':root:root[data-theme="dark"]'],
])('contrast in %s', (_name, selector) => {
  const T = tokenBlock(selector);
  const c = (k: string) => parse(T[k]!);
  const bg = c('--bg');
  const solid = (k: string) => over(c(k), bg);
  it('text: ink and muted on every surface', () => {
    for (const fg of ['--ink', '--mut']) for (const s of ['--bg', '--s1', '--s2', '--s3', '--side', '--side-hover', '--side-card']) expect(ratio(c(fg), solid(s)), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it('text: status colours on the page, on panels and on their own tint', () => {
    const pairs: [string, string][] = [['--accInk', '--accBg'], ['--ok', '--okBg'], ['--warn', '--warnBg'], ['--bad', '--badBg']];
    for (const [fg, tint] of pairs) {
      expect(ratio(c(fg), bg), `${fg} on --bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c(fg), solid('--s1')), `${fg} on --s1`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c(fg), solid(tint)), `${fg} on ${tint}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('white text on the accent fill', () => {
    expect(ratio([255, 255, 255, 1], c('--acc'))).toBeGreaterThanOrEqual(4.5);
  });
  it('UI: the accent and the meaningful edge against the page and panels', () => {
    for (const fg of ['--acc', '--edge']) for (const s of ['--bg', '--s1']) expect(ratio(c(fg), solid(s)), `${fg} on ${s}`).toBeGreaterThanOrEqual(3);
    // --line2 is a decorative hairline (about 1.4:1 with the exact token values): see the plan's Interpretations.
  });
});

describe('the CodeMirror theme', () => {
  it('takes every colour from a Studio token', () => {
    const theme = read('code/cmTheme.ts');
    expect(theme.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g) ?? []).toEqual([]);
    for (const token of ['--ink', '--ok', '--warn', '--mut', '--s3']) expect(theme).toContain(`var(${token})`);
    expect(theme).not.toMatch(/var\(--acc/);
  });
});

describe('parity pass on styles.css', () => {
  const styles = read('styles.css');
  const rule = (sel: string) => {
    const i = styles.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return styles.slice(i, styles.indexOf('}', i));
  };
  it('keeps no hard-coded colours', () => {
    expect(styles.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
  it('paints hand-built primary buttons ink', () => {
    expect(rule('button.primary')).toContain('background: var(--ink)');
    expect(rule('button.primary')).toContain('color: var(--bg)');
  });
  it('gives hand-built buttons a neutral hover border', () => {
    expect(rule(':where(button:hover:not(:disabled))')).toMatch(/border-color: var\(--(line2|edge)\)/);
  });
  it('never paints text in the fill-only accent', () => {
    expect(styles).not.toMatch(/(^|[;{\s])color:\s*var\(--accent\)/m);
  });
  it('draws the canvas dot grid with a mask moved by CSS variables, not a gradient fill', () => {
    // The canvas rules moved to canvas.css (Plan B Task 1).
    const canvas = read('canvas.css');
    const i = canvas.indexOf('.canvas {');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(canvas.slice(i, canvas.indexOf('}', i))).not.toMatch(/gradient/);
    expect(canvas).toMatch(/\.canvas::before \{[^}]*mask-position: var\(--grid-x, 0\) var\(--grid-y, 0\)/);
  });
});
