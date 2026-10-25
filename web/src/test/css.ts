import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// vitest blanks CSS imports, so style rules are read from disk; the base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;
/** Whitespace, comma spacing and quotes normalised, the same way studio.test.ts compares token values. */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/"/g, "'");

/** A CSS file under web/src (path relative to web/src), normalised. */
export const cssText = (file: string) => norm(readFileSync(fileURLToPath(new URL(`../${file}`, here)), 'utf8'));

/** The normalised declarations of the first `selector { ... }` rule in a CSS file under web/src. */
export function cssRule(file: string, selector: string): string {
  const text = cssText(file);
  const i = text.indexOf(`${norm(selector)} {`);
  if (i < 0) throw new Error(`no rule for ${selector} in ${file}`);
  return text.slice(text.indexOf('{', i) + 1, text.indexOf('}', i)).trim();
}
