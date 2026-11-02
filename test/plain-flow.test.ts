import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { tmp } from './helpers.js';

/** Edits hw3.py in whatever folder it is given; talks otherwise. */
class Hw3 implements AgentAdapter {
  readonly id = 'hw3';
  readonly reportsCost = true;
  readonly supportsResume = false;
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    if (!req.readOnly) writeFileSync(join(req.cwd, 'hw3.py'), 'print("done")\n');
    return { output: 'Fixed it.', exitCode: 0, costUsd: 0 };
  }
}

describe('a ticket in a plain folder', () => {
  it('runs, lands, undoes and lands again, and the folder never gains Tether files', async () => {
    const home = tmp('home-');
    const folder = join(tmp('docs-'), 'Masters HW');
    mkdirSync(folder);
    writeFileSync(join(folder, 'hw3.py'), 'print("start")\n');
    initWorkspace(home, folder, { id: 'hw', name: 'Masters HW', write: false });
    for (const b of ['coder', 'tester', 'reviewer', 'planner']) link(home, b, { agent: 'hw3' });
    const registry = new AdapterRegistry().register(new MockAdapter()).register(new Hw3());
    const store = Store.open(':memory:');
    const vault = new Vault(tmp('vault-'));
    const engine = new Engine(store, { home, registry, vault, bindings: () => loadBindings(home) });
    const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    const u = new URL(s.url);
    const call = (method: string, path: string, body?: unknown) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        const q = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, 'content-type': 'application/json' } }, (res) => {
          let t = '';
          res.on('data', (d) => (t += d));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, json: t ? JSON.parse(t) : undefined }));
        });
        q.on('error', reject);
        q.end(body === undefined ? undefined : JSON.stringify(body));
      });
    const until = async <T>(f: () => Promise<T | undefined | false>): Promise<T> => {
      for (let i = 0; i < 400; i++) {
        const v = await f();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('timed out');
    };
    const hw3 = () => readFileSync(join(folder, 'hw3.py'), 'utf8');
    const ticket = async () => (await call('GET', '/api/tickets')).json.find((t: { workspace: string }) => t.workspace === 'hw');
    try {
      const squad = (await call('POST', '/api/squads', { name: 'Homework', place: 'tether', project: 'hw', agents: ['coder', 'reviewer', 'tester', 'planner'] })).json;
      expect((await call('POST', `/api/squads/${squad.id}/messages`, { text: '@Bolt fix hw3.py' })).status).toBe(201);
      await until(async () => (await call('GET', `/api/squads/${squad.id}`)).json.messages.some((m: any) => m.card?.kind === 'approval' && m.card.status === 'pending'));
      const t = await ticket();
      expect(hw3()).toBe('print("start")\n');

      const ship = await call('POST', `/api/tickets/${t.id}/ship`);
      expect(ship.status, JSON.stringify(ship.json)).toBe(200);
      await until(async () => (await ticket())?.stage === 'done');
      expect(hw3()).toBe('print("done")\n');
      expect(readdirSync(folder)).toEqual(['hw3.py']);

      const runId = t.items[0].runId;
      expect((await call('POST', `/api/runs/${runId}/undo-land`)).status).toBe(200);
      expect(hw3()).toBe('print("start")\n');
      expect((await ticket()).stage).toBe('in_review');
      expect(readdirSync(folder)).toEqual(['hw3.py']);

      expect((await call('POST', `/api/tickets/${t.id}/ship`)).status).toBe(200);
      await until(async () => (await ticket())?.stage === 'done');
      expect(hw3()).toBe('print("done")\n');
      expect(readdirSync(folder)).toEqual(['hw3.py']);
    } finally {
      await s.close();
    }
  });
});
