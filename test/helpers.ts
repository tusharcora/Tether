import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { normalizePipeline } from '../src/pipeline.js';
import { Store } from '../src/store.js';
import type { Pipeline, PipelineNode } from '../src/types.js';
import type { Vault } from '../src/vault.js';
import { afterAll } from 'vitest';

/** Every folder `tmp` made in this test file; each file imports this module afresh, so this hook runs once per file. */
const made: string[] = [];
const sweep = (dirs: string[]) => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a run still writing there must not fail the file; the system cleans its temp folder in the end
    }
  }
};
// shortcut: a run a test left going can remake a folder just after the first sweep, so sweep again a beat later; a run still going after that can leave an empty folder
afterAll(async () => {
  const dirs = made.splice(0);
  sweep(dirs);
  await new Promise((r) => setTimeout(r, 300));
  sweep(dirs);
}, 300_000); // a test can leave ~100,000 files (history-land's count limit), which takes longer than the default 10 s to remove

export function tmp(prefix = 'aorch-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

export function makeRepo(): string {
  const dir = tmp('repo-');
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return dir;
}

export function setup(vault?: Vault) {
  const home = tmp('home-');
  const mock = new MockAdapter();
  const registry = new AdapterRegistry().register(mock);
  const store = Store.open(':memory:');
  const engine = new Engine(store, { home, registry, vault });
  return { home, mock, registry, store, engine };
}

export function pipe(nodes: Partial<PipelineNode>[], edges: [string, string][], settings: Record<string, unknown> = {}): Pipeline {
  return normalizePipeline({
    name: 'test',
    nodes: nodes.map((n) => ({ kind: 'agent', agent: 'mock', ...n })),
    edges: edges.map(([from, to]) => ({ from, to })),
    settings,
  });
}

/** A folder with these files and no git. */
export function plainFolder(files: Record<string, string>): string {
  const dir = tmp('plain-');
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  return dir;
}
