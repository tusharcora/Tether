import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCursor, SETTLE_MS } from '../src/activityFeed.js';
import { Store } from '../src/store.js';
import { VAULT_ACTIVITY_LIMIT, VAULT_ACTIVITY_MAX, vaultActivity } from '../src/vaultActivity.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

/** Run `fn` with the clock (and so every appended event's ts) at `ms`. */
const at = <T>(ms: number, fn: () => T): T => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(ms);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
};

afterEach(() => vi.restoreAllMocks());

describe('vault activity', () => {
  it('lists the notes runs wrote, newest first, with the run label and no other text', () => {
    const s = Store.open(':memory:');
    at(1_000, () => {
      seedRun(s, 'r1', { name: 'ship', task: 'SENTINEL task text' });
      s.append('r1', { type: 'vault.note', path: 'Runs/2026-10-25 ship r1.md' });
      s.append('r1', { type: 'vault.note', path: 'Roles/coder.md' });
      seedRun(s, 't1', { kind: 'team', task: 'SENTINEL team task' });
      s.append('t1', { type: 'vault.note', path: 'Files/src/a.ts.md' });
    });
    const r = vaultActivity(s, { limit: 10, now: 1_000 + SETTLE_MS });
    expect(r.items.map((i) => i.path)).toEqual(['Files/src/a.ts.md', 'Roles/coder.md', 'Runs/2026-10-25 ship r1.md']);
    expect(r.items[0]).toEqual({ id: 't1:2', ts: 1000, runId: 't1', run: 'Squad run', path: 'Files/src/a.ts.md' });
    expect(r.items[1]!.run).toBe('ship');
    expect(JSON.stringify(r)).not.toContain('SENTINEL');
    expect(r.cursor).toBe('1000:t1:2');
  });

  it('pages forward after a cursor, holds back unsettled events and leaves probe runs out', () => {
    const s = Store.open(':memory:');
    at(1_000, () => {
      seedRun(s, 'r1');
      s.append('r1', { type: 'vault.note', path: 'a.md' });
      seedRun(s, 'p1', { probe: true });
      s.append('p1', { type: 'vault.note', path: 'probe.md' });
    });
    const first = vaultActivity(s, { limit: 10, now: 1_000 + SETTLE_MS });
    expect(first.items.map((i) => i.path)).toEqual(['a.md']);
    at(5_000, () => {
      s.append('r1', { type: 'vault.note', path: 'b.md' });
      s.append('r1', { type: 'vault.note', path: 'c.md' });
    });
    const since = parseCursor(first.cursor!)!;
    const early = vaultActivity(s, { since, limit: 10, now: 5_000 + SETTLE_MS - 1 });
    expect(early).toEqual({ items: [], cursor: first.cursor });
    const next = vaultActivity(s, { since, limit: 1, now: 5_000 + SETTLE_MS });
    expect(next.items.map((i) => i.path)).toEqual(['b.md']);
    const rest = vaultActivity(s, { since: parseCursor(next.cursor!)!, limit: 10, now: 5_000 + SETTLE_MS });
    expect(rest.items.map((i) => i.path)).toEqual(['c.md']);
  });

  it('answers an empty log with no items and no cursor', () => {
    expect(vaultActivity(Store.open(':memory:'), { limit: 10 })).toEqual({ items: [], cursor: null });
  });

  it('serves GET /api/vault/activity with a default limit and a cap, and rejects a bad cursor', async () => {
    const srv = await startHttpTestServer();
    try {
      at(1_000, () => {
        seedRun(srv.store, 'r1');
        for (let i = 0; i < 260; i++) srv.store.append('r1', { type: 'vault.note', path: `n${i}.md` });
      });
      const r = await srv.api('GET', '/api/vault/activity');
      expect(r.status).toBe(200);
      expect(r.json.items).toHaveLength(VAULT_ACTIVITY_LIMIT);
      expect(r.json.items[0]).toMatchObject({ runId: 'r1', path: 'n259.md' });
      expect((await srv.api('GET', '/api/vault/activity?limit=999')).json.items).toHaveLength(VAULT_ACTIVITY_MAX);
      expect((await srv.api('GET', '/api/vault/activity?limit=abc')).json.items).toHaveLength(VAULT_ACTIVITY_LIMIT);
      const bad = await srv.api('GET', '/api/vault/activity?since=nope');
      expect(bad.status).toBe(400);
      expect(bad.json.error).toMatch(/cursor/);
    } finally {
      await srv.close();
    }
  });
});
