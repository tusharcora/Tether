import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { OpenAICompatAdapter, safePath } from '../src/adapters/openai.js';
import { applyBindings, link, loadBindings, unlink } from '../src/bindings.js';
import { Engine } from '../src/engine.js';
import { normalizePipeline } from '../src/pipeline.js';
import { Store } from '../src/store.js';
import type { AgentAdapter, AgentRequest } from '../src/types.js';
import { makeRepo, tmp } from './helpers.js';

type Reply = { content?: string; tools?: { name: string; args: unknown }[]; status?: number; body?: string };
let server: Server;
let base = '';
let script: Reply[] = [];
const seen: { tools?: unknown; messages: { role: string; content: string | null }[]; model: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ data: [{ id: 'tiny-coder' }, { id: 'big-planner' }] }));
    }
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body);
        seen.push({ tools: j.tools, messages: j.messages, model: j.model });
        const r = script.shift() ?? { content: 'done' };
        if (r.status) {
          res.statusCode = r.status;
          return res.end(r.body ?? 'error');
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: r.content ?? null,
                  ...(r.tools ? { tool_calls: r.tools.map((t, i) => ({ id: `c${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}),
                },
              },
            ],
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => server.close());

const req = (cwd: string, o: Partial<AgentRequest> = {}): AgentRequest => ({
  runId: 'r', nodeId: 'n', prompt: 'do the task', cwd, readOnly: false, attempt: 1, timeoutMs: 20_000, signal: new AbortController().signal, onChunk: () => {}, onSession: () => {}, ...o,
});

describe('safePath', () => {
  it('keeps model-supplied paths inside the worktree', () => {
    const d = tmp('sp-');
    mkdirSync(join(d, 'sub'));
    expect(safePath(d, 'sub/a.txt')).toBe(join(d, 'sub/a.txt'));
    expect(() => safePath(d, '../x')).toThrow(/outside/);
    expect(() => safePath(d, '/etc/passwd')).toThrow(/relative/);
    expect(() => safePath(d, '.git/config')).toThrow(/\.git/);
    expect(() => safePath(d, 'sub/../../x')).toThrow(/outside/);
    const outside = tmp('out-');
    symlinkSync(outside, join(d, 'link'));
    expect(() => safePath(d, 'link/evil.txt')).toThrow(/outside/);
  });
});

describe('OpenAICompatAdapter', () => {
  it('detects a live server, lists models, and reports a dead one', async () => {
    const a = new OpenAICompatAdapter('local', { baseUrl: base });
    expect(await a.detect()).toMatchObject({ ok: true });
    expect(await a.listModels()).toEqual(['big-planner', 'tiny-coder']);
    const dead = new OpenAICompatAdapter('dead', { baseUrl: 'http://127.0.0.1:1/v1' });
    expect((await dead.detect()).ok).toBe(false);
    expect(await dead.listModels()).toEqual([]);
    const r = await dead.run(req(tmp(), { model: 'x' }));
    expect(r.exitCode).toBe(1);
    expect(r.error).toMatch(/cannot reach/);
  });

  it('runs a tool loop: reads, writes inside the worktree, then answers', async () => {
    const d = tmp('wt-');
    writeFileSync(join(d, 'notes.txt'), 'secret plan');
    script = [{ tools: [{ name: 'read_file', args: { path: 'notes.txt' } }, { name: 'write_file', args: { path: 'out/HELLO.md', content: 'hi from a local model\n' } }] }, { content: 'All done.\nVERDICT: PASS' }];
    seen.length = 0;
    const chunks: string[] = [];
    const r = await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(d, { model: 'tiny-coder', onChunk: (t) => chunks.push(t) }));
    expect(r).toMatchObject({ exitCode: 0, output: 'All done.\nVERDICT: PASS' });
    expect(readFileSync(join(d, 'out/HELLO.md'), 'utf8')).toBe('hi from a local model\n');
    expect(seen[0]!.model).toBe('tiny-coder');
    const toolMsg = seen[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(toolMsg[0]).toBe('secret plan');
    expect(chunks.join('')).toMatch(/\[tool\] write_file out\/HELLO\.md/);
  });

  it('refuses escapes and writes on read-only steps, and tells the model why', async () => {
    const d = tmp('wt-');
    script = [
      { tools: [{ name: 'write_file', args: { path: '../escape.txt', content: 'x' } }, { name: 'read_file', args: { path: '/etc/passwd' } }] },
      { content: 'ok' },
    ];
    seen.length = 0;
    await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(d, { model: 'm' }));
    const results = seen[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(results[0]).toMatch(/^error: path is outside/);
    expect(results[1]).toMatch(/^error: use paths relative/);
    expect(existsSync(join(d, '..', 'escape.txt'))).toBe(false);

    script = [{ tools: [{ name: 'write_file', args: { path: 'a.txt', content: 'x' } }] }, { content: 'fine' }];
    seen.length = 0;
    const ro = await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(d, { model: 'm', readOnly: true }));
    expect(ro.exitCode).toBe(0);
    expect(existsSync(join(d, 'a.txt'))).toBe(false);
    const names = (seen[0]!.tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).not.toContain('write_file');
  });

  it('picks the first available model when none is linked', async () => {
    script = [{ content: 'hello' }];
    seen.length = 0;
    const r = await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(tmp(), { readOnly: true }));
    expect(r.exitCode).toBe(0);
    expect(seen[0]!.model).toBe('big-planner');
  });

  it('degrades read-only steps without tool support, but fails writers clearly', async () => {
    script = [{ status: 400, body: 'model does not support tools' }, { content: 'plain answer' }];
    const ro = await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(tmp(), { model: 'm', readOnly: true }));
    expect(ro).toMatchObject({ exitCode: 0, output: 'plain answer' });
    script = [{ status: 400, body: 'model does not support tools' }];
    const rw = await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(tmp(), { model: 'm' }));
    expect(rw.exitCode).toBe(1);
    expect(rw.error).toMatch(/cannot edit files/);
  });

  it('stops when aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await new OpenAICompatAdapter('local', { baseUrl: base }).run(req(tmp(), { model: 'm', signal: ac.signal }));
    expect(r.exitCode).toBe(130);
  });
});

describe('bot bindings', () => {
  const p = normalizePipeline({
    name: 'p',
    nodes: [
      { id: 'plan', kind: 'agent', role: 'planner', readOnly: true },
      { id: 'code', kind: 'agent', role: 'coder' },
      { id: 'code2', kind: 'agent', role: 'coder', agent: 'claude' },
      { id: 'code3', kind: 'agent', role: 'coder', model: 'custom' },
      { id: 'gate', kind: 'gate', command: 'true' },
    ],
    edges: [],
  });

  it('fills agent and model from the bot; explicit settings win; a model only follows its own agent', () => {
    const out = applyBindings(p, { coder: { agent: 'ollama', model: 'qwen' }, planner: { agent: 'codex' } });
    const by = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
    expect(by.plan).toMatchObject({ agent: 'codex' });
    expect(by.plan!.model).toBeUndefined();
    expect(by.code).toMatchObject({ agent: 'ollama', model: 'qwen' });
    expect(by.code2).toMatchObject({ agent: 'claude' });
    expect(by.code2!.model).toBeUndefined(); // bolt's qwen must not leak onto a claude step
    expect(by.code3).toMatchObject({ agent: 'ollama', model: 'custom' });
    expect(by.gate!.agent).toBeUndefined();
    expect(p.nodes[1]!.agent).toBeUndefined(); // input untouched
  });

  it('persists, validates and unlinks', () => {
    const home = tmp('bh-');
    expect(loadBindings(home)).toEqual({});
    link(home, 'coder', { agent: 'ollama', model: 'qwen' });
    link(home, 'planner', { agent: 'claude' });
    expect(loadBindings(home)).toEqual({ coder: { agent: 'ollama', model: 'qwen' }, planner: { agent: 'claude' } });
    unlink(home, 'coder');
    expect(Object.keys(loadBindings(home))).toEqual(['planner']);
    expect(() => link(home, '../evil', { agent: 'x' })).toThrow(/invalid bot/);
    writeFileSync(join(home, 'bots.json'), '{"coder":{"agent":5},"Bad Name":{"agent":"x"},"lens":{"agent":"codex","model":"m"}}');
    expect(loadBindings(home)).toEqual({ lens: { agent: 'codex', model: 'm' } });
    writeFileSync(join(home, 'bots.json'), 'not json');
    expect(loadBindings(home)).toEqual({});
  });
});

describe('engine with a bot linked to a local model', () => {
  it('runs a coder step on the bound local endpoint and records the resolved agent', async () => {
    const repo = makeRepo();
    const home = tmp('home-');
    const registry = new AdapterRegistry().register(new MockAdapter()).register(new OpenAICompatAdapter('local', { baseUrl: base }));
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home, registry, bindings: () => ({ coder: { agent: 'local', model: 'tiny-coder' } }) });
    script = [{ tools: [{ name: 'write_file', args: { path: 'LOCAL.md', content: 'written by a local model\n' } }] }, { content: 'finished' }];
    seen.length = 0;
    const pipeline = normalizePipeline({
      name: 'bound',
      nodes: [{ id: 'code', kind: 'agent', role: 'coder' }, { id: 'tests', kind: 'gate', command: 'test -f LOCAL.md', fixNode: 'code' }],
      edges: [{ from: 'code', to: 'tests' }],
    });
    const id = await engine.start({ pipeline, task: 'make a file', repo });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(s.pipeline.nodes[0]).toMatchObject({ agent: 'local', model: 'tiny-coder' });
    expect(s.nodes.code!.commit).toBeTruthy();
    expect(seen[0]!.model).toBe('tiny-coder');
    expect(readFileSync(join(s.workdir, 'LOCAL.md'), 'utf8')).toBe('written by a local model\n');
  });

  it('fails preflight when a bot is linked to an agent that does not exist', async () => {
    const registry = new AdapterRegistry().register(new MockAdapter());
    const engine = new Engine(Store.open(':memory:'), { home: tmp(), registry, bindings: () => ({ coder: { agent: 'nope' } }) });
    const pipeline = normalizePipeline({ name: 'x', nodes: [{ id: 'code', kind: 'agent', role: 'coder' }], edges: [] });
    await expect(engine.start({ pipeline, task: 't', repo: makeRepo() })).rejects.toThrow(/unknown agent adapter "nope"/);
  });
});

describe('attach commands', () => {
  it('each adapter says how to reopen its session', async () => {
    const { ClaudeAdapter } = await import('../src/adapters/claude.js');
    const { CliAdapter, codexSpec, opencodeSpec, customSpec } = await import('../src/adapters/cli.js');
    expect(new ClaudeAdapter().attachCommand('abc')).toEqual({ cmd: 'claude', args: ['--resume', 'abc'] });
    expect(new ClaudeAdapter().attachCommand()).toBeUndefined();
    expect(new CliAdapter(codexSpec).attachCommand()).toEqual({ cmd: 'codex', args: ['resume', '--last'] });
    expect(new CliAdapter(opencodeSpec).attachCommand()).toEqual({ cmd: 'opencode', args: ['--continue'] });
    expect((new OpenAICompatAdapter('local', { baseUrl: base }) as AgentAdapter).attachCommand?.('x')).toBeUndefined();
    const custom = new CliAdapter(customSpec('mine', { command: 'mytool', attach: { args: ['--session', '{session}'] } }));
    expect(custom.attachCommand('s1')).toEqual({ cmd: 'mytool', args: ['--session', 's1'] });
    expect(custom.attachCommand()).toBeUndefined();
    expect(new CliAdapter(customSpec('plain', { command: 'x' })).attachCommand('s')).toBeUndefined();
  });
});
