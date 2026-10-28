/**
 * The MCP servers the owner adds in Settings → Tools (<home>/mcp.json): each becomes an `mcp.<name>` connector inside Code
 * Mode, so agents never load those servers' tool lists, only the methods they find and call. A stdio server is a command;
 * an HTTP one a URL. Env and header values may hold keys: the API returns their names only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type McpServer = { name: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string } | { name: string; url: string; headers?: Record<string, string> };

/** What Settings sees: never an env or header value. */
export interface PublicMcpServer {
  name: string;
  kind: 'stdio' | 'http';
  target: string;
  envKeys: string[];
  headerKeys: string[];
}

export const MCP_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_SERVERS = 30;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const file = (home: string) => join(home, 'mcp.json');

const record = (v: unknown, what: string): Record<string, string> | undefined => {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} must be an object of strings`);
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!KEY_RE.test(k) || typeof x !== 'string' || x.length > 4096) throw new Error(`${what} has an invalid entry "${k.slice(0, 40)}"`);
    out[k] = x;
  }
  return out;
};

/** One server as sent or stored, checked; throws a plain reason. */
export function checkMcpServer(v: unknown): McpServer {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('a server must be an object');
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || !MCP_NAME_RE.test(o.name)) throw new Error('the name must be lowercase letters, digits or _ (starting with a letter, at most 32)');
  if (typeof o.url === 'string') {
    let u: URL;
    try {
      u = new URL(o.url);
    } catch {
      throw new Error('the URL is not valid');
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error('the URL must be http or https');
    const headers = record(o.headers, 'headers');
    return { name: o.name, url: u.toString(), ...(headers ? { headers } : {}) };
  }
  if (typeof o.command !== 'string' || !o.command.trim() || o.command.length > 500) throw new Error('give a command (stdio) or a url (HTTP)');
  const args = o.args === undefined ? undefined : Array.isArray(o.args) && o.args.every((a) => typeof a === 'string' && a.length <= 2000) ? (o.args as string[]).slice(0, 50) : (() => { throw new Error('args must be a list of strings'); })();
  const env = record(o.env, 'env');
  return { name: o.name, command: o.command.trim(), ...(args?.length ? { args } : {}), ...(env ? { env } : {}), ...(typeof o.cwd === 'string' && o.cwd ? { cwd: o.cwd } : {}) };
}

export function loadMcpServers(home: string): McpServer[] {
  try {
    const j = JSON.parse(readFileSync(file(home), 'utf8')) as { servers?: unknown };
    const out: McpServer[] = [];
    for (const s of Array.isArray(j.servers) ? j.servers : []) {
      try {
        out.push(checkMcpServer(s));
      } catch {
        /* a broken entry is skipped */
      }
    }
    return out.slice(0, MAX_SERVERS);
  } catch {
    return [];
  }
}

function save(home: string, servers: McpServer[]): void {
  mkdirSync(home, { recursive: true });
  // values can be keys: the file is the owner's alone
  writeFileSync(`${file(home)}.tmp`, JSON.stringify({ servers }, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${file(home)}.tmp`, file(home));
}

/** Add or replace a server by name. */
export function putMcpServer(home: string, raw: unknown): McpServer {
  const s = checkMcpServer(raw);
  const list = loadMcpServers(home).filter((x) => x.name !== s.name);
  if (list.length >= MAX_SERVERS) throw new Error(`at most ${MAX_SERVERS} MCP servers`);
  save(home, [...list, s]);
  return s;
}

export function removeMcpServer(home: string, name: string): boolean {
  const list = loadMcpServers(home);
  const next = list.filter((x) => x.name !== name);
  if (next.length === list.length) return false;
  save(home, next);
  return true;
}

export const publicMcp = (s: McpServer): PublicMcpServer =>
  'url' in s
    ? { name: s.name, kind: 'http', target: s.url, envKeys: [], headerKeys: Object.keys(s.headers ?? {}) }
    : { name: s.name, kind: 'stdio', target: [s.command, ...(s.args ?? [])].join(' '), envKeys: Object.keys(s.env ?? {}), headerKeys: [] };
