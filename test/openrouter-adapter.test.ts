import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatAdapter } from '../src/adapters/openai.js';
import { accountKey, setAccountKey } from '../src/accounts/keys.js';
import type { SecretStore } from '../src/accounts/secretStore.js';
import { limitMessage, nextUtcMidnight } from '../src/openrouter.js';
import { MAX_COMMAND_MS, MAX_COMMAND_OUTPUT, runStepCommand } from '../src/permissions.js';
import type { AgentRequest } from '../src/types.js';
import { tmp } from './helpers.js';

const KEY = 'sk-or-v1-secretkey0123456789';
const OR = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'account:openrouter' };

const req = (o: Partial<AgentRequest> = {}): AgentRequest & { chunks: string[] } => {
  const chunks: string[] = [];
  return { runId: 'r1', nodeId: 'n1', prompt: 'do it', cwd: tmp(), model: 'nvidia/nemotron-3.5-super-vl:free', readOnly: true, attempt: 1, timeoutMs: 60_000, signal: new AbortController().signal, onChunk: (t) => chunks.push(t), onSession: () => {}, chunks, ...o };
};

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const answer = (text: string) => json({ choices: [{ message: { role: 'assistant', content: text } }] });
const rateLimited = (headers: Record<string, string> = {}) => json({ error: { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } }, 429, headers);
const keyInfo = (remaining: number) => json({ data: { free_model_daily_requests: { used: 50 - remaining, limit: 50, remaining } } });

/** A stubbed global fetch: chat calls take the next scripted reply; GET /key answers `remaining`. */
function stub(chat: (() => Response)[], remaining = 5) {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    if (String(url).endsWith('/key')) return keyInfo(remaining);
    if (String(url).endsWith('/chat/completions')) return (chat.shift() ?? (() => answer('late')))();
    return json({ data: [{ id: 'm' }] });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('account: keys', () => {
  it('reads an account key from the secret store once, then from memory', async () => {
    const home = tmp();
    let reads = 0;
    const store: SecretStore = { kind: 'file', get: async () => (reads++, KEY), set: async () => {}, delete: async () => {} };
    expect(await accountKey(home, 'openrouter', store)).toBe(KEY);
    expect(await accountKey(home, 'openrouter', store)).toBe(KEY);
    expect(reads).toBe(1);
    setAccountKey(home, 'openrouter', undefined);
    expect(await accountKey(home, 'openrouter', store)).toBeUndefined();
  });

  it('sends the connected key and the attribution headers to OpenRouter, and the account wins over OPENROUTER_API_KEY', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-fromenv');
    const calls = stub([() => answer('done')]);
    const r = req();
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(r);
    expect(res).toMatchObject({ exitCode: 0, output: 'done' });
    const chat = calls.find((c) => c.url.endsWith('/chat/completions'))!;
    expect(chat.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(chat.headers.get('http-referer')).toBe('https://tether.tusharcs0112.workers.dev');
    expect(chat.headers.get('x-title')).toBe('Tether');
    expect(JSON.stringify(res) + r.chunks.join('')).not.toContain(KEY);
  });

  it('sends no attribution headers to other endpoints', async () => {
    const calls = stub([() => answer('ok')]);
    await new OpenAICompatAdapter('local', { baseUrl: 'http://127.0.0.1:9/v1' }, tmp()).run(req({ model: 'm' }));
    expect(calls[0]!.headers.get('x-title')).toBeNull();
    expect(calls[0]!.headers.get('authorization')).toBeNull();
  });

  it('reports an account endpoint with no stored key as not connected', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', undefined);
    stub([]);
    expect(await new OpenAICompatAdapter('openrouter', OR, home).detect()).toMatchObject({ ok: false, detail: expect.stringMatching(/not connected/) });
  });
});

describe('429 on a free model', () => {
  it('waits out a per-minute limit and retries, saying so in one line', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    stub([() => rateLimited({ 'x-ratelimit-reset': String(Date.now()) }), () => answer('second try')], 5);
    const r = req();
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(r);
    expect(res).toMatchObject({ exitCode: 0, output: 'second try' });
    expect(res.limit).toBeUndefined();
    expect(r.chunks.join('')).toContain('per-minute limit · retried after 0s');
  });

  it('turns the daily limit into a limit signal with the reset time, not a plain failure', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    stub([() => rateLimited()], 0);
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(req());
    const resetsAt = nextUtcMidnight();
    expect(res).toMatchObject({ exitCode: 1, limit: { resetsAt }, error: limitMessage(resetsAt) });
  });

  it('leaves a paid model’s 429 as the plain HTTP error', async () => {
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    stub([() => rateLimited()], 0);
    const res = await new OpenAICompatAdapter('openrouter', OR, home).run(req({ model: 'anthropic/claude-sonnet-4.5' }));
    expect(res.limit).toBeUndefined();
    expect(res.error).toMatch(/^openrouter: HTTP 429/);
  });
});

describe('images (a teammate’s photo)', () => {
  it('go to the model as data URLs after the prompt; a request without images stays plain text', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const home = tmp();
    setAccountKey(home, 'openrouter', KEY);
    const bodies: { messages: { role: string; content: unknown }[] }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/chat/completions')) bodies.push(JSON.parse(String(init?.body)));
      return answer('a red badge');
    });
    const dir = tmp();
    const png = join(dir, 'photo.png');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const a = new OpenAICompatAdapter('openrouter', OR, home);
    await a.run(req({ prompt: 'why is this red?', images: [png] }));
    expect(bodies[0]!.messages[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'why is this red?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } }] });
    await a.run(req({ prompt: 'plain' }));
    expect(bodies[1]!.messages[1]).toEqual({ role: 'user', content: 'plain' });
  });
});

