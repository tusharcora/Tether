/**
 * Where CLI agents' run_code lands: a loopback listener in the Tether process (one per engine, started on first use).
 * Each step's session gets a random bearer token; the stdio MCP server Tether starts for the agent reads the URL and
 * token from a 0600 session file, so the token is never on a command line, in an environment or in a log. The sandbox
 * runs here, next to the engine, the store and the vault.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpLaunch } from '../types.js';
import { codeModeMcpCommand } from './launch.js';
import type { CodeSession } from './session.js';

/** What the session file holds (read by `tether codemode-mcp`). */
export interface SessionFile {
  url: string;
  token: string;
  description: string;
  /** The step may not change files: run_code is announced read-only (Claude Code's plan mode allows such tools). */
  readOnly: boolean;
}

const MAX_CODE = 200_000;

export class CodeModeHost {
  private server?: Server;
  private url?: string;
  private sessions = new Map<string, CodeSession>();

  private async start(): Promise<string> {
    if (this.url) return this.url;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    server.unref();
    this.server = server;
    this.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return this.url;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    try {
      // only this machine, by address: no other Host (DNS rebinding) and no browser Origin
      if (req.headers.host !== new URL(this.url!).host || req.headers.origin) return reply(403, { error: 'forbidden' });
      if (req.method !== 'POST' || req.url !== '/run') return reply(404, { error: 'not found' });
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const session = [...this.sessions.entries()].find(([t]) => t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token)))?.[1];
      if (!session) return reply(401, { error: 'unknown or finished session' });
      let raw = '';
      for await (const c of req) {
        raw += c;
        if (raw.length > MAX_CODE) return reply(413, { error: 'the script is too long' });
      }
      const body = JSON.parse(raw || '{}') as { code?: unknown };
      reply(200, await session.runCode(typeof body.code === 'string' ? body.code : ''));
    } catch (e) {
      reply(500, { error: (e as Error).message });
    }
  }

  /** Register a step's session: its own temp folder (0700) with the session file (0600), and how to start the MCP server. */
  async open(session: CodeSession): Promise<{ launch: McpLaunch; close: () => void }> {
    const url = await this.start();
    const token = randomBytes(24).toString('base64url');
    const dir = mkdtempSync(join(tmpdir(), 'tether-cm-'));
    const file = join(dir, 'session.json');
    writeFileSync(file, JSON.stringify({ url, token, description: session.description(), readOnly: !session.info.writable } satisfies SessionFile), { mode: 0o600 });
    this.sessions.set(token, session);
    return {
      launch: { ...codeModeMcpCommand(file), dir },
      close: () => {
        this.sessions.delete(token);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = undefined;
    this.url = undefined;
  }
}
