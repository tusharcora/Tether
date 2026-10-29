import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/adapters/index.js';
import { link, loadBindings } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import { deleteChat, listChats, loadAllow, readChat, saveChat as saveChatFile } from '../src/assistant/history.js';
import { checkCards } from '../src/assistant/reply.js';
import { builtinStep, runTurn } from '../src/assistant/turn.js';
import { setSecret } from '../src/http/secrets.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import type { AgentAdapter, AgentRequest, AgentResult, AgentUsage } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import type { ChatMessage, StreamEvent } from '../src/assistant/types.js';
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
  usage?: AgentUsage;
  /** The agent's own tool calls to report (Claude's Read, Grep…), with the call's id and what it returned. */
  ownTools: [string, unknown, string?, string?][] = [];
  async detect() {
    return { ok: true };
  }
  async listModels() {
    return ['m1', 'm2'];
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.prompts.push(req.prompt);
    if (this.script && req.codeMode) await req.codeMode.runner.runCode(this.script);
    for (const [name, input, id, result] of this.ownTools) {
      req.onTool?.(name, input, id);
      if (id && result !== undefined) req.onToolResult?.(id, result, false);
    }
    for (const part of this.reply.match(/[\s\S]{1,7}/g) ?? []) req.onDelta?.(part);
    return { output: this.reply, exitCode: 0, costUsd: 0.001, ...(this.usage ? { usage: this.usage } : {}) };
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
  // OpenRouter's models list (context sizes) is faked: a 1M free model, never the network
  const orModels = { data: [{ id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron (free)', context_length: 1_000_000, supported_parameters: ['tools'] }] };
  const s = await startServer({ engine, store, vault, registry, cfg: { home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, openrouter: { fetch: (async () => new Response(JSON.stringify(orModels))) as typeof fetch } });
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
    const start = events.find((e) => e.type === 'start') as Extract<StreamEvent, { type: 'start' }> | undefined;
    return { events, start, chat: start?.chat, done: events.find((e) => e.type === 'done') as Extract<StreamEvent, { type: 'done' }> | undefined, status: r.status };
  };
  return { home, dir, agent, registry, store, engine, vault, call, turn };
}

describe('the agent’s own tools in the timeline', () => {
  it('maps Claude’s built-in calls to the Code Mode call they match, and leaves out run_code and unknown tools', () => {
    expect(builtinStep('Read', { file_path: '/repo/src/a.ts' }, '/repo')).toBe('repo.read("src/a.ts")');
    expect(builtinStep('Grep', { pattern: 'runTurn' }, '/repo')).toBe('repo.search("runTurn")');
    expect(builtinStep('Glob', { pattern: 'test/**/*.ts' }, '/repo')).toBe('repo.list("test/**/*.ts")');
    expect(builtinStep('WebFetch', { url: 'https://x.dev' }, '/repo')).toBe('http.get("https://x.dev")');
    expect(builtinStep('WebSearch', { query: 'react 19' }, '/repo')).toBe('http.search("react 19")');
    expect(builtinStep('mcp__linear__list_issues', {}, '/repo')).toBe('mcp.linear.list_issues()');
    expect(builtinStep('mcp__tether__run_code', { code: 'x' }, '/repo')).toBeUndefined();
    expect(builtinStep('TodoWrite', {}, '/repo')).toBeUndefined();
    // Claude in plan mode reads through Bash
    expect(builtinStep('Bash', { command: "sed -n '1,80p' /repo/web/src/a.ts && cat src/b.ts" }, '/repo')).toBe('repo.read("web/src/a.ts"); repo.read("src/b.ts")');
    expect(builtinStep('Bash', { command: 'grep -rn "runTurn" test | head -5' }, '/repo')).toBe('repo.search("runTurn")');
    expect(builtinStep('Bash', { command: 'ls test' }, '/repo')).toBe('repo.list("test")');
    expect(builtinStep('Bash', { command: 'git diff --stat' }, '/repo')).toBe('repo.diff()');
    expect(builtinStep('Bash', { command: 'npm run typecheck' }, '/repo')).toBe('// $ npm run typecheck');
  });

  it('saves the agent’s own reads with the reply, so the timeline shows them', async () => {
    const t = await boot();
    // Claude reports paths under the folder it runs in: the project's real path (macOS temp dirs sit under /private)
    t.agent.ownTools = [['Read', { file_path: join(realpathSync(t.dir), 'src', 'limit.ts') }], ['Grep', { pattern: 'limit' }], ['TodoWrite', {}]];
    const r = await t.turn({ message: 'what is the limit?' });
    expect(r.events.filter((e) => e.type === 'tool')).toHaveLength(2);
    expect(r.done!.message.tools?.map((x) => x.code)).toEqual(['repo.read("src/limit.ts")', 'repo.search("limit")']);
  });
});

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

  it('saves what the turn sent on the reply: its parts, the reported prompt tokens and the model size', async () => {
    const t = await boot();
    t.agent.usage = { promptTokens: 4321 };
    const { done } = await t.turn({ message: 'what is the limit?' });
    const u = done!.message.context!;
    expect(u).toMatchObject({ tokens: 4321, agent: 'scripted' });
    expect(u.size).toBeUndefined();
    expect(u.parts.messages).toContainEqual(['This message', 'what is the limit?'.length]);
    expect(u.parts.tools.map(([l]) => l)).toEqual(expect.arrayContaining(['run_code', 'repo', 'tether', 'Code Mode notes']));
    // the prompt's parts add up to exactly what was sent
    const sum = (k: 'prompt' | 'memory' | 'messages') => u.parts[k].reduce((a, [, c]) => a + c, 0);
    expect(sum('prompt') + sum('memory') + sum('messages')).toBe(t.agent.prompts[0]!.length);
    // Claude's size is known; no usage reported: no tokens
    t.registry.register(new (class extends Scripted {
      override readonly id = 'claude' as never;
    })());
    link(t.home, 'orchestrator', { agent: 'claude', model: 'opus' });
    const c = await t.turn({ message: 'hi', chat: done!.message && (await t.call('GET', '/api/assistant/chats?ws=api')).json.chats[0].id });
    expect(c.done!.message.context).toMatchObject({ agent: 'claude', model: 'opus', size: 200_000 });
    expect(c.done!.message.context!.tokens).toBeUndefined();
    expect(c.done!.message.context!.parts.messages[0]).toEqual(['2 earlier messages', expect.any(Number)]);
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
    const { done, chat } = await t.turn({ message: 'please add a test' });
    const prop = done!.message.proposals![0]!;
    expect(prop.status).toBe('proposed');
    expect(t.store.list().length).toBe(0);
    const go = await t.call('POST', `/api/assistant/proposals/${prop.id}`, { ws: 'api', chat, decision: 'start' });
    expect(go.json.proposal.status).toBe('started');
    expect(go.json.proposal.runId).toBeTruthy();
    await t.call('POST', `/api/assistant/proposals/${prop.id}`, { ws: 'api', chat, decision: 'start' });
    expect(t.store.list().length).toBe(1);
    // the decision is saved with the chat
    expect((await t.call('GET', `/api/assistant?ws=api&chat=${chat}`)).json.messages.at(-1).proposals[0].status).toBe('started');
  });

  it('starts no run when a proposal is dismissed', async () => {
    const t = await boot();
    t.agent.reply = 'ok\n```tether\n{"proposals":[{"kind":"team","task":"do it"}]}\n```';
    const { done, chat } = await t.turn({ message: 'go' });
    const r = await t.call('POST', `/api/assistant/proposals/${done!.message.proposals![0]!.id}`, { ws: 'api', chat, decision: 'dismiss' });
    expect(r.json.proposal.status).toBe('dismissed');
    expect(t.store.list().length).toBe(0);
  });

  it('creates a chat with its first message, titled from it, and appends to it after', async () => {
    const t = await boot();
    const first = await t.turn({ message: 'what is the limit?\nthanks' });
    expect(first.chat).toMatch(/^c[a-z0-9]+$/);
    expect(first.start!.title).toBe('what is the limit?');
    const view = (await t.call('GET', `/api/assistant?ws=api&chat=${first.chat}`)).json;
    expect(view).toMatchObject({ id: first.chat, title: 'what is the limit?', models: ['m1', 'm2'] });
    expect(view.messages.length).toBe(2);
    // no chat named: the view of a new chat, nothing saved for it
    expect((await t.call('GET', '/api/assistant?ws=api')).json.messages).toEqual([]);
    const again = await t.turn({ message: 'and now?', chat: first.chat });
    expect(again.chat).toBe(first.chat);
    expect(readChat(t.home, 'api', first.chat!)!.messages.length).toBe(4);
    await t.turn({ message: 'another topic' });
    expect(listChats(t.home, 'api').map((c) => c.title)).toEqual(['another topic', 'what is the limit?']);
    expect(listChats(t.home, undefined)).toEqual([]);
  });

  it('refuses a bad or unknown chat id before touching a file', async () => {
    const t = await boot();
    expect((await t.call('GET', '/api/assistant?ws=api&chat=..%2Fx')).status).toBe(400);
    expect((await t.call('GET', '/api/assistant?ws=api&chat=allow')).status).toBe(400);
    expect((await t.call('GET', '/api/assistant?ws=api&chat=nope')).status).toBe(404);
    expect((await t.call('POST', '/api/assistant', { ws: 'api', chat: 'nope', message: 'x' })).status).toBe(404);
    expect((await t.call('POST', '/api/assistant', { ws: 'api', chat: 'a'.repeat(41), message: 'x' })).status).toBe(400);
    expect((await t.call('POST', '/api/assistant/proposals/p1', { ws: 'api', decision: 'start' })).status).toBe(400);
    expect((await t.call('POST', '/api/assistant/feedback/m1', { ws: 'api', chat: '../../x', value: 'up' })).status).toBe(400);
    expect(listChats(t.home, 'api')).toEqual([]);
  });

  it('does not bring back a chat deleted while its turn ran', async () => {
    const t = await boot();
    const { chat } = await t.turn({ message: 'one' });
    const run = t.agent.run.bind(t.agent);
    t.agent.run = async (req) => (deleteChat(t.home, 'api', chat!), run(req));
    const r = await t.turn({ message: 'two', chat });
    expect(r.done).toBeTruthy();
    expect(readChat(t.home, 'api', chat!)).toBeUndefined();
  });

  it('lists the chats newest first, searches them, renames and deletes one', async () => {
    const t = await boot();
    const a = await t.turn({ message: 'why did the readme run fail?' });
    t.agent.reply = 'Here is a plan.\n```tether\n{"proposals":[{"kind":"team","task":"fix it"}]}\n```';
    const b = await t.turn({ message: 'plan the teams feature' });
    const list = (await t.call('GET', '/api/assistant/chats?ws=api')).json.chats;
    expect(list.map((c: { id: string }) => c.id)).toEqual([b.chat, a.chat]);
    expect(list[0]).toMatchObject({ title: 'plan the teams feature', kind: 'needs', count: 2, last: 'Here is a plan.' });
    expect((await t.call('GET', '/api/assistant/chats?ws=api&q=README')).json.chats.map((c: { id: string }) => c.id)).toEqual([a.chat]);
    const renamed = await t.call('PATCH', `/api/assistant/chats/${a.chat}`, { ws: 'api', title: '  The README run  ' });
    expect(renamed.json.chat).toMatchObject({ id: a.chat, title: 'The README run' });
    expect((await t.call('PATCH', `/api/assistant/chats/${a.chat}`, { ws: 'api', title: ' ' })).status).toBe(400);
    expect((await t.call('PATCH', `/api/assistant/chats/${a.chat}`, { ws: 'api', title: 'x'.repeat(121) })).status).toBe(400);
    expect((await t.call('PATCH', '/api/assistant/chats/allow', { ws: 'api', title: 'x' })).status).toBe(400);
    // a rename does not move the chat up the list
    expect((await t.call('GET', '/api/assistant/chats?ws=api')).json.chats[1].title).toBe('The README run');
    expect((await t.call('DELETE', `/api/assistant/chats/${a.chat}?ws=api`)).json).toEqual({ ok: true });
    expect((await t.call('DELETE', `/api/assistant/chats/${a.chat}?ws=api`)).status).toBe(404);
    expect((await t.call('GET', '/api/assistant/chats?ws=api')).json.chats.length).toBe(1);
  });

  it('offers OpenRouter beside the bound agent, and a turn that names it runs there without the bound model', async () => {
    const t = await boot();
    link(t.home, 'orchestrator', { agent: 'scripted', model: 'm1' });
    const or = new (class extends Scripted {
      override readonly id = 'openrouter' as never;
      models: (string | undefined)[] = [];
      override async run(req: AgentRequest) {
        this.models.push(req.model);
        return super.run(req);
      }
    })();
    t.registry.register(or);
    expect((await t.call('GET', '/api/assistant?ws=api')).json.openrouter).toBe(true);
    const r = await t.turn({ message: 'hi', agent: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' });
    expect(r.done?.message.error).toBeUndefined();
    expect(or.models).toEqual(['nvidia/nemotron-3.5-super-vl:free']);
    // the ring knows the free model's size from OpenRouter's list, and that the free daily limit applies
    expect(r.done!.message.context).toMatchObject({ agent: 'openrouter', size: 1_000_000, limit: 'openrouter' });
    expect(t.agent.prompts).toHaveLength(0);
    await t.turn({ message: 'again', agent: 'openrouter' });
    expect(or.models[1]).toBeUndefined();
  }, 60_000);

  it('offers NVIDIA beside the bound agent the same way, and a turn that names it runs there', async () => {
    const t = await boot();
    link(t.home, 'orchestrator', { agent: 'scripted', model: 'm1' });
    const nv = new (class extends Scripted {
      override readonly id = 'nvidia' as never;
    })();
    expect((await t.call('GET', '/api/assistant?ws=api')).json.nvidia).toBeUndefined();
    t.registry.register(nv);
    expect((await t.call('GET', '/api/assistant?ws=api')).json).toMatchObject({ agent: 'scripted', nvidia: true });
    const r = await t.turn({ message: 'hi', agent: 'nvidia', model: 'z-ai/glm-5.3-flash' });
    expect(r.done?.message.error).toBeUndefined();
    expect(nv.prompts).toHaveLength(1);
    expect(t.agent.prompts).toHaveLength(0);
    link(t.home, 'orchestrator', { agent: 'nvidia' });
    expect((await t.call('GET', '/api/assistant?ws=api')).json.nvidia).toBeUndefined();
  }, 60_000);

  it('turns a refused outside-world call into an approval card, and remembers "always"', async () => {
    const t = await boot();
    t.agent.script = 'await github.comment("o/r", 4, "looks good"); return 1;';
    t.agent.reply = 'I could not comment yet.';
    const { done, events, chat } = await t.turn({ message: 'comment on #4' });
    expect(events.some((e) => e.type === 'tool')).toBe(true);
    const ask = done!.message.toolAsks![0]!;
    expect(ask.what).toContain('comment on o/r#4');
    expect(ask.status).toBe('pending');
    const r = await t.call('POST', `/api/assistant/tools/${ask.id}`, { ws: 'api', chat, decision: 'always' });
    expect(r.json.ask.status).toBe('always');
    expect(loadAllow(t.home, 'api')).toEqual([ask.what]);
    // "once" is for that chat's next turn only
    t.agent.script = 'await github.comment("o/r", 5, "ok"); return 1;';
    const second = await t.turn({ message: 'and #5', chat });
    const ask2 = second.done!.message.toolAsks![0]!;
    await t.call('POST', `/api/assistant/tools/${ask2.id}`, { ws: 'api', chat, decision: 'once' });
    expect(readChat(t.home, 'api', chat!)!.once.length).toBe(1);
    t.agent.script = undefined;
    await t.turn({ message: 'go on', chat });
    expect(readChat(t.home, 'api', chat!)!.once).toEqual([]);
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

describe('what the chat elements read', () => {
  it('keeps a web search’s result on its step, and no other tool’s', async () => {
    const t = await boot();
    const links = 'Web search results for query: "vitest"\n\nLinks: [{"title":"Vitest","url":"https://vitest.dev"}]';
    t.agent.ownTools = [['WebSearch', { query: 'vitest' }, 'u1', links], ['Grep', { pattern: 'x' }, 'u2', 'a.ts:1:x']];
    const { done } = await t.turn({ message: 'q' });
    expect(done!.message.tools).toEqual([{ id: 't1', code: 'http.search("vitest")', output: links }, { id: 't2', code: 'repo.search("x")' }]);
  });

  it('saves the vault notes the prompt carried, with their score and a snippet', async () => {
    const t = await boot();
    await t.vault.writeNote('limits.md', '---\ntype: decision\n---\n# Rate limits\n\nThe API rate limit is five requests a minute.\n');
    const { done } = await t.turn({ message: 'what is the rate limit?' });
    expect(done!.message.retrieved).toEqual([{ path: 'limits.md', title: expect.any(String), score: expect.any(Number), snippet: 'The API rate limit is five requests a minute.' }]);
    expect(done!.message.retrieved![0]!.score).toBeGreaterThan(0);
    expect((await t.turn({ message: 'zzz qqq' })).done!.message.retrieved).toBeUndefined();
  });

  it('keeps a thumbs down’s reasons and note, checked at the door, and drops them on thumbs up', async () => {
    const t = await boot();
    const { chat, done } = await t.turn({ message: 'q' });
    const fb = (body: Record<string, unknown>) => t.call('POST', `/api/assistant/feedback/${done!.message.id}`, { ws: 'api', chat, ...body });
    expect((await fb({ value: 'down', reasons: ['Wrong', 'Too long'], note: ' missed the config ' })).status).toBe(200);
    const saved = () => readChat(t.home, 'api', chat!)!.messages.at(-1)!;
    expect(saved()).toMatchObject({ feedback: 'down', feedbackNote: { reasons: ['Wrong', 'Too long'], note: 'missed the config' } });
    // a plain thumbs down keeps it
    await fb({ value: 'down' });
    expect(saved().feedbackNote?.reasons).toEqual(['Wrong', 'Too long']);
    for (const bad of [{ value: 'down', reasons: 'Wrong' }, { value: 'down', reasons: Array(7).fill('x') }, { value: 'down', reasons: ['x'.repeat(61)] }, { value: 'down', reasons: [''] }, { value: 'down', note: 5 }, { value: 'down', note: 'x'.repeat(1001) }, { value: 'up', reasons: ['Wrong'] }])
      expect((await fb(bad)).status, JSON.stringify(bad)).toBe(400);
    await fb({ value: 'up' });
    expect(saved().feedback).toBe('up');
    expect(saved().feedbackNote).toBeUndefined();
  });

  it('regenerates only the latest reply: the reply and its question go, the question is asked again', async () => {
    const t = await boot();
    const first = await t.turn({ message: 'one' });
    t.agent.reply = 'First answer.';
    const second = await t.turn({ message: 'two', chat: first.chat });
    t.agent.reply = 'Better answer.';
    expect((await t.call('POST', '/api/assistant', { ws: 'api', chat: first.chat, message: 'one', regenerate: first.done!.message.id })).status).toBe(409);
    expect((await t.call('POST', '/api/assistant', { ws: 'api', message: 'one', regenerate: 'x' })).status).toBe(409);
    const again = await t.turn({ message: 'two', chat: first.chat, regenerate: second.done!.message.id });
    expect(again.done!.message.text).toBe('Better answer.');
    expect(readChat(t.home, 'api', first.chat!)!.messages.map((m) => m.text)).toEqual(['one', 'Hello.', 'two', 'Better answer.']);
  });

  it('discards a stopped or failed reply and nothing else', async () => {
    const t = await boot();
    const { chat, done } = await t.turn({ message: 'q' });
    const del = (id: string, c = chat) => t.call('DELETE', `/api/assistant/messages/${id}?ws=api&chat=${c}`);
    expect((await del(done!.message.id)).status).toBe(404);
    expect((await del(done!.message.id, '..%2Fx')).status).toBe(400);
    const c = readChat(t.home, 'api', chat!)!;
    c.messages.push({ id: 'm-stop', role: 'tether', text: 'half', at: 1, error: 'Stopped.' });
    saveChatFile(t.home, 'api', c);
    expect((await del('m-stop')).status).toBe(200);
    expect(readChat(t.home, 'api', chat!)!.messages.map((m) => m.id)).toEqual(c.messages.slice(0, -1).map((m) => m.id));
  });

  it('checks the cards: real fields only, edges between listed nodes, sections counting real sources', () => {
    const cards = checkCards(
      {
        report: { title: 'Limits', sections: [{ heading: 'Now', summary: 'Five a minute', cites: [1, 1, 2, 9, 'x'] }, { summary: 'no heading' }] },
        spec: { title: 'Runtime', rows: [{ label: 'Node', value: '22', emphasis: true }, { label: 'Node', value: '20' }, { label: 'empty' }] },
        choice: { traits: ['Tests', 'Cost'], options: [{ name: 'A', headline: 'fast', traits: ['pass', false] }, { name: 'B', traits: [false, '$2', 'extra'] }, { name: 'A' }], pick: 'C', reason: 'A is cheaper' },
        diagram: { title: 'Flow', nodes: [{ id: 'a', label: 'Plan' }, { id: 'b' }, { id: 'a', label: 'dup' }], edges: [{ from: 'a', to: 'b', label: 'then' }, { from: 'a', to: 'z' }, { from: 'b', to: 'b' }] },
        timeline: [{ time: '10:42', title: 'Started', when: 'past' }, { title: 'No when' }, { title: 'Next', when: 'future', detail: 'tests' }],
      },
      2,
    );
    expect(cards).toEqual({
      report: { title: 'Limits', sections: [{ heading: 'Now', summary: 'Five a minute', sources: 2 }] },
      spec: { title: 'Runtime', rows: [{ label: 'Node', value: '22', emphasis: true }] },
      choice: { traits: ['Tests', 'Cost'], options: [{ name: 'A', headline: 'fast', traits: ['pass', false] }, { name: 'B', headline: '', traits: [false, '$2'] }], pick: '', reason: 'A is cheaper' },
      diagram: { title: 'Flow', nodes: [{ id: 'a', label: 'Plan' }, { id: 'b', label: 'b' }], edges: [{ from: 'a', to: 'b', label: 'then' }] },
      timeline: [{ time: '10:42', title: 'Started', when: 'past' }, { time: '', title: 'Next', detail: 'tests', when: 'future' }],
    });
    // a card missing what it needs is left out
    expect(checkCards({ report: { sections: [{ heading: 'x' }] }, spec: { title: 't', rows: [] }, choice: { traits: ['', 'b'], options: [{ name: 'A' }, { name: 'B' }] }, diagram: { nodes: [{ id: 'a' }] }, timeline: 'x' }, 0)).toEqual({});
  });

  it('a reply’s cards reach the saved message', async () => {
    const t = await boot();
    t.agent.reply = 'See the spec.\n```tether\n{"spec":{"title":"Runtime","rows":[{"label":"Node","value":"22"}]}}\n```';
    expect((await t.turn({ message: 'q' })).done!.message.spec).toEqual({ title: 'Runtime', rows: [{ label: 'Node', value: '22' }] });
  });
});

describe('artifacts', () => {
  it('saves a reply’s artifact in the project, keeps a reference on the message, and the next turn sees and rewrites it', async () => {
    const t = await boot();
    t.agent.reply = 'Here is the page.\n<artifact title="Landing page" kind="html">\n<!doctype html><h1>v1</h1>\n</artifact>';
    const r = await t.turn({ message: 'make a landing page' });
    expect(r.done!.message.text).toBe('Here is the page.');
    expect(r.done!.message.artifacts).toEqual([{ id: 'landing-page', version: 1, title: 'Landing page', kind: 'html' }]);
    expect(readFileSync(join(realpathSync(t.dir), '.aorch', 'artifacts', 'landing-page', 'v1.html'), 'utf8')).toBe('<!doctype html><h1>v1</h1>');
    expect(t.agent.prompts[0]).toContain('<artifact title="Short title" kind="html">');
    // the chat keeps the reference, not the content
    expect(JSON.stringify(readChat(t.home, 'api', r.chat!))).not.toContain('<h1>v1</h1>');

    t.agent.reply = 'Made it blue.\n<artifact id="landing-page" title="Landing page" kind="html">\n<h1 style="color:blue">v2</h1>\n</artifact>';
    const r2 = await t.turn({ chat: r.chat, message: 'make it blue' });
    const p = t.agent.prompts[1]!;
    expect(p).toContain('Artifacts in this chat: "Landing page" (id landing-page, html, v1)');
    expect(p).toContain('<current_artifact id="landing-page">\n<!doctype html><h1>v1</h1>\n</current_artifact>');
    expect(p).toContain('[made artifact "Landing page" v1]');
    expect(r2.done!.message.artifacts).toEqual([{ id: 'landing-page', version: 2, title: 'Landing page', kind: 'html' }]);
    expect(r2.done!.message.context!.parts.messages.map(([l]) => l)).toContain('Artifacts in this chat');

    const list = await t.call('GET', '/api/assistant/artifacts?ws=api');
    expect(list.json.artifacts.map((a: { id: string; versions: unknown[] }) => [a.id, a.versions.length])).toEqual([['landing-page', 2]]);
    const v = await t.call('GET', '/api/assistant/artifacts/landing-page?ws=api');
    expect(v.json).toMatchObject({ version: 2, content: '<h1 style="color:blue">v2</h1>', meta: { chatId: r.chat } });
    expect((await t.call('GET', '/api/assistant/artifacts/landing-page?ws=api&v=1')).json.content).toBe('<!doctype html><h1>v1</h1>');
    expect((await t.call('GET', '/api/assistant/artifacts/landing-page?ws=api&v=9')).status).toBe(404);
    expect((await t.call('GET', '/api/assistant/artifacts/landing-page?ws=api&v=x')).status).toBe(400);
    expect((await t.call('GET', `/api/assistant/artifacts/${encodeURIComponent('../x')}?ws=api`)).status).toBe(400);
    expect((await t.call('GET', '/api/assistant/artifacts?ws=nope')).status).toBe(404);
    expect((await t.call('DELETE', '/api/assistant/artifacts/landing-page?ws=api')).status).toBe(200);
    expect((await t.call('DELETE', '/api/assistant/artifacts/landing-page?ws=api')).status).toBe(404);
  });

  it('streams the artifact for the card to count, keeps a reply that is only an artifact, and saves to Tether’s home with no project', async () => {
    const t = await boot();
    t.agent.reply = '<artifact title="Notes" kind="markdown">\n# Notes\n</artifact>';
    const r = await t.turn({ message: 'notes please' });
    const streamed = r.events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
    expect(streamed).toContain('# Notes');
    expect(r.done!.message.text).toBe('');
    expect(r.done!.message.artifacts?.[0]?.id).toBe('notes');
    // no project: Tether's own folder
    const none = await t.call('POST', '/api/assistant', { message: 'notes please' });
    expect(none.status).toBe(200);
    expect(readFileSync(join(t.home, 'artifacts', 'notes', 'v1.md'), 'utf8')).toBe('# Notes');
  });

  it('a team agent’s turn has no artifact contract and saves none', async () => {
    const t = await boot();
    t.agent.reply = 'Sure.\n<artifact title="X" kind="markdown">\n# X\n</artifact>';
    const m = await runTurn(
      { home: t.home, store: t.store, engine: t.engine, registry: t.registry, vault: new Vault(tmp('vault-')), needs: () => [] },
      { ws: 'api', root: realpathSync(t.dir), body: { message: 'hi', agent: 'scripted' }, who: 'You are Bolt.', ephemeral: true },
      () => {},
      new AbortController().signal,
    );
    expect(m.text).toBe('Sure.');
    expect(m.artifacts).toBeUndefined();
    expect(t.agent.prompts.at(-1)).not.toContain('<artifact title=');
    expect(existsSync(join(realpathSync(t.dir), '.aorch', 'artifacts'))).toBe(false);
  });
});

describe('the composer’s prompts and mentions', () => {
  it('saves, lists, edits and deletes prompts per project, checked at the door', async () => {
    const t = await boot();
    const made = await t.call('POST', '/api/assistant/prompts', { ws: 'api', name: 'Explain', body: 'Explain {{file}}' });
    expect(made.json.prompt).toMatchObject({ name: 'Explain', variables: ['file'] });
    expect(readFileSync(join(realpathSync(t.dir), '.aorch', 'prompts.json'), 'utf8')).toContain('Explain {{file}}');
    expect((await t.call('GET', '/api/assistant/prompts?ws=api')).json.prompts).toHaveLength(1);
    // another project's (here: no project's) prompts are its own
    expect((await t.call('GET', '/api/assistant/prompts')).json.prompts).toEqual([]);
    const id = made.json.prompt.id as string;
    expect((await t.call('PATCH', `/api/assistant/prompts/${id}`, { ws: 'api', name: 'Explain a file' })).json.prompt.name).toBe('Explain a file');
    expect((await t.call('POST', '/api/assistant/prompts', { ws: 'api', name: '', body: 'x' })).status).toBe(400);
    expect((await t.call('PATCH', `/api/assistant/prompts/${encodeURIComponent('../x')}`, { ws: 'api', name: 'y' })).status).toBe(400);
    expect((await t.call('DELETE', `/api/assistant/prompts/${id}?ws=api`)).status).toBe(200);
    expect((await t.call('DELETE', `/api/assistant/prompts/${id}?ws=api`)).status).toBe(404);
  });

  it('an @mentioned crew bot answers on its own binding; one with no binding leaves it to Tether', async () => {
    const t = await boot();
    const r = await t.turn({ message: '@Bolt what is the limit?', bot: 'coder' });
    expect(r.done!.message.context?.agent).toBe('mock');
    expect(t.agent.prompts).toHaveLength(0);
    const r2 = await t.turn({ message: '@Lens hi', bot: 'reviewer' });
    expect(r2.done!.message.context?.agent).toBe('scripted');
    // not a bot id: ignored
    const r3 = await t.turn({ message: 'hi', bot: '../x' });
    expect(r3.done!.message.context?.agent).toBe('scripted');
  });
});

describe('an agent turn (teams)', () => {
  it('speaks as the given agent with the extra context, and saves no chat', async () => {
    const t = await boot();
    t.agent.reply = 'On it.';
    const m = await runTurn(
      { home: t.home, store: t.store, engine: t.engine, registry: t.registry, vault: new Vault(tmp('vault-')), needs: () => [] },
      { ws: 'api', root: t.dir, body: { message: 'what is the limit?', agent: 'scripted' }, who: 'You are Bolt, an agent in the team "core".', extra: '<team>\nyou: hi\n</team>', ephemeral: true },
      () => {},
      new AbortController().signal,
    );
    expect(m.text).toBe('On it.');
    const p = t.agent.prompts.at(-1)!;
    expect(p.startsWith('You are Bolt')).toBe(true);
    expect(p).not.toContain('You are Tether');
    expect(p).not.toContain('Nothing needs the person');
    expect(p).toContain('<team>\nyou: hi\n</team>');
    expect(listChats(t.home, 'api')).toEqual([]);
  });
});

describe('compaction', () => {
  /** A chat of `n` turns ("alpha-1", "alpha-2", ...), on the agent that is bound now. */
  async function chatOf(t: Awaited<ReturnType<typeof boot>>, n: number): Promise<string> {
    let chat: string | undefined;
    for (let i = 1; i <= n; i++) chat = (await t.turn({ message: `alpha-${i}`, ...(chat ? { chat } : {}) })).chat;
    return chat!;
  }

  it('folds older messages into one summary, keeps the originals and the last four, and the next prompt uses the summary', async () => {
    const t = await boot();
    const chat = await chatOf(t, 5);
    t.agent.reply = 'They tuned the limit.';
    const r = await t.call('POST', '/api/assistant/compact', { ws: 'api', chat });
    expect(r.status).toBe(200);
    const ms = r.json.messages as ChatMessage[];
    expect(ms).toHaveLength(11);
    const s = ms[6]!;
    expect(s).toMatchObject({ role: 'tether', text: 'They tuned the limit.', compact: { count: 6 } });
    expect(ms.slice(0, 6).every((m) => m.compactedBy === s.id)).toBe(true);
    expect(ms.slice(7).some((m) => m.compactedBy)).toBe(false);
    expect(s.context).toMatchObject({ about: true });
    expect(s.context!.parts.messages).toContainEqual(['Summary', 'They tuned the limit.'.length]);
    // one model call, with the folded messages in it
    expect(t.agent.prompts.at(-1)).toContain('alpha-1');
    expect(readChat(t.home, 'api', chat)!.messages).toHaveLength(11);
    t.agent.reply = 'ok';
    await t.turn({ message: 'alpha-6', chat });
    const prompt = t.agent.prompts.at(-1)!;
    expect(prompt).toContain('Summary of the earlier conversation:\nThey tuned the limit.');
    expect(prompt).not.toContain('alpha-1');
    expect(prompt).toContain('alpha-4');
  });

  it('undoes the newest compaction, keeping turns made since', async () => {
    const t = await boot();
    const chat = await chatOf(t, 5);
    await t.call('POST', '/api/assistant/compact', { ws: 'api', chat });
    await t.turn({ message: 'alpha-6', chat });
    const r = await t.call('POST', '/api/assistant/compact', { ws: 'api', chat, undo: true });
    expect(r.status).toBe(200);
    const ms = r.json.messages as ChatMessage[];
    expect(ms).toHaveLength(12);
    expect(ms.some((m) => m.compact || m.compactedBy)).toBe(false);
    expect(readChat(t.home, 'api', chat)!.messages.map((m) => m.text).filter((x) => x.startsWith('alpha'))).toEqual(['alpha-1', 'alpha-2', 'alpha-3', 'alpha-4', 'alpha-5', 'alpha-6']);
    expect((await t.call('POST', '/api/assistant/compact', { ws: 'api', chat, undo: true })).status).toBe(409);
  });

  it('changes nothing when the summary call fails, and refuses a chat too short to compact', async () => {
    const t = await boot();
    const chat = await chatOf(t, 5);
    const before = readChat(t.home, 'api', chat)!.messages;
    t.agent.run = async () => ({ output: '', exitCode: 1, error: 'model is down' });
    const r = await t.call('POST', '/api/assistant/compact', { ws: 'api', chat });
    expect(r.status).toBe(502);
    expect(r.json.error).toContain('model is down');
    expect(readChat(t.home, 'api', chat)!.messages).toEqual(before);
    const t2 = await boot();
    const c2 = await chatOf(t2, 2);
    expect((await t2.call('POST', '/api/assistant/compact', { ws: 'api', chat: c2 })).status).toBe(409);
  });

  it('compacts by itself before a turn that would fill the context, and says so in the stream', async () => {
    const t = await boot();
    const claude = new (class extends Scripted {
      override readonly id = 'claude' as never;
    })();
    t.registry.register(claude);
    link(t.home, 'orchestrator', { agent: 'claude', model: 'opus' });
    claude.usage = { promptTokens: 50_000 };
    const chat = await chatOf(t, 3);
    const calm = await t.turn({ message: 'alpha-4', chat });
    expect(calm.events.some((e) => e.type === 'compacted')).toBe(false);
    claude.usage = { promptTokens: 185_000 };
    await t.turn({ message: 'alpha-5', chat });
    claude.reply = 'Summary of alphas.';
    const full = await t.turn({ message: 'alpha-6', chat });
    const ev = full.events.find((e) => e.type === 'compacted') as Extract<StreamEvent, { type: 'compacted' }> | undefined;
    expect(ev).toBeTruthy();
    const s = ev!.messages.find((m) => m.compact)!;
    expect(s).toMatchObject({ text: 'Summary of alphas.', compact: { auto: true } });
    expect(full.done!.message.error).toBeUndefined();
    expect(readChat(t.home, 'api', chat)!.messages.filter((m) => m.compactedBy).length).toBe(s.compact!.count);
  });
});
