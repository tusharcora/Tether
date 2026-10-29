/**
 * One assistant turn: the default crew agent (Tether's binding), read-only, in a Code Mode session that may not change
 * files and may not reach the outside world without a grant. The turn streams what the agent writes and the scripts it
 * runs; its final answer is checked (reply.ts) and saved. Nothing here starts a run.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterRegistry } from '../adapters/index.js';
import { loadBindings } from '../bindings.js';
import { openCodeModeFor } from './codemodeFor.js';
import { listPipelines } from '../config.js';
import { redactText } from '../http/redact.js';
import { loadSecrets } from '../http/secrets.js';
import type { Engine } from '../engine.js';
import type { Store } from '../store.js';
import type { AttentionItem, CodeModeRequest } from '../types.js';
import type { Vault } from '../vault.js';
import { getWorkspace, contextOf } from '../workspace.js';
import { loadAllow, newChatId, readChat, saveChat as saveChatFile, titleOf, type Chat } from './history.js';
import { compactChat } from './compact.js';
import { knownSize, latestContext, overflows } from './context.js';
import { buildPrompt, promptParts, type PromptInput } from './prompt.js';
import { checkReply } from './reply.js';
import { splitArtifacts } from './artifactBlocks.js';
import { artifactsDir, ensureIgnored, readArtifact, saveArtifact } from './artifacts.js';
import { personaOf } from '../composer.js';
import { AGENT_KINDS, loadCrew } from '../crew.js';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type ArtifactRef, type AssistantContext, type ChatMessage, type ContextUse, type Retrieved, type StreamEvent, type ToolRun } from './types.js';

export interface AssistantCtx {
  home: string;
  store: Store;
  engine: Engine;
  registry: AdapterRegistry;
  vault: Vault;
  /** The items waiting for the person (the Inbox). */
  needs(): AttentionItem[];
  /** The answering model's context size and free-tier limit, where known (the server asks OpenRouter's models list). */
  modelInfo?(agent: string, model?: string): Promise<{ size?: number; limit?: ContextUse['limit'] }>;
}

/** The tools part of what a turn sends: run_code's description (one item per connector it lists) and Code Mode's note. */
function toolsPart(cm: CodeModeRequest | undefined): [string, number][] {
  if (!cm) return [];
  const desc = cm.runner.description();
  const connectors = desc.split('\n').flatMap((l): [string, number][] => (l.startsWith('- ') ? [[l.slice(2).split(':')[0]!, l.length]] : []));
  return [['run_code', desc.length - connectors.reduce((a, [, c]) => a + c, 0)], ...connectors, ['Code Mode notes', cm.note.length]];
}

export interface TurnBody {
  message: string;
  context?: AssistantContext;
  model?: string;
  /** Run this turn on another agent than Tether's binding (the picker's OpenRouter models). */
  agent?: string;
  /** An @mentioned crew bot: the turn runs on its agent and model (its binding in Crew). */
  bot?: string;
  attachments?: { name: string; text: string }[];
  answer?: { message: string; result: string };
}

let seq = 0;
export const mid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * One of the agent's own tool calls as the Code Mode call it matches (Claude's Read → repo.read), so the timeline labels it
 * the same way; Tether's own run_code and tools it has no step for are left out.
 */
export function builtinStep(name: string, input: unknown, cwd: string): string | undefined {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const s = (v: unknown) => JSON.stringify(typeof v === 'string' ? (v.startsWith(`${cwd}/`) ? v.slice(cwd.length + 1) : v) : '');
  if (name === 'Read' || name === 'NotebookRead') return `repo.read(${s(i.file_path ?? i.notebook_path)})`;
  if (name === 'Grep') return `repo.search(${s(i.pattern)})`;
  if (name === 'Glob' || name === 'LS') return `repo.list(${s(i.pattern ?? i.path)})`;
  if (name === 'WebFetch') return `http.get(${s(i.url)})`;
  // no Code Mode call searches the web: its own name keeps it apart from a script's http.get
  if (name === 'WebSearch') return `http.search(${s(i.query)})`;
  if (name === 'Bash') return bashStep(typeof i.command === 'string' ? i.command : '', s);
  const m = /^mcp__([^_].*?)__(.+)$/.exec(name);
  if (m && m[1] !== 'tether') return `mcp.${m[1]}.${m[2]}()`;
  return undefined;
}

const READS = new Set(['cat', 'head', 'tail', 'sed', 'less', 'wc', 'nl', 'bat']);
const SEARCHES = new Set(['grep', 'rg', 'ag', 'ack']);
const LISTS = new Set(['ls', 'find', 'tree', 'fd']);

