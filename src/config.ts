import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultRegistry, type AdapterRegistry } from './adapters/index.js';
import type { CustomAdapterConfig } from './adapters/cli.js';
import type { EndpointConfig } from './adapters/openai.js';
import { NAME_RE, loadPipelineFile } from './pipeline.js';
import type { Pipeline } from './types.js';

export interface Config {
  home: string;
  vault: string;
  adapters: Record<string, CustomAdapterConfig>;
  /** Extra OpenAI-compatible endpoints (local or remote): { "mybox": { "baseUrl": "http://host:8000/v1", "apiKey": "env:MY_KEY" } } */
  endpoints: Record<string, EndpointConfig>;
}

export function resolveHome(override?: string): string {
  return override ?? process.env.AORCH_HOME ?? join(homedir(), '.aorch');
}

/** `<home>/aorch.config.json` — { "vault": "/path/to/obsidian/vault", "adapters": { "name": { "command": "...", "args": ["{prompt}"] } } } */
export function loadConfig(o: { home?: string; vault?: string } = {}): Config {
  const home = resolveHome(o.home);
  mkdirSync(home, { recursive: true });
  let file: { vault?: string; adapters?: Record<string, CustomAdapterConfig>; endpoints?: Record<string, EndpointConfig> } = {};
  const path = join(home, 'aorch.config.json');
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
    }
  }
  return {
    home,
    vault: o.vault ?? process.env.AORCH_VAULT ?? file.vault ?? join(home, 'vault'),
    adapters: file.adapters ?? {},
    endpoints: file.endpoints ?? {},
  };
}

export function makeRegistry(cfg: Config): AdapterRegistry {
  return defaultRegistry(cfg.adapters, cfg.endpoints);
}

// ---- pipeline store (<home>/pipelines/<name>.json) ----

export const pipelinesDir = (home: string) => join(home, 'pipelines');

export function listPipelines(home: string): { name: string; nodes: number; mode: string }[] {
  const dir = pipelinesDir(home);
  if (!existsSync(dir)) return [];
  const out: { name: string; nodes: number; mode: string }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = loadPipelineFile(join(dir, f));
      out.push({ name: p.name, nodes: p.nodes.length, mode: p.mode });
    } catch {
      /* skip unreadable file */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readPipeline(home: string, name: string): Pipeline {
  if (!NAME_RE.test(name)) throw new Error('invalid pipeline name');
  return loadPipelineFile(join(pipelinesDir(home), `${name}.json`));
}

export function writePipeline(home: string, p: Pipeline): void {
  if (!NAME_RE.test(p.name)) throw new Error('invalid pipeline name');
  mkdirSync(pipelinesDir(home), { recursive: true });
  writeFileSync(join(pipelinesDir(home), `${p.name}.json`), JSON.stringify(p, null, 2) + '\n');
}

/** Copy the bundled example pipelines into the home dir (never overwrites). */
export function installExamples(home: string, examplesDir: string): string[] {
  const dest = pipelinesDir(home);
  mkdirSync(dest, { recursive: true });
  const written: string[] = [];
  if (!existsSync(examplesDir)) return written;
  for (const f of readdirSync(examplesDir)) {
    if (!f.endsWith('.json') || existsSync(join(dest, f))) continue;
    writeFileSync(join(dest, f), readFileSync(join(examplesDir, f)));
    written.push(f);
  }
  return written;
}
