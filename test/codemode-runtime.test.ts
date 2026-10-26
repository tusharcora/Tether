import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Catalog } from '../src/codemode/catalog.js';
import { toolIdent } from '../src/codemode/connectors/mcp.js';
import { checkMcpServer, loadMcpServers, publicMcp, putMcpServer, removeMcpServer } from '../src/codemode/mcpServers.js';
import { execute, LIMITS, normalizeCode } from '../src/codemode/sandbox.js';
import { jsonSchemaToTs, signature } from '../src/codemode/schema.js';
import { approvalQuestion, CodeSession, grantsFrom, type SessionInfo } from '../src/codemode/session.js';
import type { Connector } from '../src/codemode/types.js';
import type { Exec } from '../src/exec.js';
import { startHttpTestServer } from './http-helpers.js';
import { makeRepo, tmp } from './helpers.js';

const FAKE_MCP = fileURLToPath(new URL('./fixtures/fake-mcp.mjs', import.meta.url));
const sessions: CodeSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
});

/** A fake `gh` that records its calls and answers JSON. */
function fakeGh() {
  const calls: { args: string[]; stdin?: string }[] = [];
  const exec: Exec = async (_cmd, args, _cwd, stdin) => {
    calls.push({ args, ...(stdin ? { stdin } : {}) });
    if (args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: JSON.stringify([{ number: 7, title: 'Fix login' }, { number: 9, title: 'Add limits' }]), stderr: '' };
    if (args[0] === 'api' && args.includes('--input')) return { code: 0, stdout: JSON.stringify({ html_url: 'https://github.com/o/r/issues/7#c1' }), stderr: '' };
    return { code: 0, stdout: '[]', stderr: '' };
  };
  return { exec, calls };
}

const session = (o: Partial<SessionInfo> = {}, deps: ConstructorParameters<typeof CodeSession>[1] = {}) => {
  const workdir = o.workdir ?? makeRepo();
  const s = new CodeSession({ home: tmp('home-'), runId: 'r1', nodeId: 'code', bot: 'Bolt', workdir, writable: false, kind: 'workflow', approved: false, grants: [], handoff: false, ...o }, { exec: fakeGh().exec, ...deps });
  sessions.push(s);
  return s;
};

describe('JSON Schema → TypeScript', () => {
  it('renders objects (required and optional, with doc comments), arrays, enums, unions, records and literals', () => {
    const ts = jsonSchemaToTs({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative to the repo' },
        from: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { enum: ['read', 'write'] },
        either: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        meta: { type: 'object', additionalProperties: { type: 'number' } },
        'odd-key': { const: 3 },
        nested: { type: 'object', properties: { deep: { type: 'boolean' } }, required: ['deep'] },
      },
      required: ['path'],
    });
    expect(ts).toBe(
      [
        '{',
        '  /** Relative to the repo */',
        '  path: string;',
        '  from?: number;',
        '  tags?: string[];',
        '  mode?: "read" | "write";',
        '  either?: string | null;',
        '  meta?: Record<string, number>;',
        '  "odd-key"?: 3;',
        '  nested?: {',
        '    deep: boolean;',
        '  };',
        '}',
      ].join('\n'),
    );
    expect(jsonSchemaToTs({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } })).toBe('Array<string | number>');
    expect(jsonSchemaToTs(undefined)).toBe('unknown');
    expect(jsonSchemaToTs({ type: ['string', 'null'] })).toBe('string | null');
  });

  it('writes a method signature with its doc', () => {
    expect(signature('repo', { name: 'read', summary: 'Read a file.', params: [{ name: 'path', schema: { type: 'string' } }, { name: 'opts', schema: { type: 'object', properties: { from: { type: 'integer' } } }, optional: true }], returns: 'string', run: async () => '' })).toBe(
      '/**\n * Read a file.\n */\nrepo.read(path: string, opts?: {\n  from?: number;\n}): Promise<string>;',
    );
  });
});

