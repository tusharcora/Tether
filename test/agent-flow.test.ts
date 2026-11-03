import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { trustState } from '../src/trust.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { plainFolder, tmp } from './helpers.js';

const route = { task: 'Fix hw3.py', recommend: 'solo', rows: [{ kind: 'solo', why: 'One job in one place', cost: 'about 8k tokens' }] };

/** The chat turn answers with a route block; a writing step edits hw3.py. */
class Hw3 implements AgentAdapter {
  readonly id = 'hw3';
  readonly reportsCost = false;
  readonly supportsResume = false;
  readonly codeMode = 'native' as const;
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.readOnly) return { output: `I'd fix it.\n\`\`\`tether\n${JSON.stringify({ route })}\n\`\`\``, exitCode: 0 };
    writeFileSync(join(req.cwd, 'hw3.py'), 'print("done")\n');
    return { output: 'Fixed it.', exitCode: 0 };
  }
}

describe('chat to folder and back', () => {
  it('asks in chat, trusts the folder, does it, lands, undoes', async () => {
    const home = tmp('home-');
    const folder = realpathSync(plainFolder({ 'hw3.py': 'print("start")\n' }));
    initWorkspace(home, folder, { id: 'hw', name: 'Masters HW', write: false });
    for (const b of ['orchestrator', 'coder']) link(home, b, { agent: 'hw3' });
    const registry = new AdapterRegistry().register(new Hw3());
    const store = Store.open(':memory:');
    const vault = new Vault(tmp('vault-'));
    const engine = new Engine(store, { home, registry, vault, bindings: () => loadBindings(home) });
    const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0 });
    const u = new URL(s.url);
    const call = (method: string, path: string, body?: unknown) =>
      new Promise<{ status: number; text: string; json: any }>((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const q = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
          let text = '';
          res.on('data', (d) => (text += d));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text, json: res.headers['content-type']?.includes('json') && text ? JSON.parse(text) : undefined }));
        });
        q.on('error', reject);
        q.end(data);
      });
    const until = async <T>(f: () => T | undefined | false | Promise<T | undefined | false>): Promise<T> => {
      for (let i = 0; i < 400; i++) {
        const v = await f();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('timed out');
    };
    const hw3 = () => readFileSync(join(folder, 'hw3.py'), 'utf8');
    try {
      const r = await call('POST', '/api/assistant', { ws: 'hw', message: 'fix hw3.py' });
      const events = r.text.split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')));
      const chat = events.find((e) => e.type === 'start').chat as string;
      const card = events.find((e) => e.type === 'done').message.route;
      expect(card).toMatchObject({ status: 'proposed', recommend: 'solo' });

      const ask = await call('POST', `/api/assistant/routes/${card.id}`, { ws: 'hw', chat, choice: 'solo' });
      expect(ask.json).toEqual({ needsTrust: true, folder });
      expect(ask.status).toBe(409);
      expect(store.list()).toHaveLength(0);
      expect(trustState(home, folder)).toBe('unknown');

      const go = await call('POST', `/api/assistant/routes/${card.id}`, { ws: 'hw', chat, choice: 'solo', trust: true });
      expect(go.status, go.text).toBe(200);
      expect(trustState(home, folder)).toBe('trusted');
      const runId = go.json.route.runId as string;
      await until(() => store.state(runId)?.ship?.landed);
      expect(store.state(runId)).toMatchObject({ status: 'done', solo: true, history: expect.any(String) });
      expect(hw3()).toBe('print("done")\n');
      for (const n of ['.git', '.aorch', '.tether']) expect(existsSync(join(folder, n))).toBe(false);

      expect((await call('POST', `/api/runs/${runId}/undo-land`)).status).toBe(200);
      expect(hw3()).toBe('print("start")\n');
      expect(readdirSync(folder)).toEqual(['hw3.py']);
    } finally {
      await s.close();
    }
  });
});
