/** LLM providers: what is set up, and adding OpenAI-compatible endpoints to `<home>/aorch.config.json`. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterRegistry } from './adapters/index.js';
import { LOCAL_ENDPOINTS, type EndpointConfig } from './adapters/openai.js';
import type { Config } from './config.js';

export interface Preset {
  id: string;
  label: string;
  baseUrl: string;
  keyEnv: string;
}

/** Hosted services that speak the OpenAI chat API. A model is chosen per bot in the Crew tab. */
export const PRESETS: Preset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter (many models)', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', keyEnv: 'TOGETHER_API_KEY' },
  { id: 'fireworks', label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', keyEnv: 'FIREWORKS_API_KEY' },
];

const RESERVED = new Set(['claude', 'codex', 'opencode', 'mock', ...Object.keys(LOCAL_ENDPOINTS)]);
export const PROVIDER_NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;

export interface ProviderRow {
  id: string;
  kind: 'agent cli' | 'local server' | 'endpoint' | 'custom cli' | 'test';
  /** Where it lives: a URL for endpoints, the command for CLIs. */
  where: string;
  /** For endpoints: the env var holding the key, and whether it is set right now. */
  keyEnv?: string;
  keySet?: boolean;
  /** Only endpoints added by the user can be removed. */
  removable: boolean;
}

export function listProviders(cfg: Config, registry: AdapterRegistry): ProviderRow[] {
  return registry.ids().map((id) => {
    const ep = cfg.endpoints[id];
    if (ep) {
      const keyEnv = ep.apiKey?.startsWith('env:') ? ep.apiKey.slice(4) : undefined;
      return { id, kind: 'endpoint', where: ep.baseUrl, keyEnv, keySet: keyEnv ? !!process.env[keyEnv] : !!ep.apiKey, removable: true };
    }
    if (LOCAL_ENDPOINTS[id]) return { id, kind: 'local server', where: LOCAL_ENDPOINTS[id]!.baseUrl, removable: false };
    if (cfg.adapters[id]) return { id, kind: 'custom cli', where: cfg.adapters[id]!.command, removable: false };
    if (id === 'mock') return { id, kind: 'test', where: 'built in, no model', removable: false };
    return { id, kind: 'agent cli', where: id === 'claude' ? 'claude' : id, removable: false };
  });
}

/** `DEEPSEEK_API_KEY` or `env:DEEPSEEK_API_KEY` → `env:DEEPSEEK_API_KEY`. Literal keys are refused: the config file is plain text. */
export function keyRef(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const name = t.startsWith('env:') ? t.slice(4) : t;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('give the NAME of an environment variable that holds the key (for example DEEPSEEK_API_KEY), not the key itself');
  return `env:${name}`;
}

/** `Experimental Labs.ai` → `experimental-labs-ai`; a host or URL works as a name too. */
export function providerName(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(api|www)\./, '').split('/')[0]!.replace(/\.(ai|com|io|dev|net|org|app|co)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 24);
}

/** Accept `api.example.com` or `https://api.example.com` and make a URL of it (https, and /v1 when no path is given). */
export function baseUrlOf(input: string): string {
  let t = input.trim().replace(/\/+$/, '');
  if (!/^[a-z]+:\/\//i.test(t)) t = (/^(localhost|127\.|\[::1\])/.test(t) ? 'http://' : 'https://') + t;
  try {
    if (new URL(t).pathname === '/') t += '/v1';
  } catch {
    /* checkEndpoint reports it */
  }
  return t;
}

export function checkEndpoint(id: string, cfg: EndpointConfig, existing: Record<string, unknown>): void {
  if (!PROVIDER_NAME_RE.test(id)) throw new Error('name: lowercase letters, digits and - (start with a letter, max 24)');
  if (RESERVED.has(id)) throw new Error(`"${id}" is built in`);
  if (existing[id]) throw new Error(`"${id}" already exists. Remove it first to change it`);
  let u: URL;
  try {
    u = new URL(cfg.baseUrl);
  } catch {
    throw new Error('the base URL is not a valid URL (for example https://api.example.com/v1)');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('the base URL must start with http:// or https://');
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) && cfg.apiKey) throw new Error('refusing to send an API key over plain http to a remote host; use https');
}

function readFile(home: string): Record<string, unknown> {
  const path = join(home, 'aorch.config.json');
  if (!existsSync(path)) return {};
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch (e) {
    throw new Error(`${path} is not valid JSON, fix it by hand first: ${(e as Error).message}`);
  }
}

/** Add an endpoint to the config file (keeping everything else in it) and to the live config. */
export function addEndpoint(cfg: Config, id: string, ep: EndpointConfig): void {
  checkEndpoint(id, ep, cfg.endpoints);
  const file = readFile(cfg.home);
  const endpoints = { ...((file.endpoints as Record<string, EndpointConfig>) ?? {}), [id]: ep };
  writeFileSync(join(cfg.home, 'aorch.config.json'), JSON.stringify({ ...file, endpoints }, null, 2) + '\n');
  cfg.endpoints = { ...cfg.endpoints, [id]: ep };
}

export function removeEndpoint(cfg: Config, id: string): void {
  if (!cfg.endpoints[id]) throw new Error(`"${id}" is not an endpoint you added`);
  const file = readFile(cfg.home);
  const endpoints = { ...((file.endpoints as Record<string, EndpointConfig>) ?? {}) };
  delete endpoints[id];
  writeFileSync(join(cfg.home, 'aorch.config.json'), JSON.stringify({ ...file, endpoints }, null, 2) + '\n');
  const next = { ...cfg.endpoints };
  delete next[id];
  cfg.endpoints = next;
}