/** A shell command as the Code Mode calls it amounts to (Claude in plan mode reads with `cat`, `sed -n`, `grep`, `ls`…). */
function bashStep(command: string, s: (v: unknown) => string): string {
  const calls: string[] = [];
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const words = (part.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
    const [cmd, ...rest] = words;
    const args = rest.filter((w) => !w.startsWith('-') && !/^\d+(,\d+)?p$/.test(w));
    if (!cmd) continue;
    if (READS.has(cmd)) for (const f of args.filter((a) => /[./]/.test(a))) calls.push(`repo.read(${s(f)})`);
    else if (SEARCHES.has(cmd)) calls.push(`repo.search(${s(args[0])})`);
    else if (LISTS.has(cmd)) calls.push(`repo.list(${s(args[0] ?? '.')})`);
    else if (cmd === 'git' && ['diff', 'status', 'log', 'show'].includes(args[0] ?? '')) calls.push('repo.diff()');
  }
  // a command it cannot place still shows, as "Ran a script"
  return calls.length ? calls.join('; ') : `// $ ${command.slice(0, 200)}`;
}

/** The agent behind Tether (the orchestrator bot's crew binding, claude by default) and its model. */
export function assistantAgent(home: string): { agent: string; model?: string } {
  const b = loadBindings(home).orchestrator;
  return { agent: b?.agent ?? 'claude', ...(b?.model ? { model: b.model } : {}) };
}

const secretsFor = (home: string, ws: string | undefined): Map<string, string> => {
  const m = new Map<string, string>();
  for (const scope of ['default', ...(ws ? [ws] : [])]) {
    try {
      for (const [k, v] of Object.entries(loadSecrets(home, scope))) m.set(k, v);
    } catch {
      /* no such scope */
    }
  }
  return m;
};

/**
 * One turn in `o.chat`, or in a new chat this first message makes (the start event names it). A team agent's turn passes
 * `who` (its identity) and `extra` (fenced team context and memory) and is `ephemeral`: nothing lands in the assistant's chats.
 */
