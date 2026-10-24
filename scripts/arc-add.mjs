#!/usr/bin/env node
// Dev-time only: copies Arc (uiarc.dev, MIT) registry items into web/src/components/arc/.
// The dashboard never fetches anything from uiarc.dev at build or run time; the copied files are committed.
// Usage: node scripts/arc-add.mjs tabs button ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const REGISTRY = 'https://uiarc.dev/r/';
const PREFIX = '@components/arc/';
export const OUT_DIR = ['web', 'src', 'components', 'arc'];

export function targetPath(root, target) {
  if (!target.startsWith(PREFIX)) throw new Error(`unexpected target ${target}`);
  const rel = normalize(target.slice(PREFIX.length));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`unsafe target ${target}`);
  return join(root, rel);
}

export const itemUrl = (ref) => (ref.startsWith('https://') ? ref : `${REGISTRY}${ref}.json`);

async function main(names) {
  if (!names.length) throw new Error('usage: node scripts/arc-add.mjs <item> [item...]');
  const root = join(process.cwd(), ...OUT_DIR);
  const seen = new Set();
  const deps = new Set();
  const queue = names.map(itemUrl);
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!url.startsWith(REGISTRY)) throw new Error(`refusing a registry outside uiarc.dev: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const item = await res.json();
    for (const d of item.dependencies ?? []) deps.add(d);
    for (const r of item.registryDependencies ?? []) queue.push(itemUrl(r));
    for (const f of item.files ?? []) {
      const out = targetPath(root, f.target);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.content);
      console.log('wrote', out.slice(process.cwd().length + 1));
    }
  }
  console.log(`\nnpm dependencies: ${[...deps].sort().join(' ') || '(none)'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
