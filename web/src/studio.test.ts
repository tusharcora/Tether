import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Files are read from disk: vitest blanks CSS imports (?raw included), and Vite rewrites a literal
// `new URL('./x', import.meta.url)` into a served asset URL, so the base goes through a variable.
const here = import.meta.url;
const file = (p: string) => new URL(p, here);
const css = readFileSync(file('./studio.css'), 'utf8');

const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('Studio Live tokens', () => {
  it('defines the dark palette under the dark theme and the light one by default', () => {
    const dark = block(':root[data-theme="dark"] .studio');
    for (const t of ['--bg: #0a0a0b', '--s1: #111113', '--s2: #18181b', '--s3: #26262b', '--ink: #f4f4f5', '--mut: #a1a1aa', '--acc: #2563eb', '--accInk: #93c5fd', '--ok: #34d399', '--warn: #fbbf24', '--bad: #f87171']) expect(dark).toContain(t);
    const light = block('.studio');
    for (const t of ['--bg: #fbfbfa', '--s1: #ffffff', '--ink: #09090b', '--mut: #52525b', '--accInk: #1d4ed8', '--accBg: #eff6ff', '--ok: #047857', '--warn: #a16207', '--bad: #b91c1c']) expect(light).toContain(t);
  });

  it('makes primary actions ink and keeps purple, gradients and glows out', () => {
    expect(css).toContain('--foreground: var(--ink)');
    expect(css).toContain('--background: var(--bg)');
    expect(css).not.toMatch(/purple|violet|#7747ff|#a78bff|#9333ea/i);
    expect(css).not.toMatch(/(linear|radial|conic)-gradient\(/);
    expect(css).not.toMatch(/box-shadow:\s*0 0 \d+px/);
  });

  it('uses the motion curve and turns motion off for reduced motion', () => {
    expect(css).toContain('cubic-bezier(.2, .8, .2, 1)');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('self-hosts Geist and Geist Mono', () => {
    expect(css).toContain("url('./assets/fonts/Geist-Variable.woff2')");
    expect(css).toContain("url('./assets/fonts/GeistMono-Variable.woff2')");
    expect(css).not.toContain('fonts.googleapis');
    expect(existsSync(file('./assets/fonts/Geist-Variable.woff2'))).toBe(true);
    expect(existsSync(file('./assets/fonts/GeistMono-Variable.woff2'))).toBe(true);
  });
});
