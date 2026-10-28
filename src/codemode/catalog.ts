/**
 * Discovery over every connector's methods: `codemode.search(query)` finds methods by name and summary, and
 * `codemode.describe(target)` gives TypeScript declarations. The run_code description names only the connectors, so the
 * context stays small however many tools (MCP servers included) sit behind them.
 */
import { signature } from './schema.js';
import type { Connector, Method } from './types.js';

export interface Found {
  path: string;
  method: Method;
}

export class Catalog {
  private loaded = new Map<string, Promise<Method[]>>();

  constructor(readonly connectors: Connector[]) {}

  /** Each connector's methods, listed once (an MCP server is started on first use). A failing connector lists none. */
  private methodsOf(c: Connector): Promise<Method[]> {
    let p = this.loaded.get(c.name);
    if (!p) {
      p = c.methods().catch(() => []);
      this.loaded.set(c.name, p);
    }
    return p;
  }

  /** The connector a path starts with (the longest name wins: `mcp.files` before `mcp`). */
  private connectorFor(path: string): Connector | undefined {
    return [...this.connectors].sort((a, b) => b.name.length - a.name.length).find((c) => path === c.name || path.startsWith(`${c.name}.`));
  }

  async find(path: string): Promise<Found | undefined> {
    const c = this.connectorFor(path);
    if (!c) return undefined;
    const name = path.slice(c.name.length + 1);
    const method = (await this.methodsOf(c)).find((m) => m.name === name);
    return method ? { path, method } : undefined;
  }

  async all(): Promise<Found[]> {
    const lists = await Promise.all(this.connectors.map(async (c) => (await this.methodsOf(c)).map((method) => ({ path: `${c.name}.${method.name}`, method }))));
    return lists.flat();
  }

  /** Methods whose path, summary or doc hold the query's words, best first: `{ name, summary }` each. */
  async search(query: string, limit = 12): Promise<{ name: string; summary: string }[]> {
    const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    const scored = (await this.all()).map((f) => {
      const name = f.path.toLowerCase();
      const text = `${f.method.summary} ${f.method.doc ?? ''}`.toLowerCase();
      const score = words.reduce((n, w) => n + (name.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0);
      return { f, score };
    });
    const hits = words.length ? scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score) : scored;
    return hits.slice(0, limit).map(({ f }) => ({ name: f.path, summary: f.method.summary }));
  }

  /** TypeScript for a method (`repo.read`), or for every method of a connector (`github`, `mcp.files`). */
  async describe(target: string): Promise<string> {
    const t = target.trim().replace(/\(\)$/, '');
    const c = this.connectors.find((x) => x.name === t);
    if (c) return [`// ${c.name}: ${c.summary}`, ...(await this.methodsOf(c)).map((m) => signature(c.name, m))].join('\n\n');
    const f = await this.find(t);
    if (f) return signature(f.path.slice(0, f.path.length - f.method.name.length - 1), f.method);
    return `Nothing is called "${t}". Connectors: ${this.connectors.map((x) => x.name).join(', ')}. Find methods with codemode.search("…").`;
  }

  /** One line per connector, for the run_code description. */
  summary(): string {
    return this.connectors.map((c) => `- ${c.name}: ${c.summary}`).join('\n');
  }

  async close(): Promise<void> {
    await Promise.all(this.connectors.map((c) => c.close?.().catch(() => undefined)));
  }
}
