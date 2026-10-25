import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureHistory, type Db as HistoryDb } from './http/history.js';
import { foldRun, planWaiting, type RunEvent, type RunState, type StoredEvent } from './types.js';

// node:sqlite is still flagged experimental on Node 22; silence only that warning.
const origEmit = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  const msg = typeof w === 'string' ? w : w.message;
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return (origEmit as (...a: unknown[]) => void)(w, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = await import('node:sqlite');
type Db = InstanceType<typeof DatabaseSync>;

export interface RunSummary {
  id: string;
  pipeline: string;
  task: string;
  repo: string;
  status: RunState['status'];
  startedAt: number;
  finishedAt?: number;
  costUsd: number;
  nodes: Record<string, string>;
  kind: RunState['kind'];
  mode: RunState['mode'];
  /** Questions waiting for the person. */
  pending: number;
  /** A team run's plan is ready and waits for approval. */
  planReady: boolean;
  /** An Evolve probe replay (lists may hide it; it can be deleted like any run). */
  probe?: true;
}

type Listener = (e: StoredEvent) => void;

/** Append-only event log in SQLite (WAL, so the CLI and the server can share one file). */
export class Store {
  private listeners = new Set<Listener>();
  private cache = new Map<string, { seq: number; state: RunState | undefined }>();

  private constructor(private db: Db) {}

  static open(file: string): Store {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL,
        seq    INTEGER NOT NULL,
        ts     INTEGER NOT NULL,
        type   TEXT NOT NULL,
        data   TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS events_type ON events(type, ts);
    `);
    ensureHistory(db);
    return new Store(db);
  }

  append(runId: string, event: RunEvent): StoredEvent {
    const ts = Date.now();
    const data = JSON.stringify(event);
    const stmt = this.db.prepare(
      `INSERT INTO events(run_id, seq, ts, type, data)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE run_id = ?), ?, ?, ?)
       RETURNING seq`,
    );
    let seq: number | undefined;
    for (let attempt = 0; attempt < 5 && seq === undefined; attempt++) {
      try {
        const row = stmt.get(runId, runId, ts, event.type, data) as { seq: number } | undefined;
        seq = row?.seq;
      } catch (err) {
        // another process won the seq race: retry
        if (attempt === 4 || !/constraint|UNIQUE|PRIMARY/i.test(String(err))) throw err;
      }
    }
    if (seq === undefined) throw new Error('failed to append event');
    const stored: StoredEvent = { runId, seq, ts, event };
    for (const l of this.listeners) {
      try {
        l(stored);
      } catch {
        /* listeners must not break the log */
      }
    }
    return stored;
  }

  events(runId: string, afterSeq = 0): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT seq, ts, data FROM events WHERE run_id = ? AND seq > ? ORDER BY seq')
      .all(runId, afterSeq) as { seq: number; ts: number; data: string }[];
    return rows.map((r) => ({ runId, seq: r.seq, ts: r.ts, event: JSON.parse(r.data) as RunEvent }));
  }

  /** Event types the dashboard timeline needs, without the (large) chunk stream. */
  eventsNoChunks(runId: string): StoredEvent[] {
    const rows = this.db
      .prepare("SELECT seq, ts, data FROM events WHERE run_id = ? AND type != 'node.chunk' ORDER BY seq")
      .all(runId) as { seq: number; ts: number; data: string }[];
    return rows.map((r) => ({ runId, seq: r.seq, ts: r.ts, event: JSON.parse(r.data) as RunEvent }));
  }

  private maxSeq(runId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE run_id = ?').get(runId) as {
      m: number;
    };
    return row.m;
  }

  /** Timestamp of the run's newest event, or 0. */
  lastTs(runId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(ts), 0) AS t FROM events WHERE run_id = ?').get(runId) as { t: number };
    return row.t;
  }

  state(runId: string): RunState | undefined {
    const max = this.maxSeq(runId);
    const hit = this.cache.get(runId);
    if (hit && hit.seq === max) return hit.state;
    const state = foldRun(this.events(runId));
    this.cache.set(runId, { seq: max, state });
    return state;
  }

  /** Run ids, newest first. `probes: false` leaves Evolve probe replays out (in the query, so limits apply to real runs); `true` lists only them. */
  runIds(o: { probes?: boolean } = {}): string[] {
    const where = o.probes === false ? " AND json_extract(data, '$.probe') IS NULL" : o.probes === true ? " AND json_extract(data, '$.probe') IS NOT NULL" : '';
    const rows = this.db.prepare(`SELECT run_id FROM events WHERE type = 'run.started'${where} ORDER BY ts DESC`).all() as {
      run_id: string;
    }[];
    return rows.map((r) => r.run_id);
  }

  list(): RunSummary[] {
    const out: RunSummary[] = [];
    for (const id of this.runIds()) {
      const s = this.state(id);
      if (!s) continue;
      out.push({
        id,
        pipeline: s.pipeline.name,
        task: s.task,
        repo: s.repo,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        costUsd: s.costUsd,
        nodes: Object.fromEntries(Object.entries(s.nodes).map(([k, v]) => [k, v.status])),
        kind: s.kind,
        mode: s.mode,
        pending: s.pending.length,
        planReady: planWaiting(s),
        ...(s.probe ? { probe: true as const } : {}),
      });
    }
    return out;
  }

  /** Remove a run's whole event log. */
  deleteRun(runId: string): void {
    this.db.prepare('DELETE FROM events WHERE run_id = ?').run(runId);
    this.cache.delete(runId);
  }

  onAppend(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.db.close();
  }

  /** The database itself, for modules that keep their own tables in it (API client history). */
  raw(): HistoryDb {
    return this.db;
  }
}
