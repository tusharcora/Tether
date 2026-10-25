/** Sent requests, redacted, in the store's sqlite file. The newest 500 per workspace are kept. */
import type { DatabaseSync } from 'node:sqlite';
import type { HistoryData, HistoryRow, Method, Source } from './types.js';

export type Db = InstanceType<typeof DatabaseSync>;
export const HISTORY_KEEP = 500;
export const HISTORY_LIST_MAX = 100;

export function ensureHistory(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS http_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      workspace TEXT NOT NULL,
      request TEXT,
      source TEXT NOT NULL,
      run_id TEXT,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER NOT NULL,
      ms INTEGER NOT NULL,
      size INTEGER NOT NULL,
      ok INTEGER,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS http_history_ws ON http_history(workspace, ts);
  `);
}

export interface NewHistory {
  workspace: string;
  request: string | null;
  source: Source;
  runId?: string;
  /** Already redacted and cut. */
  data: HistoryData;
  ok: boolean | null;
}

export function insertHistory(db: Db, h: NewHistory, keep = HISTORY_KEEP): number {
  const r = h.data.response;
  const row = db
    .prepare('INSERT INTO http_history(ts, workspace, request, source, run_id, method, url, status, ms, size, ok, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(Date.now(), h.workspace, h.request, h.source, h.runId ?? null, h.data.request.method, h.data.request.url, r.status, r.ms, r.size, h.ok === null ? null : h.ok ? 1 : 0, JSON.stringify(h.data)) as { id: number };
  db.prepare('DELETE FROM http_history WHERE workspace = ? AND id NOT IN (SELECT id FROM http_history WHERE workspace = ? ORDER BY id DESC LIMIT ?)').run(h.workspace, h.workspace, keep);
  return Number(row.id);
}

interface Raw {
  id: number;
  ts: number;
  workspace: string;
  request: string | null;
  source: string;
  run_id: string | null;
  method: string;
  url: string;
  status: number;
  ms: number;
  size: number;
  ok: number | null;
  data: string;
}
const toRow = (r: Raw): HistoryRow => ({
  id: Number(r.id),
  ts: Number(r.ts),
  workspace: r.workspace,
  request: r.request,
  source: r.source as Source,
  runId: r.run_id,
  method: r.method as Method,
  url: r.url,
  status: Number(r.status),
  ms: Number(r.ms),
  size: Number(r.size),
  ok: r.ok === null ? null : Number(r.ok) === 1,
  data: JSON.parse(r.data) as HistoryData,
});

export function listHistory(db: Db, q: { workspace: string; request?: string; limit?: number }): HistoryRow[] {
  const limit = Math.min(Math.max(1, Math.trunc(q.limit ?? 20)), HISTORY_LIST_MAX);
  const rows = q.request
    ? db.prepare('SELECT * FROM http_history WHERE workspace = ? AND request = ? ORDER BY id DESC LIMIT ?').all(q.workspace, q.request, limit)
    : db.prepare('SELECT * FROM http_history WHERE workspace = ? ORDER BY id DESC LIMIT ?').all(q.workspace, limit);
  return (rows as unknown as Raw[]).map(toRow);
}

export function getHistory(db: Db, workspace: string, id: number): HistoryRow | undefined {
  const r = db.prepare('SELECT * FROM http_history WHERE workspace = ? AND id = ?').get(workspace, id) as unknown as Raw | undefined;
  return r ? toRow(r) : undefined;
}
