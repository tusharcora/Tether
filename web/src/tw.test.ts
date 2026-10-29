import { describe, expect, it } from 'vitest';
import { tokenize } from './components/beui/lib/highlight';
import { cssText } from './test/css';

// Tailwind is not run under vitest (CSS imports are blanked), so the mapping is checked in tw.css's text.
const tw = cssText('tw.css');
const at = tw.indexOf('@theme inline {');
const theme = tw.slice(at, tw.indexOf('}', at));
const mapped = Object.fromEntries([...theme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

describe('the Tailwind foundation (spec §2)', () => {
  it('maps beui colour names to Studio tokens', () => {
    const want: Record<string, string> = {
      background: '--bg',
      foreground: '--ink',
      card: '--s1',
      popover: '--s1',
      muted: '--s2',
      secondary: '--s2',
      accent: '--s2',
      'muted-foreground': '--mut',
      border: '--line2',
      'border-strong': '--edge',
      input: '--edge',
      ring: '--edge',
      primary: '--ink',
      'primary-foreground': '--bg',
      destructive: '--bad',
      danger: '--bad',
      success: '--ok',
      warning: '--warn',
      live: '--acc',
    };
    for (const [name, token] of Object.entries(want)) expect(mapped[`--color-${name}`], name).toBe(`var(${token})`);
  });
  it('keeps blue for live state: only --color-live (and its text colour) reach the accent', () => {
    const blue = Object.entries(mapped).filter(([, v]) => /--acc/.test(v)).map(([k]) => k);
    expect(blue.sort()).toEqual(['--color-live', '--color-live-foreground']);
  });
  it('defines no violet or neon colour', () => {
    expect(Object.keys(mapped).filter((k) => /violet|neon|purple|indigo|fuchsia/.test(k))).toEqual([]);
  });
  it('switches dark mode on our data-theme attribute, not a .dark class', () => {
    expect(tw).toContain(`@custom-variant dark (&:where([data-theme='dark'],[data-theme='dark'] *));`);
    expect(tw).not.toMatch(/\.dark\b/);
  });
  it('imports theme and utilities but never preflight, utilities unlayered and scanned only where Tailwind is written', () => {
    expect(tw).toContain(`@import 'tailwindcss/theme.css' layer(theme)`);
    expect(tw).toContain(`@import 'tailwindcss/utilities.css' source(none);`);
    expect(tw).not.toMatch(/preflight|@import 'tailwindcss'(?!\/)/);
    expect([...tw.matchAll(/@source '([^']+)'/g)].map((m) => m[1])).toEqual(['./components/beui', './components/bencho', './components/aicss', './components/faces', './components/composer', './components/ui', './components/ai-elements', './assistant']);
  });
  it('uses the Geist stacks', () => {
    expect(mapped['--font-sans']).toBe('var(--font-ui)');
    expect(mapped['--font-mono']).toBe('var(--font-code)');
  });
});

describe('lezer highlighting (no Shiki)', () => {
  it('tokenises TypeScript into Studio-token classes, keeping offsets and lines', async () => {
    const lines = (await tokenize("const a = 'x'; // hi\nreturn 1;", 'typescript'))!;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.find((tk) => tk.content === 'const')?.cls).toBe('tk-kw');
    expect(lines[0]!.find((tk) => tk.content === "'x'")?.cls).toBe('tk-str');
    expect(lines[0]!.find((tk) => tk.content.startsWith('//'))?.cls).toBe('tk-com');
    expect(lines[1]!.find((tk) => tk.content === '1')?.cls).toBe('tk-num');
    expect(lines[1]![0]!.offset).toBe("const a = 'x'; // hi\n".length);
  });
  it('leaves bash, diff and text plain', async () => {
    for (const lang of ['bash', 'diff', 'text'] as const) expect(await tokenize('$ npm test', lang)).toBeUndefined();
  });
});