describe('codemode.search and describe', () => {
  const cat = () =>
    new Catalog([
      { name: 'repo', summary: 'files', methods: async () => [{ name: 'read', summary: 'Read a text file', run: async () => '' }, { name: 'search', summary: 'Find lines in files', run: async () => [] }] },
      { name: 'github', summary: 'GitHub', methods: async () => [{ name: 'comments', summary: 'Comments on a pull request', run: async () => [] }] },
      { name: 'mcp.broken', summary: 'a server that fails', methods: async () => Promise.reject(new Error('down')) },
    ] satisfies Connector[]);

  it('finds methods by name and summary, best first; an empty query lists them all; a broken connector lists none', async () => {
    const c = cat();
    expect((await c.search('pull request comments'))[0]).toEqual({ name: 'github.comments', summary: 'Comments on a pull request' });
    expect((await c.search('read')).map((x) => x.name)).toEqual(['repo.read']);
    expect((await c.search('')).map((x) => x.name)).toEqual(['repo.read', 'repo.search', 'github.comments']);
  });

  it('describes a connector, a method, or says what exists', async () => {
    const c = cat();
    expect(await c.describe('repo')).toMatch(/^\/\/ repo: files\n\n\/\*\*\n \* Read a text file\n \*\/\nrepo\.read\(\): Promise<unknown>;/);
    expect(await c.describe('github.comments')).toContain('github.comments(): Promise<unknown>;');
    expect(await c.describe('nope')).toMatch(/Nothing is called "nope". Connectors: repo, github, mcp.broken/);
  });
});