export async function runTurn(c: AssistantCtx, o: { ws?: string; root?: string; chat?: Chat; body: TurnBody; who?: string; extra?: string; ephemeral?: boolean }, emit: (e: StreamEvent) => void, signal: AbortSignal): Promise<ChatMessage> {
  const { body } = o;
  const saveChat: typeof saveChatFile = (...a) => void (!o.ephemeral && saveChatFile(...a));
  const chat: Chat = o.chat ?? { id: newChatId(), title: titleOf(body.message), created: Date.now(), updated: Date.now(), messages: [], once: [] };
  if (body.answer) {
    const m = chat.messages.find((x) => x.id === body.answer!.message);
    if (m?.ask) m.ask = { ...m.ask, status: 'answered', result: body.answer.result.slice(0, 300) };
  }
  const attachments = (body.attachments ?? []).slice(0, ATTACH_MAX_FILES).map((a) => ({ name: String(a.name).slice(0, 120), text: String(a.text).slice(0, ATTACH_MAX_BYTES) }));
  const you: ChatMessage = { id: mid('m'), role: 'you', text: body.message.slice(0, MESSAGE_MAX), at: Date.now(), ...(attachments.length ? { attachments: attachments.map((a) => ({ name: a.name, size: a.text.length })) } : {}) };
  const id = mid('m');
  chat.messages.push(you);
  chat.updated = you.at;
  saveChat(c.home, o.ws, chat);
  emit({ type: 'start', you, id, chat: chat.id, title: chat.title });

  const binding = assistantAgent(c.home);
  // an @mentioned crew agent with a binding answers as itself on that binding; with none, Tether answers
  const routed = body.bot ? loadBindings(c.home)[body.bot] : undefined;
  const as = routed ? loadCrew(c.home).find((b) => b.id === body.bot && AGENT_KINDS.has(b.kind)) : undefined;
  const persona = as && personaOf(as);
  const who = o.who ?? (as ? `You are ${as.name}${as.title ? `, the ${as.title}` : ''}, an agent in the person's Tether crew. They @mentioned you in their chat with Tether: answer as yourself, in your own voice, not as Tether.${persona ? `\n${persona}` : ''}` : undefined);
  const by = as ? { by: { bot: as.id, name: as.name } } : {};
  const agent = body.agent ?? routed?.agent ?? binding.agent;
  // the bound model belongs to the bound agent (claude's "haiku" means nothing to OpenRouter)
  const bound = routed && agent === routed.agent ? routed.model : agent === binding.agent ? binding.model : undefined;
  const secrets = secretsFor(c.home, o.ws);
  const redact = (s: string) => redactText(s, secrets);
  const tools: ToolRun[] = [];
  const retrieved: Retrieved[] = [];
  let text = '';
  // the trailing ```tether block is data: it never streams, and a partial fence waits until it is known not to be one
  let sent = 0;
  const flush = () => {
    const at = text.indexOf('```tether');
    let end = at >= 0 ? at : text.length;
    if (at < 0) for (let k = Math.min(8, text.length); k > 0; k--) if ('```tether'.startsWith(text.slice(text.length - k))) (end = text.length - k, (k = 0));
    if (end > sent) (emit({ type: 'delta', text: redact(text.slice(sent, end)) }), (sent = end));
  };
  const done = (m: ChatMessage): ChatMessage => {
    // re-read for a rename made meanwhile; a chat deleted meanwhile stays deleted
    const f = readChat(c.home, o.ws, chat.id);
    if (f) saveChat(c.home, o.ws, { ...f, messages: [...chat.messages, m], once: [], updated: m.at });
    emit({ type: 'done', message: m });
    return m;
  };
  // a half-written artifact is not kept: the reply's prose is
  const fail = (error: string) => done({ id, role: 'tether', text: redact(splitArtifacts(text).text.split('```tether')[0]!.trimEnd()), at: Date.now(), ...by, ...(tools.length ? { tools } : {}), error });
  if (!c.registry.has(agent)) return fail(`"${agent}" is not set up. Link a model to Tether in the Crew tab.`);
  // a team agent's turn keeps no chat, so there is nothing to compact
  const latest = o.ephemeral ? undefined : latestContext(chat.messages)?.use;
  if (latest && overflows(latest, you.text.length + attachments.reduce((a, x) => a + x.text.length, 0))) {
    // the context would run full: summarize older messages first, and say so in the thread
    try {
      if (await compactChat(c, chat, { agent, model: body.model || bound, auto: true, signal })) {
        saveChat(c.home, o.ws, chat);
        emit({ type: 'compacted', messages: chat.messages });
      }
    } catch {
      /* the turn goes on uncompacted */
    }
  }

  const scratch = o.root ? undefined : mkdtempSync(join(tmpdir(), 'tether-assistant-'));
  const cwd = o.root ?? scratch!;
  const ws = o.ws ? getWorkspace(c.home, o.ws) : undefined;
  const sessionBox: { close?: () => Promise<void> } = {};
  try {
    const runs = c.store
      .listRows()
      .map((r) => r.summary)
      .filter((r) => {
        if (!o.root) return true;
        try {
          return r.repo === o.root || realpathSync(r.repo) === o.root;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 8)
      .map((r) => `- ${r.id}: ${r.status}, ${r.kind === 'team' ? 'team' : r.pipeline}, "${r.task.replace(/\s+/g, ' ').slice(0, 80)}"`);
    // the chat's artifacts at their latest version, and the newest one's content, so "change that page" can rewrite it
    const made = chat.messages.flatMap((m) => m.artifacts ?? []);
    const refs = made.filter((a, k) => made.findLastIndex((x) => x.id === a.id) === k);
    let artifact: PromptInput['artifact'];
    if (refs.length && !o.ephemeral) {
      try {
        const v = readArtifact(artifactsDir(c.home, o.root), refs.at(-1)!.id);
        artifact = { ref: { id: v.meta.id, version: v.version, title: v.meta.title, kind: v.meta.kind }, content: v.content };
      } catch {
        /* deleted since: the list still names it */
      }
    }
    const input: PromptInput = {
      message: body.message,
      context: body.context,
      project: ws ? { name: ws.name, blurb: contextOf(ws).slice(0, 1500) } : undefined,
      needs: c.needs(),
      runs,
      workflows: listPipelines(c.home).map((f) => f.name),
      notes: (await c.vault.contextFor(body.message, { limit: 3, maxChars: 2500, used: (h) => void retrieved.push({ path: h.note.path, title: h.note.title, score: h.score, snippet: redact(h.snippet).slice(0, 300) }) }).catch(() => '')) || undefined,
      history: chat.messages.slice(0, -1),
      attachments,
      who,
      ...(as && !o.who ? { mention: true as const } : {}),
      extra: o.extra,
      ...(refs.length ? { artifacts: refs } : {}),
      ...(artifact ? { artifact } : {}),
    };
    const prompt = buildPrompt(input);
    const cm = await openCodeModeFor({
      engine: c.engine,
      adapter: c.registry.get(agent),
      home: c.home,
      store: c.store,
      vault: c.vault,
      workdir: cwd,
      // an agent's turn in a team never borrows the owner's outside-world grants
      grants: o.ephemeral ? [] : [...loadAllow(c.home, o.ws), ...chat.once],
      workspace: o.ws,
      onRun: (code) => {
        const t: ToolRun = { id: `t${tools.length + 1}`, code: redact(code).slice(0, 4000) };
        tools.push(t);
        emit({ type: 'tool', tool: { ...t } });
        const started = Date.now();
        return (r) => {
          t.output = redact(r.text).slice(0, 4000);
          t.isError = r.isError || undefined;
          t.ms = Date.now() - started;
          emit({ type: 'tool', tool: { ...t } });
        };
      },
    });
    sessionBox.close = cm.close;
    let streamed = false;
    /** The agent's web searches by call id, so their results (titles and links) land on their step. */
    const searches = new Map<string, ToolRun>();
    const model = body.model || bound;
    const res = await c.registry.get(agent).run({
      runId: 'tether-assistant',
      nodeId: 'chat',
      prompt,
      cwd,
      model,
      readOnly: true,
      lean: true,
      attempt: 1,
      timeoutMs: 180_000,
      signal,
      ...(cm.request ? { codeMode: cm.request } : {}),
      onChunk: (t) => {
        // adapters that cannot stream tokens deliver whole blocks here
        if (!streamed && !t.startsWith('[') && !t.startsWith('$')) (text += t, flush());
      },
      onDelta: (t) => {
        streamed = true;
        text += t;
        flush();
      },
      onSession: () => {},
      // the agent's own reads and searches (Claude's Read, Grep…) show in the timeline like run_code steps
      onTool: (name, input, useId) => {
        const code = builtinStep(name, input, cwd);
        if (!code) return;
        const t: ToolRun = { id: `t${tools.length + 1}`, code: redact(code).slice(0, 4000) };
        tools.push(t);
        if (name === 'WebSearch' && useId) searches.set(useId, t);
        emit({ type: 'tool', tool: { ...t } });
      },
      // only a search's result is kept: the others are file contents the timeline does not show, and would swell the chat
      onToolResult: (useId, output, isError) => {
        const t = searches.get(useId);
        if (!t) return;
        t.output = redact(output).slice(0, 4000);
        t.isError = isError || undefined;
        emit({ type: 'tool', tool: { ...t } });
      },
    });
    flush();
    if (signal.aborted) return fail('Stopped.');
    if (res.exitCode !== 0 || res.error) return fail((res.error ?? `the agent exited ${res.exitCode}`).split('\n')[0]!.slice(0, 300));
    const checked = await checkReply(redact(res.output || text), { home: c.home, repo: o.root, store: c.store, vault: c.vault });
    // a team agent's turn keeps nothing of the assistant's: its prompt has no artifact contract either
    const artifacts: ArtifactRef[] = [];
    const unsaved: string[] = [];
    if (!o.ephemeral)
      for (const a of checked.artifacts) {
        try {
          if (o.root) ensureIgnored(o.root);
          artifacts.push(saveArtifact(artifactsDir(c.home, o.root), a, chat.id));
        } catch (e) {
          unsaved.push(`Could not save the artifact "${a.title}": ${(e as Error).message.split('\n')[0]!.slice(0, 200)}`);
        }
      }
    const replyText = [checked.text, ...unsaved].filter(Boolean).join('\n\n');
    const approvals = cm.approvals();
    const info = (await c.modelInfo?.(agent, model).catch(() => undefined)) ?? { size: knownSize(agent, model) };
    const context: ContextUse = {
      parts: { ...promptParts(input, prompt), tools: toolsPart(cm.request) },
      ...(res.usage?.promptTokens ? { tokens: res.usage.promptTokens } : {}),
      agent,
      ...(model ? { model } : {}),
      ...(info.size ? { size: info.size } : {}),
      ...(info.limit ? { limit: info.limit } : {}),
    };
    return done({
      id,
      role: 'tether',
      text: replyText || (artifacts.length ? '' : 'Done.'),
      at: Date.now(),
      ...by,
      ...(checked.cites.length ? { cites: checked.cites } : {}),
      ...(checked.proposals.length ? { proposals: checked.proposals } : {}),
      ...(checked.ask ? { ask: checked.ask } : {}),
      ...(checked.compare ? { compare: checked.compare } : {}),
      ...(checked.report ? { report: checked.report } : {}),
      ...(checked.spec ? { spec: checked.spec } : {}),
      ...(checked.choice ? { choice: checked.choice } : {}),
      ...(checked.diagram ? { diagram: checked.diagram } : {}),
      ...(checked.timeline ? { timeline: checked.timeline } : {}),
      ...(artifacts.length ? { artifacts } : {}),
      ...(retrieved.length ? { retrieved } : {}),
      ...(approvals.length ? { toolAsks: approvals.map((what) => ({ id: mid('ta'), what, status: 'pending' as const })) } : {}),
      ...(tools.length ? { tools } : {}),
      ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}),
      context,
    });
  } catch (e) {
    return signal.aborted ? fail('Stopped.') : fail((e as Error).message.split('\n')[0]!.slice(0, 300));
  } finally {
    await sessionBox.close?.().catch(() => {});
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
