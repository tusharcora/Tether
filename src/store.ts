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
  origin?: RunState['origin'];
  ship?: RunState['ship'];
}

const summarize = (id: string, s: RunState): RunSummary => ({
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
  ...(s.origin ? { origin: s.origin } : {}),
  ...(s.ship ? { ship: s.ship } : {}),
});

/** A position in the cross-run event order (ts, run id, seq). */
export interface FeedCursor {
  ts: number;
  runId: string;
  seq: number;
}

export interface FeedOptions {
  types: readonly string[];
  /** Only events strictly after this position, oldest first. */
  after?: FeedCursor;
  /** Run ids to leave out. */
  exclude?: readonly string[];
  /** Only events with `ts <= until`. */
  until?: number;
  limit: number;
}

/**
 * Events of some types across runs. With `after`: strictly after that position, oldest first, so a gap longer than
 * `limit` is paged forward without holes. Without: the newest, newest first. Pinned to the events_type (type, ts)
 * index so a log full of chunk rows is never scanned.
 */
export function feedQuery(o: FeedOptions): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [...o.types];
  let sql = `SELECT run_id, seq, ts, data FROM events INDEXED BY events_type WHERE type IN (${o.types.map(() => '?').join(', ')})`;
  if (o.until !== undefined) {
    sql += ' AND ts <= ?';
    params.push(o.until);
  }
  if (o.after) {
    sql += ' AND (ts, run_id, seq) > (?, ?, ?)';
    params.push(o.after.ts, o.after.runId, o.after.seq);
  }
  if (o.exclude?.length) {
    sql += ` AND run_id NOT IN (${o.exclude.map(() => '?').join(', ')})`;
    params.push(...o.exclude);
  }
  const dir = o.after ? 'ASC' : 'DESC';
  sql += ` ORDER BY ts ${dir}, run_id ${dir}, seq ${dir} LIMIT ?`;
  params.push(o.limit);
  return { sql, params };
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
      -- covers listRows' per-run MAX(seq)/MAX(ts) so a poll never reads the data pages (node.chunk rows are big)
      CREATE INDEX IF NOT EXISTS events_head ON events(run_id, seq, ts);
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

  /** The run's events of the given types after seq `afterSeq`, oldest first (a primary-key range read; nothing else is parsed). */
  eventsOfTypes(runId: string, types: readonly RunEvent['type'][], afterSeq = 0): StoredEvent[] {
    const rows = this.db
      .prepare(`SELECT seq, ts, data FROM events WHERE run_id = ? AND seq > ? AND type IN (${types.map(() => '?').join(', ')}) ORDER BY seq`)
      .all(runId, afterSeq, ...types) as { seq: number; ts: number; data: string }[];
    return rows.map((r) => ({ runId, seq: r.seq, ts: r.ts, event: JSON.parse(r.data) as RunEvent }));
  }

  /** Events of some types across runs (see feedQuery for the order). */
  feed(o: FeedOptions): StoredEvent[] {
    const q = feedQuery(o);
    const rows = this.db.prepare(q.sql).all(...q.params) as { run_id: string; seq: number; ts: number; data: string }[];
    return rows.map((r) => ({ runId: r.run_id, seq: r.seq, ts: r.ts, event: JSON.parse(r.data) as RunEvent }));
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
    return this.stateAt(runId, this.maxSeq(runId));
  }

  /** The folded state at newest seq `max`: from the cache when nothing was appended since, else one events read. */
  private stateAt(runId: string, max: number): RunState | undefined {
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
    return this.listRows().map((r) => r.summary);
  }

  /**
   * Every run, newest first, with its folded state, newest event time and newest seq. A fixed number of queries however many runs
   * there are (one grouped read of every run's newest seq and ts, one of the run ids); only runs that changed since the
   * last call re-read their events.
   */
  listRows(): { summary: RunSummary; state: RunState; lastTs: number; seq: number }[] {
    const heads = new Map<string, { seq: number; ts: number }>();
    const rows = this.db.prepare('SELECT run_id, MAX(seq) AS seq, MAX(ts) AS ts FROM events GROUP BY run_id').all() as { run_id: string; seq: number; ts: number }[];
    for (const r of rows) heads.set(r.run_id, { seq: r.seq, ts: r.ts });
    const out: { summary: RunSummary; state: RunState; lastTs: number; seq: number }[] = [];
    for (const id of this.runIds()) {
      const head = heads.get(id);
      if (!head) continue; // started (by another process) between the two reads: next call lists it
      const s = this.stateAt(id, head.seq);
      if (!s) continue;
      out.push({ summary: summarize(id, s), state: s, lastTs: head.ts, seq: head.seq });
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
