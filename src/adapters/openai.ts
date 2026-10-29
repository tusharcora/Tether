/**
 * Agent adapter for any OpenAI-compatible chat endpoint: Ollama, LM Studio, llama.cpp's server, vLLM, and so on.
 *
 * A bare chat model cannot touch files, so this adapter runs a small tool loop of its own. With Code Mode (the default)
 * it offers one tool, run_code, answered in-process by the step's Code Mode session (no MCP hop). Direct, the tools are
 * deliberately few and confined to the run's worktree: list_files, read_file, search, and (for steps that may modify
 * code) write_file. There is no shell tool; tests run in gate steps, outside the model's control.
 * Prompts and file contents go to the configured endpoint, so only point it at servers you trust.
 */
import { toolChunk } from '../activity.js';
import { existsSync, realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { accountKey } from '../accounts/keys.js';
import { RUN_CODE_SCHEMA } from '../codemode/prompt.js';
import { OR_HEADERS, isOpenRouter, limitKind, limitMessage, nextUtcMidnight } from '../openrouter.js';
import type { AgentAdapter, AgentRequest, AgentResult, CodeModeRequest } from '../types.js';

export interface EndpointConfig {
  baseUrl: string;
  /** Literal key, `env:NAME` to read it from the environment, or `account:<provider>` for a connected account's key (SecretStore). */
  apiKey?: string;
  /** Model used when a step names none. */
  model?: string;
  /** Per-request timeout for each model call. Local models can be slow to load. */
  requestTimeoutMs?: number;
  /** Spend API (Experiential Labs): env var holding a provisioning key (`xpl_…`), separate from the inference key. */
  usageKey?: string;
  /** Organisation id for the Spend API. Looked up from /api/whoami when absent. */
  orgId?: string;
}

export const LOCAL_ENDPOINTS: Record<string, EndpointConfig> = {
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1' },
  lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1' },
  llamacpp: { baseUrl: 'http://127.0.0.1:8080/v1' },
};

const MAX_TURNS = 30;
/** Per-minute limit retries on a free OpenRouter model before it counts as the daily limit. */
const LIMIT_RETRIES = 3;
const MAX_READ = 64_000;
const MAX_WRITE = 512_000;
const MAX_LIST = 400;
const MAX_HITS = 50;
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', '__pycache__', '.venv']);

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

const TOOLS = (writable: boolean) => [
  fn('list_files', 'List files and folders in a directory of the repository.', { path: { type: 'string', description: 'Directory, relative to the repo root. Default "."' } }, []),
  fn('read_file', 'Read a text file from the repository.', { path: { type: 'string' } }, ['path']),
  fn('search', 'Find lines containing a text snippet (case-insensitive) in the repository.', { pattern: { type: 'string' }, path: { type: 'string', description: 'Limit to this directory' } }, ['pattern']),
  ...(writable ? [fn('write_file', 'Create or overwrite a file with the full new content.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content'])] : []),
];
/** Code Mode: the one tool. */
const CODE_TOOLS = (cm: CodeModeRequest) => [fn('run_code', cm.runner.description(), RUN_CODE_SCHEMA.properties, [...RUN_CODE_SCHEMA.required])];
function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

/** Resolve a model-supplied path inside the worktree. Throws if it escapes, or points into .git. */
export function safePath(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('invalid path');
  if (isAbsolute(rel)) throw new Error('use paths relative to the repository root');
  const full = resolve(root, rel);
  const realRoot = realpathSync(root);
  const lexical = relative(resolve(root), full);
  if (lexical.startsWith('..') || isAbsolute(lexical)) throw new Error('path is outside the repository');
  if (lexical.split(sep).includes('.git')) throw new Error('.git is off limits');
  // resolve symlinks on the nearest existing ancestor so a link cannot lead out of the worktree
  let probe = full;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const realProbe = realpathSync(probe);
  const back = relative(realRoot, realProbe);
  if (back.startsWith('..') || isAbsolute(back)) throw new Error('path leads outside the repository');
  return full;
}

async function walk(root: string, dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name)) continue;
    if (out.length >= limit) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(root, p, out, limit);
    else if (e.isFile()) out.push(relative(root, p));
  }
}

