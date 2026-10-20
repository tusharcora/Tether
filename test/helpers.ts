import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { normalizePipeline } from '../src/pipeline.js';
import { Store } from '../src/store.js';
import type { Pipeline, PipelineNode } from '../src/types.js';
import type { Vault } from '../src/vault.js';

export function tmp(prefix = 'aorch-') {
  return mkdtempSync(join(tmpdir(), prefix));
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