describe('sandbox', () => {
  const run = (code: string, limits = LIMITS) => execute(code, ['repo'], async (path, args) => ({ path, args }), limits);

  it('runs an async body with connector calls, Promise.all, console.log and a returned value', async () => {
    const r = await run('const a = await repo.read("x"); const [b, c] = await Promise.all([repo.list("y"), repo.search("z")]); console.log("seen", 3, { k: 1 }); return [a.path, b.path, c.args];');
    expect(r).toEqual({ result: ['repo.read', 'repo.list', ['z']], logs: ['seen 3 {"k":1}'], calls: 3 });
  });

  it('strips TypeScript types and calls a function expression', async () => {
    expect((await run('const n: number = 2; return n * 21;')).result).toBe(42);
    expect((await run('async () => { return "arrow"; }')).result).toBe('arrow');
    expect(normalizeCode('```ts\nreturn 1\n```')).toBe('return 1');
  });

  it('stops a CPU loop at the wall limit and a stuck await too', async () => {
    const t0 = Date.now();
    expect((await run('while (true) {}', { ...LIMITS, wallMs: 300 })).error).toBe('timed out after 0.3 s');
    expect((await run('await new Promise(() => {}); return 1', { ...LIMITS, wallMs: 300 })).error).toBe('timed out after 0.3 s');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('never blocks the server: /api/runs keeps answering while a busy loop runs out its wall time in its worker', async () => {
    const s = await startHttpTestServer();
    try {
      const looping = session({ workdir: s.dir }, { exec: fakeGh().exec, limits: { ...LIMITS, wallMs: 1500 } }).runCode('while (true) {}');
      const waits: number[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 1200) {
        const t = Date.now();
        expect((await s.api('GET', '/api/runs')).status).toBe(200);
        waits.push(Date.now() - t);
      }
      expect((await looping).text).toBe('Error: timed out after 1.5 s');
      expect(waits.length).toBeGreaterThan(5);
      expect(Math.max(...waits)).toBeLessThan(500);
    } finally {
      await s.close();
    }
  });

  it('refuses memory past the limit and connector calls past the cap', async () => {
    expect((await run("const a = []; while (true) a.push('x'.repeat(1000));", { ...LIMITS, memoryBytes: 8 * 1024 * 1024 })).error).toMatch(/out of memory/);
    const r = await run('for (let i = 0; i < 5; i++) await repo.read(String(i)); return "done";', { ...LIMITS, maxCalls: 3 });
    expect(r.error).toMatch(/connector call limit reached \(3 per run\)/);
  });

  it('has no require, process, fetch, timers or filesystem: only connectors', async () => {
    expect((await run('return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.std, typeof globalThis.os];')).result).toEqual(Array(6).fill('undefined'));
    expect((await run('await import("node:fs")')).error).toBeTruthy();
  });

  it('returns a thrown error with a short stack, and a syntax error as one', async () => {
    expect((await run('throw new Error("boom")')).error).toMatch(/^Error: boom/);
    expect((await run('return )(')).error).toMatch(/SyntaxError/);
  });
});

describe('the Code Mode session', () => {
  it('reads, lists, searches and diffs the repo; refuses .. paths and secrets files; never searches secrets', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'limits.ts'), 'export const LIMIT = 10;\n// rate limit window\n');
    writeFileSync(join(dir, '.env'), 'TOKEN=rate limit secret\n');
    const s = session({ workdir: dir });
    const r = await s.runCode('const files = await repo.list(); const hits = await repo.search("rate limit"); const line = await repo.read("limits.ts", { from: 2, to: 2 }); return { files, hits, line };');
    expect(r.isError).toBe(false);
    const v = JSON.parse(r.text);
    expect(v.files).toEqual(['.env', 'limits.ts', 'README.md']);
    expect(v.hits).toEqual([{ path: 'limits.ts', line: 2, text: '// rate limit window' }]);
    expect(v.line).toBe('// rate limit window');
    expect((await s.runCode('return await repo.read("../etc/passwd")')).text).toMatch(/Error: .*leaves the project folder/);
    expect((await s.runCode('return await repo.read(".env")')).text).toMatch(/secrets file/);
    expect((await s.runCode('return await repo.diff()')).text).toBe('(no changes)');
    expect(s.metrics).toEqual({ runCode: 4, connectorCalls: 6 });
  });

  it('writes only on a writable step', async () => {
    const ro = session();
    expect((await ro.runCode('return await repo.write("a.txt", "x")')).text).toMatch(/changes files, and this step is read-only/);
    expect(existsSync(join(ro.info.workdir, 'a.txt'))).toBe(false);
    const rw = session({ writable: true });
    expect((await rw.runCode('return await repo.write("src/a.txt", "hello")')).text).toBe('wrote src/a.txt (5 characters)');
    expect(readFileSync(join(rw.info.workdir, 'src/a.txt'), 'utf8')).toBe('hello');
    expect((await rw.runCode('return await repo.write(".env", "x")')).text).toMatch(/secrets file/);
  });

  it('tether.ask ends a team step as a question (an @ASK user: line); a workflow has nobody to ask', async () => {
    const team = session({ kind: 'team' });
    const r = await team.runCode('return await tether.ask("Which region?", { options: ["eu", "us"], recommended: "eu" })');
    expect(r.text).toMatch(/Asked the person/);
    expect(r.text).toMatch(/end your answer now/);
    expect(team.followUps()).toBe('@ASK user: Which region? | options: eu; us | recommended: eu');
    const flow = session();
    expect((await flow.runCode('return await tether.ask("Which region?")')).text).toMatch(/nobody to ask in a workflow run/);
    expect(flow.followUps()).toBe('');
  });

  it('notes go to the run log, hand-offs only where the step allows them', async () => {
    const notes: string[] = [];
    const s = session({ handoff: true }, { onNote: (t) => notes.push(t), exec: fakeGh().exec });
    await s.runCode('await tether.note("found the limit"); return await tether.handoff({ to: "tester", goal: "run the suite" })');
    expect(notes).toEqual(['found the limit']);
    expect(s.followUps()).toBe('@HAND tester: run the suite');
    expect((await session().runCode('return await tether.handoff({ to: "tester", goal: "x" })')).text).toMatch(/may not hand off/);
  });

  it('asks approval for outside-world calls: refused in a workflow, an Inbox approval in a team run, allowed when approved or granted', async () => {
    const gh = fakeGh();
    const flow = session({}, { exec: gh.exec });
    expect((await flow.runCode('return await github.comment("o/r", 7, "LGTM")')).text).toMatch(/^Error: github\.comment needs approval \("comment on o\/r#7: "LGTM""\): in a workflow it comes from an approval step/);
    const team = session({ kind: 'team' }, { exec: gh.exec });
    const r = await team.runCode('const prs = await github.prs("o/r"); await github.comment("o/r", 7, "LGTM"); return prs;');
    expect(r.text).toMatch(/needs the person's approval/);
    expect(team.followUps()).toBe('@ASK user: Allow Bolt to comment on o/r#7: "LGTM"? | options: Allow; Deny | recommended: Deny | why: a Code Mode call that changes something outside the repository');
    expect(gh.calls.filter((c) => c.args.includes('--input'))).toHaveLength(0);
    const granted = session({ kind: 'team', grants: ['comment on o/r#7: "LGTM"'] }, { exec: gh.exec });
    expect(JSON.parse((await granted.runCode('return await github.comment("o/r", 7, "LGTM")')).text)).toEqual({ url: 'https://github.com/o/r/issues/7#c1' });
    expect(gh.calls.at(-1)).toEqual({ args: ['api', 'repos/o/r/issues/7/comments', '--input', '-'], stdin: '{"body":"LGTM"}' });
    const approved = session({ approved: true }, { exec: gh.exec });
    expect((await approved.runCode('return (await github.prs("o/r")).map((p) => p.number)')).text).toBe('[\n 7,\n 9\n]');
  });

  it('reads the grants from answered approval questions (Allow only, this step and bot only)', () => {
    const q = (ask: string) => ({ id: 'u1', ask, options: [{ id: 'o1', label: 'Allow' }, { id: 'o2', label: 'Deny' }], recommended: 'o2' });
    const asks = [
      { node: 'code', question: q(approvalQuestion('Bolt', 'merge o/r#7 (squash)')), wait: true, answer: { question: 'u1', option: 'o1', by: 'user' } },
      { node: 'code', question: q(approvalQuestion('Bolt', 'comment on o/r#7: "x"')), wait: true, answer: { question: 'u1', option: 'o2', by: 'user' } },
      { node: 'other', question: q(approvalQuestion('Bolt', 'merge o/r#8 (squash)')), wait: true, answer: { question: 'u1', option: 'o1', by: 'user' } },
      { node: 'code', question: q('Which region?'), wait: true, answer: { question: 'u1', option: 'o1', by: 'user' } },
    ];
    expect(grantsFrom(asks as never, 'code', 'Bolt')).toEqual(['merge o/r#7 (squash)']);
  });

  it('cuts a big result to 16 KB with a note', async () => {
    const r = await session().runCode('return "x".repeat(40000)');
    expect(r.text.length).toBeLessThan(16 * 1024 + 200);
    expect(r.text).toMatch(/\[\.\.\. cut: \d+ more characters\. Return less/);
  });

  it('describes itself by connector names and the two discovery functions, not by every method', () => {
    const d = session().description();
    expect(d).toMatch(/- repo: this run's repository/);
    expect(d).toMatch(/- tether: /);
    expect(d).toMatch(/- github: /);
    expect(d).toMatch(/codemode\.search\(/);
    expect(d).toMatch(/codemode\.describe\(/);
    expect(d).toMatch(/10 s, 64 MB, 200 connector calls, a 16 KB result/);
    expect(d).not.toMatch(/repo\.read\(path: string/);
  });
});

describe('MCP connectors', () => {
  const mcp = (o: Partial<SessionInfo> = {}) => session(o, { exec: fakeGh().exec, mcpServers: [{ name: 'notes', command: process.execPath, args: [FAKE_MCP] }] });

  it('turns a stdio MCP server into mcp.<name>: search finds its tools, describe types them, a call runs one', async () => {
    const s = mcp();
    expect(s.description()).toMatch(/- mcp\.notes: /);
    const r = await s.runCode('const found = await codemode.search("echo message"); const doc = await codemode.describe("mcp.notes.echo"); const said = await mcp.notes.echo({ message: "hi" }); const sum = await mcp.notes.add_numbers({ a: 2, b: 3 }); return { found: found[0], doc, said, sum };');
    expect(r.isError).toBe(false);
    const v = JSON.parse(r.text);
    expect(v.found).toEqual({ name: 'mcp.notes.echo', summary: 'Echo a message back' });
    expect(v.doc).toContain('mcp.notes.echo(input: {\n  /** What to say */\n  message: string;\n}): Promise<unknown>;');
    expect(v.said).toBe('echo: hi');
    expect(v.sum).toEqual({ sum: 5 });
  }, 20_000);

  it('a tool annotated destructive needs approval', async () => {
    const s = mcp({ kind: 'team' });
    expect((await s.runCode('return await mcp.notes.delete_note({ id: "n1" })')).text).toMatch(/needs the person's approval \("run the "delete-note" tool of notes/);
    const ok = mcp({ approved: true });
    expect((await ok.runCode('return await mcp.notes.delete_note({ id: "n1" })')).text).toBe('deleted n1');
  }, 20_000);

  it('sanitises tool names to identifiers', () => {
    expect([toolIdent('create-issue'), toolIdent('a.b c'), toolIdent('9lives')]).toEqual(['create_issue', 'a_b_c', '_9lives']);
  });
});

describe('MCP server settings (<home>/mcp.json)', () => {
  it('adds, replaces and removes servers; checks names, commands and URLs; never shows env or header values', () => {
    const home = tmp('home-');
    putMcpServer(home, { name: 'files', command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'sk-secret' } });
    putMcpServer(home, { name: 'docs', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer abc' } });
    putMcpServer(home, { name: 'files', command: 'node', args: ['server.js'], env: { API_KEY: 'sk-secret' } });
    expect(loadMcpServers(home).map(publicMcp)).toEqual([
      { name: 'docs', kind: 'http', target: 'https://mcp.example.com/mcp', envKeys: [], headerKeys: ['Authorization'] },
      { name: 'files', kind: 'stdio', target: 'node server.js', envKeys: ['API_KEY'], headerKeys: [] },
    ]);
    expect(JSON.stringify(loadMcpServers(home).map(publicMcp))).not.toMatch(/sk-secret|Bearer abc/);
    expect(removeMcpServer(home, 'docs')).toBe(true);
    expect(removeMcpServer(home, 'docs')).toBe(false);
    expect(() => checkMcpServer({ name: 'Bad-Name', command: 'x' })).toThrow(/lowercase/);
    expect(() => checkMcpServer({ name: 'ok' })).toThrow(/command .* or a url/);
    expect(() => checkMcpServer({ name: 'ok', url: 'file:///etc' })).toThrow(/http or https/);
  });

  it('serves them on /api/codemode/mcp with names only for env and headers', async () => {
    const s = await startHttpTestServer();
    try {
      expect((await s.api('GET', '/api/codemode/mcp')).json).toEqual({ servers: [] });
      const put = await s.api('PUT', '/api/codemode/mcp/files', { command: 'node', args: ['server.js'], env: { API_KEY: 'sk-secret' } });
      expect(put.json).toEqual({ server: { name: 'files', kind: 'stdio', target: 'node server.js', envKeys: ['API_KEY'], headerKeys: [] } });
      const list = await s.api('GET', '/api/codemode/mcp');
      expect(list.json.servers).toHaveLength(1);
      expect(list.text).not.toContain('sk-secret');
      expect((await s.api('PUT', '/api/codemode/mcp/Bad', { command: 'x' })).status).toBe(400);
      expect((await s.api('PUT', '/api/codemode/mcp/ok', { url: 'ftp://x' })).status).toBe(400);
      expect((await s.api('DELETE', '/api/codemode/mcp/files')).json).toEqual({ ok: true });
      expect((await s.api('DELETE', '/api/codemode/mcp/files')).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