/** A model that makes these tool calls, one turn each, then answers. What it was offered and what came back. */
async function fakeOpenAI(o: { commands?: boolean; readOnly?: boolean; calls: Record<string, unknown>[] }) {
  const cwd = tmp();
  const bodies: { tools?: { function: { name: string } }[]; messages: { role: string; content: string }[] }[] = [];
  const turns = [...o.calls];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const call = turns.shift();
    if (!call) return answer('done');
    const [name, args] = Object.entries(call)[0]!;
    return json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  });
  await new OpenAICompatAdapter('local', { baseUrl: 'http://127.0.0.1:9/v1' }).run(req({ model: 'm', cwd, readOnly: o.readOnly ?? false, ...(o.commands ? { commands: true } : {}) }));
  const last = bodies[bodies.length - 1]!;
  return { cwd, tools: (bodies[0]!.tools ?? []).map((t) => t.function.name), system: bodies[0]!.messages[0]!.content, result: last.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n') };
}

describe('run_command', () => {
  it('offers run_command only in a trusted writable step, and runs it in the step folder', async () => {
    const seen = await fakeOpenAI({ commands: true, calls: [{ run_command: { command: 'echo hi > made.txt && cat made.txt' } }] });
    expect(seen.tools).toContain('run_command');
    expect(seen.system).toContain('run_command');
    expect(seen.result).toContain('hi');
    expect(existsSync(join(seen.cwd, 'made.txt'))).toBe(true);
  });

  it('has no run_command without trust, or on a read-only step', async () => {
    const untrusted = await fakeOpenAI({ calls: [{ run_command: { command: 'echo hi > made.txt' } }] });
    expect(untrusted.tools).not.toContain('run_command');
    expect(untrusted.system).not.toContain('run_command');
    expect(existsSync(join(untrusted.cwd, 'made.txt'))).toBe(false);
    expect(untrusted.result).toMatch(/error/);
    const readOnly = await fakeOpenAI({ commands: true, readOnly: true, calls: [{ run_command: { command: 'echo hi > made.txt' } }] });
    expect(readOnly.tools).not.toContain('run_command');
    expect(existsSync(join(readOnly.cwd, 'made.txt'))).toBe(false);
  });

  it('tells the model why a refused command did not run', async () => {
    const seen = await fakeOpenAI({ commands: true, calls: [{ run_command: { command: 'npm test && git push' } }] });
    expect(seen.result).toMatch(/not run/i);
    expect(seen.result).toMatch(/tell the person/i);
    expect(seen.result).not.toMatch(/^error/);
  });

  it('allows an absolute path inside the step folder, and never throws at the model', async () => {
    const root = tmp();
    writeFileSync(join(root, 'a.txt'), 'inside\n');
    expect(await runStepCommand(root, `cat ${join(root, 'a.txt')}`, new AbortController().signal)).toContain('inside');
    expect(await runStepCommand(root, 'echo a\0b', new AbortController().signal)).toMatch(/not run/i);
    expect(await runStepCommand(join(root, 'gone'), 'echo hi', new AbortController().signal)).toMatch(/could not start/);
  });

  it('cuts long output to its tail and stops at the time limit', async () => {
    const root = tmp();
    const long = await runStepCommand(root, 'seq 1 20000', new AbortController().signal);
    expect(long).toContain('20000');
    expect(long).not.toContain('\n1\n');
    expect(long.length).toBeLessThan(MAX_COMMAND_OUTPUT + 200);
    expect(long).toMatch(/cut/);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const run = runStepCommand(root, 'sleep 30', new AbortController().signal);
      vi.advanceTimersByTime(MAX_COMMAND_MS);
      expect(await run).toMatch(/stopped/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no backgrounded command behind', async () => {
    const out = await runStepCommand(tmp(), 'sleep 77 >/dev/null 2>&1 & echo $!', new AbortController().signal);
    const pid = Number(out.trim());
    expect(pid).toBeGreaterThan(0);
    const alive = () => {
      try {
        return process.kill(pid, 0);
      } catch {
        return false;
      }
    };
    await expect.poll(alive, { timeout: 3000 }).toBe(false);
  });

  it('never returns a secrets file', async () => {
    const root = tmp();
    writeFileSync(join(root, '.env'), 'API=hunter2\n');
    const out = await runStepCommand(root, 'cat .env', new AbortController().signal);
    expect(out).toMatch(/not run/i);
    expect(out).not.toContain('hunter2');
  });

  it('stops a running command when the step is cancelled, and starts none once it is', async () => {
    const root = tmp();
    const stop = new AbortController();
    const run = runStepCommand(root, 'sleep 30', stop.signal);
    const t0 = Date.now();
    stop.abort();
    expect(await run).toMatch(/stopped/i);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await runStepCommand(root, 'echo hi > late.txt', stop.signal)).toMatch(/not run/i);
    expect(existsSync(join(root, 'late.txt'))).toBe(false);
  });
});
