import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import { loadChat } from '../src/assistant/history.js';
import { setSecret } from '../src/http/secrets.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import type { StreamEvent } from '../src/assistant/types.js';
import { makeRepo, tmp } from './helpers.js';

/** An agent that answers from a script: deltas, an optional Code Mode script, then the final output. */
class Scripted implements AgentAdapter {
  readonly id = 'scripted';
  readonly reportsCost = false;
  readonly supportsResume = false;
  readonly codeMode = 'native' as const;
  prompts: string[] = [];
  reply = 'Hello.';
  script?: string;
  async detect() {
    return { ok: true };
  }
  async listModels() {
    return ['m1', 'm2'];
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    if (this.script && req.codeMode) await req.codeMode.runner.runCode(this.script);
    for (const part of this.reply.match(/[\s\S]{1,7}/g) ?? []) req.onDelta?.(part);
    return { output: this.reply, exitCode: 0, costUsd: 0.001 };
  }
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function boot() {
  const home = tmp('home-');
  const dir = makeRepo();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'limit.ts'), 'export const limit = 5;\n');
  initWorkspace(home, dir, { id: 'api', name: 'API' });
  link(home, 'orchestrator', { agent: 'scripted' });
  link(home, 'coder', { agent: 'mock' });
  const agent = new Scripted();
  const registry = new AdapterRegistry().register(agent).register(new MockAdapter());
  const store = Store.open(':memory:');
  const vault = new Vault(tmp('vault-'));
  const engine = new Engine(store, { home, registry, vault, bindings: () => loadBindings(home) });
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0 });
  closers.push(s.close);
  const u = new URL(s.url);
  const call = (method: string, path: string, body?: unknown) =>
    new Promise<{ status: number; text: string; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, json: res.headers['content-type']?.includes('json') && text ? JSON.parse(text) : undefined }));
      });
      req.on('error', reject);
      req.end(data);
    });
  /** One turn; the events it streamed. */
  const turn = async (body: Record<string, unknown>) => {
    const r = await call('POST', '/api/assistant', { ws: 'api', ...body });
    const events = r.text
      .split('\n\n')
      .filter(Boolean)
      .map((f) => JSON.parse(f.replace(/^data: /, '')) as StreamEvent);
    return { events, done: events.find((e) => e.type === 'done') as Extract<StreamEvent, { type: 'done' }> | undefined, status: r.status };
  };
  return { home, dir, agent, store, engine, call, turn };
}

