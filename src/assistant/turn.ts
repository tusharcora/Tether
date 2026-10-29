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
import type { AttentionItem } from '../types.js';
import type { Vault } from '../vault.js';
import { getWorkspace, contextOf } from '../workspace.js';
import { loadAllow, newChatId, readChat, saveChat as saveChatFile, titleOf, type Chat } from './history.js';
import { buildPrompt } from './prompt.js';
import { checkReply } from './reply.js';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type AssistantContext, type ChatMessage, type StreamEvent, type ToolRun } from './types.js';

export interface AssistantCtx {
  home: string;
  store: Store;
  engine: Engine;
  registry: AdapterRegistry;
  vault: Vault;
  /** The items waiting for the person (the Inbox). */
  needs(): AttentionItem[];
}

export interface TurnBody {
  message: string;
  context?: AssistantContext;
  model?: string;
  /** Run this turn on another agent than Tether's binding (the picker's OpenRouter models). */
  agent?: string;
  attachments?: { name: string; text: string }[];
  answer?: { message: string; result: string };
}

let seq = 0;
export const mid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

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
  const agent = body.agent ?? binding.agent;
  // the bound model belongs to the bound agent (claude's "haiku" means nothing to OpenRouter)
  const bound = agent === binding.agent ? binding.model : undefined;
  const secrets = secretsFor(c.home, o.ws);
  const redact = (s: string) => redactText(s, secrets);
  const tools: ToolRun[] = [];
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
  const fail = (error: string) => done({ id, role: 'tether', text: redact(text.split('```tether')[0]!.trimEnd()), at: Date.now(), ...(tools.length ? { tools } : {}), error });
  if (!c.registry.has(agent)) return fail(`"${agent}" is not set up. Link a model to Tether in the Crew tab.`);

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
    const prompt = buildPrompt({
      message: body.message,
      context: body.context,
      project: ws ? { name: ws.name, blurb: contextOf(ws).slice(0, 1500) } : undefined,
      needs: c.needs(),
      runs,
      workflows: listPipelines(c.home).map((f) => f.name),
      notes: (await c.vault.contextFor(body.message, { limit: 3, maxChars: 2500 }).catch(() => '')) || undefined,
      history: chat.messages.slice(0, -1),
      attachments,
      who: o.who,
      extra: o.extra,
    });
    const cm = await openCodeModeFor({
      engine: c.engine,
      adapter: c.registry.get(agent),
      home: c.home,
      store: c.store,
      vault: c.vault,
      workdir: cwd,
      grants: [...loadAllow(c.home, o.ws), ...chat.once],
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
    const res = await c.registry.get(agent).run({
      runId: 'tether-assistant',
      nodeId: 'chat',
      prompt,
      cwd,
      model: body.model || bound,
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
    });
    flush();
    if (signal.aborted) return fail('Stopped.');
    if (res.exitCode !== 0 || res.error) return fail((res.error ?? `the agent exited ${res.exitCode}`).split('\n')[0]!.slice(0, 300));
    const checked = await checkReply(redact(res.output || text), { home: c.home, repo: o.root, store: c.store, vault: c.vault });
    const approvals = cm.approvals();
    return done({
      id,
      role: 'tether',
      text: checked.text || 'Done.',
      at: Date.now(),
      ...(checked.cites.length ? { cites: checked.cites } : {}),
      ...(checked.proposals.length ? { proposals: checked.proposals } : {}),
      ...(checked.ask ? { ask: checked.ask } : {}),
      ...(checked.compare ? { compare: checked.compare } : {}),
      ...(approvals.length ? { toolAsks: approvals.map((what) => ({ id: mid('ta'), what, status: 'pending' as const })) } : {}),
      ...(tools.length ? { tools } : {}),
      ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}),
    });
  } catch (e) {
    return signal.aborted ? fail('Stopped.') : fail((e as Error).message.split('\n')[0]!.slice(0, 300));
  } finally {
    await sessionBox.close?.().catch(() => {});
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
