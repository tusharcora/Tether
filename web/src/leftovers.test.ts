import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;
const root = fileURLToPath(new URL('./', here));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const product = walk(root).filter((p) => /\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith(join(root, 'test')));
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const code = product
  .filter((p) => /\.tsx?$/.test(p))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');
/** Classes that libraries put on elements (blobatar's motion wrapper), not our components. */
const FROM_LIBRARIES = new Set(['mo-root', 'mo-always']);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

describe('the .studio alias is gone', () => {
  it('no stylesheet selects .studio', () => {
    const hits = product.filter((p) => p.endsWith('.css') && /\.studio\b/.test(noComments(readFileSync(p, 'utf8')))).map((p) => relative(root, p));
    expect(hits).toEqual([]);
  });
  it('no component sets the studio class', () => {
    expect(code.match(/className=(?:"|'|\{`)[^"'`]*(?<![\w-])studio(?![\w-])/g) ?? []).toEqual([]);
  });
});

describe('styles.css keeps no leftovers', () => {
  const styles = noComments(readFileSync(join(root, 'styles.css'), 'utf8'));
  it('holds no per-screen block', () => {
    for (const retired of ['.builder', '.palette', '.inspector', '.graph-view', '.g-node', '.crew-page', '.crew-card', '.bot-editor', '.triggers-page', '.trig-', '.qpanel', '.evolve-panel', '.canvas', '.node-head', '.runs ', '.run-list'])
      expect(styles, retired).not.toContain(retired);
  });
  it('styles only classes some component uses', () => {
    const classes = [...new Set([...styles.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!))];
    const unused = classes.filter((c) => !FROM_LIBRARIES.has(c) && !new RegExp(`(?<![\\w-])${escape(c)}(?![\\w-])`).test(code));
    expect(unused).toEqual([]);
  });
});