async function runTool(root: string, name: string, args: Record<string, unknown>, writable: boolean): Promise<string> {
  switch (name) {
    case 'list_files': {
      const dir = safePath(root, String(args.path ?? '.'));
      const entries = await readdir(dir, { withFileTypes: true });
      const lines = entries.filter((e) => !SKIP.has(e.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_LIST).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return lines.join('\n') || '(empty)';
    }
    case 'read_file': {
      const p = safePath(root, String(args.path));
      const st = await stat(p);
      if (!st.isFile()) throw new Error('not a file');
      const text = await readFile(p, 'utf8');
      if (text.includes('\0')) throw new Error('binary file');
      return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[... truncated, ${text.length - MAX_READ} more characters]` : text;
    }
    case 'search': {
      const needle = String(args.pattern ?? '').toLowerCase();
      if (!needle) throw new Error('empty pattern');
      const base = safePath(root, String(args.path ?? '.'));
      const files: string[] = [];
      await walk(root, base, files, 2000);
      const hits: string[] = [];
      for (const f of files) {
        if (hits.length >= MAX_HITS) break;
        try {
          const st = await stat(join(root, f));
          if (st.size > 400_000) continue;
          const text = await readFile(join(root, f), 'utf8');
          if (text.includes('\0')) continue;
          text.split('\n').forEach((line, i) => {
            if (hits.length < MAX_HITS && line.toLowerCase().includes(needle)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
          });
        } catch {
          /* unreadable file */
        }
      }
      return hits.join('\n') || 'no matches';
    }
    case 'write_file': {
      if (!writable) throw new Error('this step is read-only; write_file is not available');
      const content = String(args.content ?? '');
      if (content.length > MAX_WRITE) throw new Error(`file too large (max ${MAX_WRITE} characters)`);
      const p = safePath(root, String(args.path));
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content);
      return `wrote ${relative(root, p)} (${content.length} characters)`;
    }
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

export class OpenAICompatAdapter implements AgentAdapter {
  readonly reportsCost = false;
  readonly supportsResume = false;
  /** run_code is offered in this adapter's own loop. */
  readonly codeMode = 'native' as const;

  constructor(
    readonly id: string,
    private readonly cfg: EndpointConfig,
    /** Tether's home, where an `account:` key's SecretStore lives. */
    private readonly home?: string,
  ) {}

  private async key(): Promise<string | undefined> {
    const k = this.cfg.apiKey;
    if (k?.startsWith('account:')) return this.home ? accountKey(this.home, k.slice(8)) : undefined;
    return k?.startsWith('env:') ? process.env[k.slice(4)] : k;
  }

  private async headers(): Promise<Record<string, string>> {
    const key = await this.key();
    return { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...(isOpenRouter(this.cfg.baseUrl) ? OR_HEADERS : {}) };
  }

  private url(path: string) {
    return `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(this.url('/models'), { headers: await this.headers(), signal: AbortSignal.timeout(this.local() ? 2500 : 8000) });
      if (!res.ok) return [];
      const j = (await res.json()) as { data?: { id?: string }[] };
      return (j.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string').sort();
    } catch {
      return [];
    }
  }

  private local(): boolean {
    try {
      return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(this.cfg.baseUrl).hostname);
    } catch {
      return false;
    }
  }

  async detect() {
    const local = this.local();
    // OpenRouter's /models answers without a key: a disconnected account must not look healthy
    if (this.cfg.apiKey?.startsWith('account:') && !(await this.key())) return { ok: false, detail: `${this.id} is not connected: connect it in Settings → Accounts` };
    try {
      const res = await fetch(this.url('/models'), { headers: await this.headers(), signal: AbortSignal.timeout(local ? 1500 : 8000) });
      if (res.status === 401 || res.status === 403) return { ok: false, detail: `${this.cfg.baseUrl} rejected the API key (HTTP ${res.status}): check the key and the variable name` };
      if (res.status === 404) return { ok: true, version: `reachable · ${this.cfg.baseUrl} (no /models list: name a model per bot)` };
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${this.cfg.baseUrl}` };
      const j = (await res.json()) as { data?: unknown[] };
      const n = j.data?.length ?? 0;
      return { ok: true, version: `${n} model${n === 1 ? '' : 's'} · ${this.cfg.baseUrl}` };
    } catch (e) {
      const err = e as { name?: string; cause?: { code?: string; message?: string } };
      const why = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code === 'ENOTFOUND' ? 'no such host (check the URL)' : err.cause?.code ?? err.cause?.message ?? 'connection failed';
      return { ok: false, detail: local ? `not running at ${this.cfg.baseUrl}` : `cannot reach ${this.cfg.baseUrl}: ${why}` };
    }
  }

  private async chat(messages: Msg[], model: string, tools: unknown[] | undefined, signal: AbortSignal): Promise<{ message: Msg; status: number; errorText?: string; reset?: number; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
    const res = await fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ model, messages, stream: false, ...(tools ? { tools, tool_choice: 'auto' } : {}) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.cfg.requestTimeoutMs ?? 600_000)]),
    });
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (!res.ok) return { message: { role: 'assistant', content: null }, status: res.status, errorText: (await res.text()).slice(0, 400), ...(reset > 0 ? { reset } : {}) };
    const j = (await res.json()) as { choices?: { message?: Msg }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = j.choices?.[0]?.message;
    if (!message) return { message: { role: 'assistant', content: null }, status: 502, errorText: 'empty response from model' };
    return { message, status: 200, ...(j.usage ? { usage: j.usage } : {}) };
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    const fail = (error: string, output = ''): AgentResult => ({ output, exitCode: req.signal.aborted ? 130 : 1, error: req.signal.aborted ? 'aborted' : error });
    let model = req.model ?? this.cfg.model;
    try {
      if (!model) {
        model = (await this.listModels())[0];
        if (!model) return fail(`${this.id}: no model given and none found at ${this.cfg.baseUrl}. Link a model to this bot, or pull/load one first`);
        req.onChunk(`[model] ${model}\n`);
      }
      const writable = !req.readOnly;
      const cm = req.codeMode;
      const messages: Msg[] = [
        {
          role: 'system',
          content: `You are a coding agent working in a repository. Use the tools to explore${writable ? ' and to write files' : ' (this step is read-only: do not try to change files)'}. Paths are relative to the repository root. Finish with a plain-text answer that follows the task's instructions.${cm ? `\n\n${cm.note}` : ''}`,
        },
        { role: 'user', content: req.prompt },
      ];
      let tools: unknown[] | undefined = cm ? CODE_TOOLS(cm) : TOOLS(writable);
      let last = '';
      const usage: { inputTokens: number; outputTokens: number; toolCalls: number; turns: number; promptTokens?: number } = { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
      const done = (r: AgentResult): AgentResult => ({ ...r, usage });
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (req.signal.aborted) return fail('aborted', last);
        let r = await this.chat(messages, model, tools, req.signal);
        // a free OpenRouter model: wait out the per-minute limit; the daily one is a limit signal (a run step pauses on it)
        for (let retry = 0; r.status === 429 && isOpenRouter(this.cfg.baseUrl) && model.endsWith(':free'); retry++) {
          if (retry >= LIMIT_RETRIES || (await limitKind(await this.key())) === 'daily') {
            const resetsAt = nextUtcMidnight();
            return { ...fail(limitMessage(resetsAt), last), limit: { resetsAt } };
          }
          const waitMs = Math.min(60_000, r.reset ? Math.max(0, r.reset - Date.now()) : 15_000 * 2 ** retry);
          await sleep(waitMs, undefined, { signal: req.signal });
          req.onChunk(`[openrouter] per-minute limit · retried after ${Math.round(waitMs / 1000)}s\n`);
          r = await this.chat(messages, model, tools, req.signal);
        }
        if (r.status === 400 && tools && /tool|function/i.test(r.errorText ?? '')) {
          if (writable) return fail(`${this.id}/${model} does not support tool calling, so it cannot edit files. Link this bot to a tool-capable model (or to claude, codex or opencode)`);
          tools = undefined; // read-only step: fall back to a plain answer
          req.onChunk('[note] model has no tool support; answering from the prompt alone\n');
          r = await this.chat(messages, model, tools, req.signal);
        }
        if (r.status !== 200) return fail(`${this.id}: HTTP ${r.status}${r.errorText ? `: ${r.errorText}` : ''}`, last);
        usage.turns++;
        if (usage.turns === 1 && r.usage?.prompt_tokens !== undefined) usage.promptTokens = r.usage.prompt_tokens;
        usage.inputTokens += r.usage?.prompt_tokens ?? 0;
        usage.outputTokens += r.usage?.completion_tokens ?? 0;
        const m = r.message;
        if (m.content) {
          last = m.content;
          req.onChunk(m.content + '\n');
        }
        const calls = m.tool_calls ?? [];
        if (!calls.length) return done({ output: last.trim(), exitCode: 0 });
        usage.toolCalls += calls.length;
        messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: calls });
        for (const c of calls) {
          let result: string;
          try {
            const args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
            req.onChunk(toolChunk(c.function.name, args));
            if (cm && c.function.name === 'run_code') result = (await cm.runner.runCode(String(args.code ?? ''))).text;
            else if (cm) throw new Error(`unknown tool "${c.function.name}": the only tool is run_code`);
            else result = await runTool(req.cwd, c.function.name, args, writable);
          } catch (e) {
            result = `error: ${(e as Error).message}`;
          }
          messages.push({ role: 'tool', tool_call_id: c.id, content: result });
        }
      }
      return fail(`${this.id}: stopped after ${MAX_TURNS} tool turns without a final answer`, last);
    } catch (e) {
      const msg = (e as Error).message;
      if (req.signal.aborted) return fail('aborted');
      if (/fetch failed|ECONNREFUSED/.test(msg) || (e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED') return fail(`${this.id}: cannot reach ${this.cfg.baseUrl} — is the server running?`);
      return fail(`${this.id}: ${msg}`);
    }
  }
}
