import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// vitest blanks CSS imports, so style rules are read from disk; the base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;

/** jsdom's CSSOM serialises values compactly (no space after commas, double quotes), so both sides of a CSS comparison go through this. */
export const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/"/g, "'");

/** A CSS file under web/src (path relative to web/src), comments removed, normalised. */
export const cssText = (file: string) => norm(readFileSync(fileURLToPath(new URL(`../${file}`, here)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));

/** The top-level blocks of a stylesheet: `prelude { body }`, with nested braces kept inside the body. */
function blocks(text: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' && depth++ === 0) open = i;
    else if (c === '}' && --depth === 0) {
      out.push({ prelude: norm(text.slice(start, open)), body: norm(text.slice(open + 1, i)) });
      start = i + 1;
    }
  }
  return out;
}

/**
 * The normalised declarations of the one rule whose whole selector list is `selector`. Rules inside @-rule blocks
 * (@media, @keyframes, ...) are skipped unless `scope` names that block's prelude. Throws when there is no such rule or more than one.
 */
export function ruleIn(css: string, selector: string, scope?: string): string {
  let top = blocks(norm(css.replace(/\/\*[\s\S]*?\*\//g, '')));
  if (scope) {
    const scopes = top.filter((b) => b.prelude === norm(scope));
    if (!scopes.length) throw new Error(`no ${scope} block`);
    top = scopes.flatMap((b) => blocks(b.body));
  }
  const hits = top.filter((b) => !b.prelude.startsWith('@') && b.prelude === norm(selector));
  if (!hits.length) throw new Error(`no rule for ${selector}${scope ? ` in ${scope}` : ''}`);
  if (hits.length > 1) throw new Error(`ambiguous: ${hits.length} rules for ${selector}`);
  return hits[0]!.body;
}

/** `ruleIn` for a CSS file under web/src. */
export const cssRule = (file: string, selector: string, scope?: string) => ruleIn(cssText(file), selector, scope);