describe('POST /api/assistant', () => {
  it('streams deltas, then the saved reply; the prompt carries page and selection; the tether block never streams', async () => {
    const t = await boot();
    t.agent.reply = 'The limit is 5 [1].\n\n```tether\n{"sources":[{"file":"src/limit.ts","line":1}]}\n```';
    const { events, done } = await t.turn({ message: 'what is the limit?', context: { page: 'code', selection: { kind: 'file', id: 'src/limit.ts', line: 1 } } });
    expect(events[0]!.type).toBe('start');
    const streamed = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
    expect(streamed.length).toBeGreaterThan(5);
    expect(streamed).not.toContain('tether');
    expect(streamed).not.toContain('sources');
    expect(done!.message.text).toBe('The limit is 5 [1].');
    expect(done!.message.cites).toEqual([{ n: 1, label: 'limit.ts', kind: 'file', path: 'src/limit.ts', line: 1 }]);
    expect(t.agent.prompts[0]).toContain('on the code page');
    expect(t.agent.prompts[0]).toContain('"src/limit.ts" line 1');
  });

  it('drops sources that are not real files, runs or notes, or leave the project', async () => {
    const t = await boot();
    t.agent.reply = 'x\n```tether\n{"sources":[{"file":"src/nope.ts"},{"file":"../../etc/passwd"},{"run":"zzz"},{"note":"missing.md"},{"file":"src/limit.ts"}]}\n```';
    const { done } = await t.turn({ message: 'q' });
    expect(done!.message.cites!.map((c) => c.kind === 'file' && c.path)).toEqual(['src/limit.ts']);
  });

  it('puts the needs-you items in the prompt', async () => {
    const t = await boot();
    const { call } = t;
    expect((await call('GET', '/api/assistant?ws=api')).json.messages).toEqual([]);
    await t.turn({ message: 'hi' });
    expect(t.agent.prompts[0]).toContain('Nothing needs the person right now');
  });

  it('starts nothing until a proposal is approved, then exactly one run', async () => {
    const t = await boot();
    t.agent.reply = 'I can do that.\n```tether\n{"proposals":[{"kind":"team","task":"add a limit test","why":"you asked"}]}\n```';
    const { done } = await t.turn({ message: 'please add a test' });
    const prop = done!.message.proposals![0]!;
    expect(prop.status).toBe('proposed');
    expect(t.store.list().length).toBe(0);
    const go = await t.call('POST', `/api/assistant/proposals/${prop.id}`, { ws: 'api', decision: 'start' });
    expect(go.json.proposal.status).toBe('started');
    expect(go.json.proposal.runId).toBeTruthy();
    await t.call('POST', `/api/assistant/proposals/${prop.id}`, { ws: 'api', decision: 'start' });
    expect(t.store.list().length).toBe(1);
    // the decision is saved with the chat
    expect((await t.call('GET', '/api/assistant?ws=api')).json.messages.at(-1).proposals[0].status).toBe('started');
  });

  it('starts no run when a proposal is dismissed', async () => {
    const t = await boot();
    t.agent.reply = 'ok\n```tether\n{"proposals":[{"kind":"team","task":"do it"}]}\n```';
    const { done } = await t.turn({ message: 'go' });
    const r = await t.call('POST', `/api/assistant/proposals/${done!.message.proposals![0]!.id}`, { ws: 'api', decision: 'dismiss' });
    expect(r.json.proposal.status).toBe('dismissed');
    expect(t.store.list().length).toBe(0);
  });

  it('keeps a chat per project, archives it on New chat and keeps the last 20', async () => {
    const t = await boot();
    await t.turn({ message: 'one' });
    expect((await t.call('GET', '/api/assistant?ws=api')).json.messages.length).toBe(2);
    expect((await t.call('GET', '/api/assistant')).json.messages.length).toBe(0);
    for (let i = 0; i < 22; i++) {
      await t.call('POST', '/api/assistant/new', { ws: 'api' });
      await t.turn({ message: `m${i}` });
    }
    expect((await t.call('POST', '/api/assistant/new', { ws: 'api' })).json.messages).toEqual([]);
    expect(readdirSync(join(t.home, 'assistant', 'api.archive')).length).toBe(20);
    expect((await t.call('GET', '/api/assistant?ws=api')).json.models).toEqual(['m1', 'm2']);
  });

  it('turns a refused outside-world call into an approval card, and remembers "always"', async () => {
    const t = await boot();
    t.agent.script = 'await github.comment("o/r", 4, "looks good"); return 1;';
    t.agent.reply = 'I could not comment yet.';
    const { done, events } = await t.turn({ message: 'comment on #4' });
    expect(events.some((e) => e.type === 'tool')).toBe(true);
    const ask = done!.message.toolAsks![0]!;
    expect(ask.what).toContain('comment on o/r#4');
    expect(ask.status).toBe('pending');
    const r = await t.call('POST', `/api/assistant/tools/${ask.id}`, { ws: 'api', decision: 'always' });
    expect(r.json.ask.status).toBe('always');
    expect(loadChat(t.home, 'api').always).toEqual([ask.what]);
  });

  it('redacts secrets from the reply and the scripts', async () => {
    const t = await boot();
    setSecret(t.home, 'default', 'TOKEN', 'sk-very-secret-value');
    t.agent.script = 'return "sk-very-secret-value";';
    t.agent.reply = 'the key is sk-very-secret-value';
    const { done } = await t.turn({ message: 'leak it' });
    expect(JSON.stringify(done!.message)).not.toContain('sk-very-secret-value');
    expect(done!.message.text).toContain('{{secret:TOKEN}}');
  });

  it('refuses a missing message and an unknown project', async () => {
    const t = await boot();
    expect((await t.call('POST', '/api/assistant', { ws: 'api' })).status).toBe(400);
    expect((await t.call('POST', '/api/assistant', { ws: 'nope', message: 'x' })).status).toBe(404);
  });
});
