/** Opening Tether's home and serving the dashboard + API: shared by `tether serve`, the other CLI commands and Tether.app. */
import { join } from 'node:path';
import { loadBindings } from './bindings.js';
import { refreshCrew } from './bots.js';
import { installExamples, loadConfig, makeRegistry, type Config } from './config.js';
import { Engine } from './engine.js';
import { startServer } from './server.js';
import { Store } from './store.js';
import { Vault } from './vault.js';

export interface Ctx {
  cfg: Config;
  store: Store;
  engine: Engine;
  vault: Vault;
}

/** The home's config, crew, run store, vault and engine. */
export function openContext(flags: { home?: string; vault?: string }): Ctx {
  const cfg = loadConfig({ home: flags.home, vault: flags.vault });
  refreshCrew(cfg.home);
  const store = Store.open(join(cfg.home, 'runs.db'));
  const vault = new Vault(cfg.vault);
  const engine = new Engine(store, { home: cfg.home, registry: makeRegistry(cfg), vault, bindings: () => loadBindings(cfg.home) });
  return { cfg, store, engine, vault };
}

/**
 * Open the home and start the loopback server on `port` (0 = any free port). `stopLive` stops the runs this process is
 * driving (they keep their state and can be resumed); `close` stops the server.
 */
export async function serveTether(o: { home?: string; vault?: string; host?: string; port?: number; webDir: string; examplesDir: string }) {
  const ctx = openContext(o);
  installExamples(ctx.cfg.home, o.examplesDir);
  await ctx.vault.ensure();
  const server = await startServer({ engine: ctx.engine, store: ctx.store, vault: ctx.vault, registry: makeRegistry(ctx.cfg), cfg: ctx.cfg, host: o.host, port: o.port ?? 4177, webDir: o.webDir });
  /** Returns how many runs it stopped. */
  const stopLive = () => ctx.store.list().filter((r) => ctx.engine.isLive(r.id) && ctx.engine.stop(r.id)).length;
  return { ...ctx, url: server.url, close: server.close, stopLive };
}
