/** The one entry point that sends a request. The server, the CLI, gates and send-to-agent all call runRequest. */
import { loadPrefs, savePrefs } from '../prefs.js';
import { evaluate, passed } from './assert.js';
import { HttpClientError } from './errors.js';
import { insertHistory, type Db } from './history.js';
import { redactExchange } from './redact.js';
import { resolveRequest } from './resolve.js';
import { loadSecrets } from './secrets.js';
import { send } from './send.js';
import { collectionChain, parseRequest, readCollection, readEnvironment, readRequest } from './store.js';
import type { HttpRequestFile, SendOutput, Source } from './types.js';

export interface RunRequestInput {
  home: string;
  db: Db;
  /** Secrets scope and history key: the workspace id, or "default". */
  workspace: string;
  /** Folder whose .aorch/http holds the requests (a gate passes the run's worktree). */
  dir: string;
  /** Folder whose environments apply; default `dir`. */
  envDir?: string;
  /** A saved request; with `draft` too, it only says where the draft sits (its collection vars, its history key). */
  id?: string;
  /** An unsaved request body (validated like a file). */
  draft?: unknown;
  /** An environment name; null = none; undefined = the workspace's active one. */
  env?: string | null;
  source: Source;
  runId?: string;
  /** True only for the web UI, a gate and `aorch http run <id>` (spec: the secrets rule). */
  allowSecrets: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Inside a run (a gate, or `aorch http run` in a run's worktree) the request file is one an agent can edit: secrets
   * are only sent when the request's resolved origin equals that of the same request in this folder (the main checkout).
   */
  secretsOriginFrom?: string;
}

export const SECRETS_SCOPE_MESSAGE = 'secrets need the saved request: its host changed in this run';

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/** The origin the same request id resolves to from `dir` (its own file, collections and environment), or undefined. */
function savedOrigin(dir: string, id: string, envName: string | null, secrets: Record<string, string>): string | undefined {
  try {
    const r = readRequest(dir, id);
    if (!r.file) return undefined;
    const env = envName ? { name: envName, file: readEnvironment(dir, envName) } : undefined;
    return originOf(resolveRequest(r.file, { collections: collectionChain(dir, id), env, secrets, allowSecrets: true }).request.url);
  } catch {
    return undefined;
  }
}

export const activeEnv = (home: string, scope: string): string | null => {
  const m = loadPrefs(home).httpActiveEnv;
  return m && Object.hasOwn(m, scope) ? (m[scope] ?? null) : null;
};

export function setActiveEnv(home: string, scope: string, name: string | null): void {
  const cur = { ...(loadPrefs(home).httpActiveEnv ?? {}) };
  if (name) cur[scope] = name;
  else delete cur[scope];
  savePrefs(home, { httpActiveEnv: cur });
}

export async function runRequest(i: RunRequestInput): Promise<SendOutput> {
  let file: HttpRequestFile;
  if (i.draft !== undefined) {
    try {
      file = parseRequest(i.draft);
    } catch (e) {
      throw new HttpClientError('invalid', (e as Error).message);
    }
  } else if (i.id !== undefined) {
    const r = readRequest(i.dir, i.id);
    if (!r.file) throw new HttpClientError('invalid', `${i.id}: ${r.error}`);
    file = r.file;
  } else throw new HttpClientError('invalid', 'send needs a saved request id or a draft');
  const chain = i.id !== undefined ? collectionChain(i.dir, i.id) : [{ path: '', file: readCollection(i.dir, '') }];
  // a stale active environment (deleted or renamed on disk) fails here with `no environment "<name>"`, never sends without it
  const envName = i.env === undefined ? activeEnv(i.home, i.workspace) : i.env;
  const env = envName ? { name: envName, file: readEnvironment(i.envDir ?? i.dir, envName) } : undefined;
  const secrets = loadSecrets(i.home, i.workspace);
  const { request, secretsUsed } = resolveRequest(file, { collections: chain, env, secrets, allowSecrets: i.allowSecrets });
  if (i.secretsOriginFrom !== undefined && secretsUsed.size) {
    const saved = i.id !== undefined ? savedOrigin(i.secretsOriginFrom, i.id, envName, secrets) : undefined;
    const now = originOf(request.url);
    if (!saved || !now || saved !== now) throw new HttpClientError('secrets_scope', SECRETS_SCOPE_MESSAGE);
  }
  // a header whose value used a secret never follows a redirect to another origin
  const used = [...secretsUsed.values()].filter(Boolean);
  const secretHeaders = request.headers.filter(([, v]) => used.some((s) => v.includes(s))).map(([k]) => k);
  const result = await send(request, { timeoutMs: i.timeoutMs, signal: i.signal, secretHeaders });
  const checks = evaluate(file.checks, result);
  const stored = redactExchange(request, result, checks, secretsUsed);
  // a dirty send of a saved request (draft + id) keeps its id, so its per-request history stays whole
  const historyId = insertHistory(i.db, { workspace: i.workspace, request: i.id ?? null, source: i.source, runId: i.runId, data: stored, ok: file.checks.length ? passed(result, checks) : null });
  const shown = redactExchange(request, result, checks, secretsUsed, { cut: false });
  return { result: shown.response, checks: shown.checks, request: shown.request, historyId };
}
