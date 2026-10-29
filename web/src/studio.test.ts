import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { norm } from './test/css';
import { applyTheme } from './theme';

// Files are read from disk: vitest blanks CSS imports (?raw included), and Vite rewrites a literal
// `new URL('./x', import.meta.url)` into a served asset URL, so the base goes through a variable.
const here = import.meta.url;
const file = (p: string) => new URL(p, here);
const read = (p: string) => readFileSync(file(p), 'utf8');
const studio = read('./studio.css');

const LIGHT: Record<string, string> = {
  '--bg': '#fbfbfa', '--s1': '#ffffff', '--s2': '#f4f4f5', '--s3': '#e4e4e7',
  '--line': 'rgba(9, 9, 11, .08)', '--line2': 'rgba(9, 9, 11, .16)', '--edge': '#86868f',
  '--ink': '#09090b', '--mut': '#52525b',
  '--acc': '#2563eb', '--accInk': '#1d4ed8', '--accBg': '#eff6ff',
  '--ok': '#047857', '--okBg': '#ecfdf5', '--warn': '#a16207', '--warnBg': '#fefce8', '--bad': '#b91c1c', '--badBg': '#fef2f2',
};
const DARK: Record<string, string> = {
  '--bg': '#191919', '--s1': '#262626', '--s2': '#2f2f2f', '--s3': '#383838',
  '--line': 'rgba(255, 255, 255, .07)', '--line2': 'rgba(255, 255, 255, .14)', '--edge': '#747478',
  '--ink': '#f4f4f5', '--mut': '#a1a1aa',
  '--acc': '#2b6cf0', '--accInk': '#93c5fd', '--accBg': 'rgba(59, 130, 246, .15)',
  '--ok': '#34d399', '--okBg': 'rgba(52, 211, 153, .12)', '--warn': '#fbbf24', '--warnBg': 'rgba(251, 191, 36, .12)', '--bad': '#f87171', '--badBg': 'rgba(248, 113, 113, .12)',
};

/** A root custom property with var() chains resolved (jsdom cascades by specificity but leaves var() as written). */
function token(name: string, depth = 0): string {
  const raw = norm(getComputedStyle(document.documentElement).getPropertyValue(name));
  const m = /^var\((--[\w-]+)\)$/.exec(raw);
  return m && depth < 10 ? token(m[1]!, depth + 1) : raw;
}
const setTheme = (t: 'light' | 'dark') => {
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
};

beforeAll(() => {
  // studio.css goes in FIRST: its blocks must win by specificity, not by coming after foundation.css
  for (const css of [studio, read('./studio-arc.css'), read('./components/kept/foundation.css')]) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
});
afterEach(() => {
  setTheme('light');
  delete document.documentElement.dataset.accent;
  document.documentElement.style.colorScheme = '';
});

describe('Studio Live tokens at the root', () => {
  it.each([['light', LIGHT], ['dark', DARK]] as const)('declares the exact %s values', (theme, want) => {
    setTheme(theme);
    for (const [k, v] of Object.entries(want)) expect(token(k), k).toBe(norm(v));
  });

  it.each([['light', LIGHT], ['dark', DARK]] as const)('bridges Arc and aorch names to the Studio values in %s', (theme, T) => {
    setTheme(theme);
    expect(token('--accent')).toBe(norm(T['--acc']!));
    expect(token('--accent-strong')).toBe(norm(T['--accInk']!));
    expect(token('--foreground')).toBe(norm(T['--ink']!));
    expect(token('--control-on')).toBe(norm(T['--ink']!));
    expect(token('--text')).toBe(norm(T['--ink']!));
    expect(token('--background')).toBe(norm(T['--bg']!));
    expect(token('--surface')).toBe(norm(T['--s1']!));
    expect(token('--muted')).toBe(norm(T['--mut']!));
    expect(token('--run')).toBe(norm(T['--acc']!));
    expect(token('--skip')).toBe(norm(T['--line2']!));
    expect(token('--series-2')).toBe(norm(T['--ok']!));
    expect(token('--arc-gradient')).not.toMatch(/gradient\(/);
  });

  it('lets the Studio bridge win in dark once applyTheme clears a stale Arc accent', () => {
    document.documentElement.dataset.accent = 'violet';
    applyTheme('dark');
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(token('--accent')).toBe(norm(DARK['--acc']!));
    expect(token('--accent-strong')).toBe(norm(DARK['--accInk']!));
    expect(token('--control-on')).toBe(norm(DARK['--ink']!));
  });

  it('shares type, motion and radii in both themes', () => {
    for (const t of ['light', 'dark'] as const) {
      setTheme(t);
      expect(token('--font-ui')).toBe(norm("'Geist', ui-sans-serif, system-ui, sans-serif"));
      expect(token('--font-code')).toBe(norm("'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"));
      expect(token('--ease')).toBe(norm('cubic-bezier(.2, .8, .2, 1)'));
      expect([token('--t-fast'), token('--t-med'), token('--t-slow')]).toEqual(['150ms', '200ms', '280ms']);
      expect([token('--radius-control'), token('--radius-panel'), token('--radius-surface')]).toEqual(['8px', '10px', '12px']);
    }
  });

  it('re-points accent-coloured text in Arc parts to the text-safe accent', () => {
    const arc = read('./studio-arc.css');
    expect(arc).toMatch(/\[class\*="value"\]\[data-type="number"\]\s*{\s*color: var\(--accent-strong\)/);
    expect(arc).toMatch(/\[class\*="icon"\]\[data-type="info"\]\s*{\s*color: var\(--accent-strong\)/);
  });

  it('stops every loop and transition for reduced motion at the root, in one place', () => {
    expect(studio).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*:root \*, :root \*::before, :root \*::after/);
    expect(read('./styles.css')).not.toMatch(/prefers-reduced-motion/);
  });

  it('drops the old aliases and the .studio class', () => {
    expect(existsSync(file('./theme.css'))).toBe(false);
    expect(studio).not.toContain('.studio.studio');
    expect(studio).not.toMatch(/\[data-theme="dark"\] \.studio/);
    expect(studio).not.toMatch(/\.studio\b/);
    expect(read('./main.tsx')).not.toContain('theme.css');
    expect(read('./main.tsx')).toContain("import './studio-arc.css'");
  });

  it('self-hosts Geist and Geist Mono', () => {
    expect(studio).toContain("url('./assets/fonts/Geist-Variable.woff2')");
    expect(studio).toContain("url('./assets/fonts/GeistMono-Variable.woff2')");
    expect(studio).not.toContain('fonts.googleapis');
    expect(existsSync(file('./assets/fonts/Geist-Variable.woff2'))).toBe(true);
    expect(existsSync(file('./assets/fonts/GeistMono-Variable.woff2'))).toBe(true);
  });
});
