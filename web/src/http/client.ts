import type { CollectionFile, Environment, HistoryRow, HttpRequestFile, HttpTree, ImportPreview, SendOutput, VarInfo } from '../../../src/http/types';
import { api } from '../api';

export type { Body, Check, CheckResult, CollectionFile, Environment, EnvValue, HistoryRow, HttpRequestFile, HttpTree, ImportPreview, KV, Method, SendOutput, SendResult, TreeCollection, TreeRequest, VarInfo, VarSource } from '../../../src/http/types';
export { METHODS, VAR_IN_TEXT } from '../../../src/http/types';

const q = (ws: string | undefined, extra: Record<string, string | undefined> = {}) => {
  const s = new URLSearchParams();
  if (ws) s.set('ws', ws);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) s.set(k, v);
  const t = s.toString();
  return t ? `?${t}` : '';
};
const enc = encodeURIComponent;
export type ImportBody = { kind: 'curl' | 'openapi' | 'postman'; text: string; into?: string };

/** Typed calls to /api/http/*. Ids travel URL-encoded in one path segment. */
export const httpApi = {
  tree: (ws?: string) => api<HttpTree>('GET', `/api/http/tree${q(ws)}`),
  request: (ws: string | undefined, id: string) => api<{ id: string; file?: HttpRequestFile; error?: string; raw?: string; vars: Record<string, VarInfo | null> }>('GET', `/api/http/requests/${enc(id)}${q(ws)}`),
  create: (ws: string | undefined, collection: string, file: HttpRequestFile) => api<{ id: string }>('POST', `/api/http/requests${q(ws)}`, { collection, file }),
  save: (ws: string | undefined, id: string, file: HttpRequestFile) => api<{ id: string; file: HttpRequestFile }>('PUT', `/api/http/requests/${enc(id)}${q(ws)}`, file),
  remove: (ws: string | undefined, id: string) => api<{ deleted: string }>('DELETE', `/api/http/requests/${enc(id)}${q(ws)}`),
  saveCollection: (ws: string | undefined, path: string, file: CollectionFile) => api('PUT', `/api/http/collections/${enc(path)}${q(ws)}`, file),
  send: (ws: string | undefined, body: { id?: string; draft?: HttpRequestFile; env?: string | null }) => api<SendOutput>('POST', `/api/http/send${q(ws)}`, body),
  history: (ws: string | undefined, request?: string, limit = 20) => api<HistoryRow[]>('GET', `/api/http/history${q(ws, { request, limit: String(limit) })}`),
  setEnv: (ws: string | undefined, name: string | null) => api<{ activeEnv: string | null }>('PUT', `/api/http/active-env${q(ws)}`, { name }),
  env: (ws: string | undefined, name: string) => api<Environment & { name: string }>('GET', `/api/http/environments/${enc(name)}${q(ws)}`),
  saveEnv: (ws: string | undefined, name: string, env: Environment) => api<Environment & { name: string }>('PUT', `/api/http/environments/${enc(name)}${q(ws)}`, env),
  deleteEnv: (ws: string | undefined, name: string) => api('DELETE', `/api/http/environments/${enc(name)}${q(ws)}`),
  secrets: (ws?: string) => api<{ keys: string[] }>('GET', `/api/http/secrets${q(ws)}`),
  setSecret: (ws: string | undefined, key: string, value: string) => api<{ keys: string[] }>('PUT', `/api/http/secrets/${enc(key)}${q(ws)}`, { value }),
  deleteSecret: (ws: string | undefined, key: string) => api<{ keys: string[] }>('DELETE', `/api/http/secrets/${enc(key)}${q(ws)}`),
  importPreview: (ws: string | undefined, body: ImportBody) => api<ImportPreview>('POST', `/api/http/import${q(ws)}`, body),
  importApply: (ws: string | undefined, body: ImportBody) => api<{ created: string[] }>('POST', `/api/http/import/apply${q(ws)}`, { ...body, confirm: true }),
  sendToAgent: (ws: string | undefined, body: { historyId: number; target: { kind: 'run'; bot: string; mode: 'solo' | 'team' } | { kind: 'maestro' }; note: string }) => api<{ runId: string }>('POST', `/api/http/send-to-agent${q(ws)}`, body),
};

export const newRequest = (): HttpRequestFile => ({ v: 1, name: 'New request', method: 'GET', url: '{{base}}/', query: [], headers: [], body: { kind: 'none' }, vars: {}, checks: [] });
