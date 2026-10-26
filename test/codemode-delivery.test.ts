import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, ClaudeAdapter, OpenAICompatAdapter } from '../src/adapters/index.js';
import { CliAdapter, codexSpec, customSpec, opencodeSpec } from '../src/adapters/cli.js';
import { applyBindings } from '../src/bindings.js';
import { CLAUDE_TOOL, codexCodeModeArgs } from '../src/codemode/delivery.js';
import { CodeModeHost } from '../src/codemode/host.js';
import { CODE_MODE_NOTE } from '../src/codemode/prompt.js';
import { CodeSession } from '../src/codemode/session.js';
import { approvedUpstream, openStepCodeMode } from '../src/codemode/step.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import type { AgentAdapter, AgentRequest, AgentResult, CodeModeRequest, RunState } from '../src/types.js';
import { makeRepo, pipe, tmp } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.unstubAllEnvs();
});

const newSession = (o: Partial<ConstructorParameters<typeof CodeSession>[0]> = {}) => {
  const s = new CodeSession({ home: tmp('home-'), runId: 'r1', nodeId: 'plan', bot: 'Scout', workdir: makeRepo(), writable: false, kind: 'workflow', approved: false, grants: [], handoff: false, ...o }, { exec: async () => ({ code: 0, stdout: '[]', stderr: '' }) });
  cleanups.push(() => s.close());
  return s;
};

