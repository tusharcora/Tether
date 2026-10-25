import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { tmp } from './helpers.js';

describe('events_head index', () => {
  it("covers listRows' per-run MAX(seq)/MAX(ts), so a poll never reads the event rows", () => {
    const file = join(tmp(), 'runs.db');
    Store.open(file);
    const db = new DatabaseSync(file);
    const plan = (db.prepare('EXPLAIN QUERY PLAN SELECT run_id, MAX(seq) AS seq, MAX(ts) AS ts FROM events GROUP BY run_id').all() as { detail: string }[]).map((r) => r.detail).join('\n');
    db.close();
    expect(plan).toMatch(/COVERING INDEX events_head/);
  });
});
