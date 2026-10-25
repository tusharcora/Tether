import { request } from 'node:http';
import { link, loadBindings } from '../src/bindings.js';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, tmp } from './helpers.js';

/** A real server on port 0 with a registered workspace (a git repo) whose bots run on the mock adapter. */
export async function startHttpTestServer(o: { register?: boolean } = {}) {
  const home = tmp('home-');
  const dir = makeRepo();
  if (o.register !== false) initWorkspace(home, dir, { id: 'api', name: 'API' });
  for (const bot of ['coder', 'planner', 'reviewer', 'orchestrator']) link(home, bot, { agent: 'mock' });
  const mock = new MockAdapter();
  const registry = new AdapterRegistry().register(mock);
  const store = Store.open(':memory:');
  const vault = new Vault(tmp('vault-'));
  const engine = new Engine(store, { home, registry, vault, bindings: () => loadBindings(home) });
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0 });
  const api = (method: string, path: string, body?: unknown) =>
    new Promise<{ status: number; json: any; text: string }>((resolve, reject) => {
      const u = new URL(s.url);
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      });
      req.on('error', reject);
      req.end(data);
    });
  return { base: s.url, home, dir, store, engine, mock, api, close: s.close };
}

export const enc = encodeURIComponent;