describe("Tether's Code Mode MCP server", () => {
  it('lists exactly one tool, run_code, and runs a script end to end over stdio through the host', async () => {
    const host = new CodeModeHost();
    cleanups.push(() => host.stop());
    const session = newSession();
    writeFileSync(join(session.info.workdir, 'limits.ts'), 'export const LIMIT = 10;\n');
    const { launch, close } = await host.open(session);
    cleanups.push(close);
    const file = launch.args[launch.args.indexOf('--session') + 1]!;
    expect(readFileSync(file, 'utf8')).toContain('"token"');
    expect(readFileSync(file, 'utf8')).toContain('codemode.search');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    // the token rides in the 0600 file only: never on the command line or in the environment
    const token = JSON.parse(readFileSync(file, 'utf8')).token as string;
    expect(JSON.stringify(launch)).not.toContain(token);

    const entry = launch.args[launch.args.indexOf('--session') - 1]!;
    expect(entry).toMatch(/mcpMain\.ts$/);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', entry, '--session', file], cwd: ROOT, stderr: 'ignore' }));
    cleanups.push(() => client.close());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['run_code']);
    expect(tools[0]!.description).toMatch(/- repo: /);
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object', required: ['code'] });
    // a read-only step's run_code is read-only too, so Claude Code's plan mode lets it run
    expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    const r = (await client.callTool({ name: 'run_code', arguments: { code: 'const files = await repo.list(); const hits = await repo.search("LIMIT"); return { files, hit: hits[0].path };' } })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0]!.text)).toEqual({ files: ['limits.ts', 'README.md'], hit: 'limits.ts' });
    expect(session.metrics).toEqual({ runCode: 1, connectorCalls: 2 });
    const bad = (await client.callTool({ name: 'read_file', arguments: {} })) as { content: { text: string }[]; isError?: boolean };
    expect(bad.isError).toBe(true);
    // a closed session's token stops working
    close();
    const after = (await client.callTool({ name: 'run_code', arguments: { code: 'return 1' } })) as { content: { text: string }[]; isError?: boolean };
    expect(after.isError).toBe(true);
    expect(after.content[0]!.text).toMatch(/unknown or finished session/);
  }, 30_000);

  it('refuses another Host, a browser Origin and a wrong token', async () => {
    const host = new CodeModeHost();
    cleanups.push(() => host.stop());
    const { launch, close } = await host.open(newSession());
    cleanups.push(close);
    const s = JSON.parse(readFileSync(launch.args[launch.args.indexOf('--session') + 1]!, 'utf8')) as { url: string; token: string };
    const post = (headers: Record<string, string>) => fetch(`${s.url}/run`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ code: 'return 1' }) });
    expect((await post({ authorization: `Bearer ${s.token}` })).status).toBe(200);
    expect((await post({ authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${s.token}`, origin: 'https://evil.example' })).status).toBe(403);
  });
});

/** A stand-in `claude` on PATH: logs its argv and the MCP config it was handed, prints a stream-json init and result. */
function fakeClaude(): { dir: string; log: string } {
  const dir = tmp('bin-');
  const log = join(dir, 'log.json');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const i = a.indexOf('--mcp-config');
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: a, config: i >= 0 ? fs.readFileSync(a[i + 1], 'utf8') : null }));
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', tools: ['Read', 'Edit', '${CLAUDE_TOOL}'] }));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: '${CLAUDE_TOOL}', input: { code: 'return 1' } }] } }));
console.log(JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0.01, num_turns: 2, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } }));
`;
  writeFileSync(join(dir, 'claude'), script.replace('#!/usr/bin/env node', `#!${process.execPath}`));
  chmodSync(join(dir, 'claude'), 0o755);
  return { dir, log };
}

const codeModeReq = (dir: string, readsOnly = false): CodeModeRequest => ({ runner: { runCode: async () => ({ text: '', isError: false }), description: () => 'd' }, note: CODE_MODE_NOTE, mcp: { command: '/usr/bin/node', args: ['/t/mcpMain.js', '--session', '/t/s.json'], dir }, ...(readsOnly ? { readsOnly } : {}) });
const baseReq = (o: Partial<AgentRequest>): AgentRequest => ({ runId: 'r', nodeId: 'n', prompt: 'hi', cwd: makeRepo(), readOnly: true, attempt: 1, timeoutMs: 30_000, signal: new AbortController().signal, onChunk: () => {}, onSession: () => {}, ...o });

describe('claude.ts per-run MCP config', () => {
  it('passes --mcp-config (written in the step folder), --strict-mcp-config, allows run_code and appends the note; HOME untouched', async () => {
    const { dir, log } = fakeClaude();
    const home = tmp('fakehome-');
    vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
    vi.stubEnv('HOME', home);
    const step = tmp('cm-');
    const chunks: string[] = [];
    const r = await new ClaudeAdapter().run(baseReq({ codeMode: codeModeReq(step), onChunk: (t) => chunks.push(t) }));
    const { argv, config } = JSON.parse(readFileSync(log, 'utf8')) as { argv: string[]; config: string };
    expect(argv.slice(argv.indexOf('--mcp-config'), argv.indexOf('--mcp-config') + 2)).toEqual(['--mcp-config', join(step, 'mcp.json')]);
    expect(argv).toContain('--strict-mcp-config');
    expect(argv.slice(argv.indexOf('--allowedTools'), argv.indexOf('--allowedTools') + 2)).toEqual(['--allowedTools', 'mcp__tether__run_code']);
    expect(argv[argv.indexOf('--append-system-prompt') + 1]).toBe(CODE_MODE_NOTE);
    expect(argv).not.toContain('--disallowedTools');
    expect(JSON.parse(config)).toEqual({ mcpServers: { tether: { type: 'stdio', command: '/usr/bin/node', args: ['/t/mcpMain.js', '--session', '/t/s.json'] } } });
    expect(readdirSync(home)).toEqual([]);
    expect(chunks.join('')).toContain('[code mode] MCP tools: mcp__tether__run_code');
    expect(r.usage).toEqual({ inputTokens: 150, outputTokens: 20, turns: 2, toolCalls: 1 });
  });

  it('with "Code Mode only for reading" also passes --disallowedTools Grep Glob; direct passes none of it', async () => {
    const { dir, log } = fakeClaude();
    vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
    await new ClaudeAdapter().run(baseReq({ codeMode: codeModeReq(tmp('cm-'), true) }));
    let argv = (JSON.parse(readFileSync(log, 'utf8')) as { argv: string[] }).argv;
    expect(argv.slice(argv.indexOf('--disallowedTools'))).toEqual(['--disallowedTools', 'Grep', 'Glob']);
    await new ClaudeAdapter().run(baseReq({}));
    argv = (JSON.parse(readFileSync(log, 'utf8')) as { argv: string[] }).argv;
    for (const f of ['--mcp-config', '--strict-mcp-config', '--allowedTools', '--append-system-prompt', '--disallowedTools']) expect(argv).not.toContain(f);
  });
});

describe('cli.ts per-run routes', () => {
  it('Codex gets -c mcp_servers.tether.* overrides; OpenCode and custom CLIs fall back to direct', () => {
    const cm = { ...codeModeReq('/tmp/x'), mcp: { command: '/usr/bin/node', args: ['/t/m.js', '--session', '/t/s.json'], env: { ELECTRON_RUN_AS_NODE: '1' }, dir: '/tmp/x' } };
    expect(codexSpec.buildArgs(baseReq({ codeMode: cm, cwd: '/r' }), 'p')).toEqual(['exec', '--sandbox', 'read-only', '-c', 'mcp_servers.tether.command="/usr/bin/node"', '-c', 'mcp_servers.tether.args=["/t/m.js","--session","/t/s.json"]', '-c', 'mcp_servers.tether.env={ ELECTRON_RUN_AS_NODE = "1" }', '-']);
    expect(codexCodeModeArgs(undefined)).toEqual([]);
    expect(new CliAdapter(codexSpec).codeMode).toBe('mcp');
    expect(new CliAdapter(opencodeSpec).codeMode).toBeUndefined();
    expect(new CliAdapter(customSpec('gemini', { command: 'gemini' })).codeMode).toBeUndefined();
  });
});

describe('openai.ts native run_code', () => {
  it('offers only run_code, answers one call in-process, and reports tokens and round-trips', async () => {
    const bodies: { tools?: { function: { name: string } }[]; messages: { role: string; content: string | null }[] }[] = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw);
        bodies.push(body);
        const json = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
        if (bodies.length === 1) return json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_code', arguments: JSON.stringify({ code: 'const f = await repo.list(); const h = await repo.search("fixture"); return { f, n: h.length };' }) } }] } }], usage: { prompt_tokens: 300, completion_tokens: 40 } });
        json({ choices: [{ message: { role: 'assistant', content: 'README is the only file.' } }], usage: { prompt_tokens: 380, completion_tokens: 12 } });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    const port = (server.address() as { port: number }).port;
    const session = newSession();
    const r = await new OpenAICompatAdapter('local', { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' }).run(baseReq({ cwd: session.info.workdir, codeMode: { runner: session, note: CODE_MODE_NOTE } }));
    expect(r.output).toBe('README is the only file.');
    expect(bodies[0]!.tools!.map((t) => t.function.name)).toEqual(['run_code']);
    expect(bodies[0]!.messages[0]!.content).toContain(CODE_MODE_NOTE);
    expect(JSON.parse(bodies[1]!.messages.at(-1)!.content!)).toEqual({ f: ['README.md'], n: 1 });
    expect(r.usage).toEqual({ inputTokens: 680, outputTokens: 52, toolCalls: 1, turns: 2 });
    expect(session.metrics).toEqual({ runCode: 1, connectorCalls: 2 });
  });
});

/** A test adapter that takes Code Mode natively and runs one script through the runner it is handed. */
class ScriptAdapter implements AgentAdapter {
  readonly id = 'script';
  readonly reportsCost = false;
  readonly supportsResume = false;
  readonly codeMode = 'native' as const;
  calls: AgentRequest[] = [];
  constructor(private readonly code: string) {}
  async detect() {
    return { ok: true };
  }
  async run(req: AgentRequest): Promise<AgentResult> {
    this.calls.push(req);
    const out = req.codeMode ? await req.codeMode.runner.runCode(this.code) : { text: 'direct' };
    return { output: out.text, exitCode: 0, usage: { inputTokens: 10, outputTokens: 5, toolCalls: req.codeMode ? 1 : 3 } };
  }
}

describe('the engine with Code Mode', () => {
  const run = async (code: string, node: Record<string, unknown> = {}) => {
    const adapter = new ScriptAdapter(code);
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home: tmp('home-'), registry: new AdapterRegistry().register(adapter) });
    const id = await engine.start({ pipeline: pipe([{ id: 'look', role: 'planner', agent: 'script', readOnly: true, ...node }], []), task: 't', repo: makeRepo(), workspace: false });
    const s = await engine.wait(id);
    return { adapter, s, events: store.events(id).map((e) => e.event) };
  };

  it('gives a step run_code by default, records its metrics on the timeline, and puts notes in the run log', async () => {
    const { adapter, s, events } = await run('await tether.note("checked the files"); return (await repo.list()).length');
    expect(s.status).toBe('done');
    expect(adapter.calls[0]!.codeMode?.note).toBe(CODE_MODE_NOTE);
    expect(adapter.calls[0]!.codeMode?.mcp).toBeUndefined();
    expect(events.find((e) => e.type === 'node.metrics')).toEqual({ type: 'node.metrics', node: 'look', toolStyle: 'code', runCode: 1, connectorCalls: 2, roundTrips: 1, inputTokens: 10, outputTokens: 5 });
    expect(events.some((e) => e.type === 'node.chunk' && e.text.includes('[note] checked the files'))).toBe(true);
  });

  it('leaves a direct step as it was (no runner), and still measures it', async () => {
    const { adapter, events } = await run('return 1', { toolStyle: 'direct' });
    expect(adapter.calls[0]!.codeMode).toBeUndefined();
    expect(events.find((e) => e.type === 'node.metrics')).toEqual({ type: 'node.metrics', node: 'look', toolStyle: 'direct', runCode: 0, connectorCalls: 0, roundTrips: 3, inputTokens: 10, outputTokens: 5 });
  });

  it('takes the tool style from the bot when the step names none, and the step’s own over it', () => {
    const p = pipe([{ id: 'a', role: 'planner' }, { id: 'b', role: 'planner', toolStyle: 'code' }], []);
    const bound = applyBindings(p, { planner: { agent: 'claude', toolStyle: 'direct', codeReads: true } });
    expect(bound.nodes.map((n) => [n.toolStyle, n.codeReads])).toEqual([
      ['direct', true],
      ['code', true],
    ]);
  });
});

describe('a step’s Code Mode session', () => {
  const state = (o: Partial<RunState> = {}): RunState =>
    ({ id: 'r1', kind: 'team', workdir: makeRepo(), baseSha: 'HEAD', autoApprove: false, userAsks: [], nodes: { gate: { status: 'done' }, code: { status: 'pending' } }, pipeline: { nodes: [{ id: 'gate', kind: 'approval' }, { id: 'code', kind: 'agent', role: 'coder' }], edges: [], settings: {} }, ...o }) as unknown as RunState;

  it('carries the session’s questions and approvals back as @ASK user: lines on the answer (once)', async () => {
    const st = state();
    const cm = await openStepCodeMode({ host: new CodeModeHost(), adapter: new ScriptAdapter(''), node: st.pipeline.nodes[1]!, state: st, home: tmp('home-'), store: Store.open(':memory:'), onNote: () => {} });
    cleanups.push(() => cm.close());
    await cm.request!.runner.runCode('await tether.ask("Which region?", { options: ["eu", "us"] }); return 1');
    const r = cm.record({ output: 'Waiting on the region.', exitCode: 0 });
    expect(r.output).toBe('Waiting on the region.\n@ASK user: Which region? | options: eu; us');
    expect(cm.record({ output: 'again', exitCode: 0 }).output).toBe('again');
  });

  it('counts an approved approval step before this one as approval, and an unanswered or later one not', () => {
    const before = state({ pipeline: { nodes: [{ id: 'gate', kind: 'approval' }, { id: 'code', kind: 'agent' }], edges: [{ from: 'gate', to: 'code' }], settings: {} } as never });
    expect(approvedUpstream(before, 'code')).toBe(true);
    expect(approvedUpstream({ ...before, nodes: { gate: { status: 'awaiting' } } } as never, 'code')).toBe(false);
    expect(approvedUpstream(state(), 'code')).toBe(false);
  });

  it('opens nothing (direct) for an agent without a Code Mode route, and says it fell back', async () => {
    const plain: AgentAdapter = { id: 'plain', reportsCost: false, supportsResume: false, detect: async () => ({ ok: true }), run: async () => ({ output: '', exitCode: 0 }) };
    const st = state();
    const cm = await openStepCodeMode({ host: new CodeModeHost(), adapter: plain, node: st.pipeline.nodes[1]!, state: st, home: tmp('home-'), store: Store.open(':memory:'), onNote: () => {} });
    expect([cm.toolStyle, cm.fallback, cm.request]).toEqual(['direct', true, undefined]);
    expect(cm.metrics('code')).toBeUndefined();
    cm.record({ output: '', exitCode: 0, usage: { inputTokens: 5, toolCalls: 2 } });
    expect(cm.metrics('code')).toEqual({ type: 'node.metrics', node: 'code', toolStyle: 'direct', fallback: true, runCode: 0, connectorCalls: 0, roundTrips: 2, inputTokens: 5 });
  });
});

it('never writes outside its own temp folder for a step (no global CLI config)', async () => {
  const host = new CodeModeHost();
  cleanups.push(() => host.stop());
  const { launch, close } = await host.open(newSession());
  expect(existsSync(launch.dir)).toBe(true);
  expect(readdirSync(launch.dir)).toEqual(['session.json']);
  close();
  expect(existsSync(launch.dir)).toBe(false);
});
