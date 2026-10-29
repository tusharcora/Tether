/**
 * Compaction: one model call summarizes a chat's older messages into a summary message that future prompts carry instead
 * of them. The originals stay in the chat (marked `compactedBy`, shown collapsed) and Undo puts them back. The caller
 * saves the chat.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimate, foldable, latestContext, MIN_FOLD } from './context.js';
import type { Chat } from './history.js';
import { messagesPart } from './prompt.js';
import type { AssistantCtx } from './turn.js';
import type { ChatMessage, ContextUse } from './types.js';

const SUMMARY_MAX = 4000;
const PER_MESSAGE = 2000;
// shortcut: a very long chat's oldest part is cut from the transcript the model sees, upgrade to summarizing in chunks if it matters
const TRANSCRIPT_MAX = 60_000;

const sum = (rows: [string, number][]) => rows.reduce((a, [, c]) => a + c, 0);

/**
 * Fold every message but the last few into one summary message (inserted after the last folded one). Undefined when there
 * is too little to fold; throws when the model call fails, leaving the chat as it was.
 */
export async function compactChat(c: AssistantCtx, chat: Chat, o: { agent: string; model?: string; auto?: boolean; signal: AbortSignal }): Promise<ChatMessage | undefined> {
  const fold = foldable(chat.messages);
  if (fold.length < MIN_FOLD) return undefined;
  if (!c.registry.has(o.agent)) throw new Error(`"${o.agent}" is not set up`);
  const transcript = fold
    .map((m) => `${m.compact ? 'Earlier summary' : m.role === 'you' ? 'User' : 'Tether'}: ${m.text.replace(/```tether[\s\S]*$/, '').trim().slice(0, PER_MESSAGE)}`)
    .join('\n\n')
    .slice(-TRANSCRIPT_MAX);
  const prompt = `Summarize this conversation between the person and Tether so it can go on without it. Keep decisions, facts, file paths, run ids and open questions. Plain prose, at most 200 words. Reply with the summary only.\n\n${transcript}`;
  const scratch = mkdtempSync(join(tmpdir(), 'tether-compact-'));
  let text: string;
  try {
    const res = await c.registry.get(o.agent).run({ runId: 'tether-assistant', nodeId: 'chat.compact', prompt, cwd: scratch, model: o.model, readOnly: true, lean: true, attempt: 1, timeoutMs: 120_000, signal: o.signal, onChunk: () => {}, onSession: () => {} });
    if (res.exitCode !== 0 || res.error) throw new Error((res.error ?? `the agent exited ${res.exitCode}`).split('\n')[0]!.slice(0, 300));
    text = res.output.trim().slice(0, SUMMARY_MAX);
    if (!text) throw new Error('the model returned no summary');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const s: ChatMessage = { id: `s${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, role: 'tether', text, at: Date.now(), compact: { count: fold.length, ...(o.auto ? { auto: true as const } : {}) } };
  const before = latestContext(chat.messages)?.use;
  for (const m of fold) m.compactedBy = s.id;
  chat.messages.splice(chat.messages.indexOf(fold.at(-1)!) + 1, 0, s);
  if (before) s.context = remeasure(before, messagesPart({ history: chat.messages, message: '' }));
  return s;
}

/** The last record with its messages part as the next prompt will carry it; a reported count moves by the estimated change. */
function remeasure(u: ContextUse, messages: [string, number][]): ContextUse {
  const change = estimate(sum(messages)) - estimate(sum(u.parts.messages));
  return { ...u, parts: { ...u.parts, messages }, ...(u.tokens !== undefined ? { tokens: Math.max(0, u.tokens + change) } : {}), about: true };
}

/** Undo the newest compaction: its summary goes, the messages it folded come back. False when there is none. */
export function undoCompact(chat: Chat): boolean {
  const s = chat.messages.findLast((m) => m.compact && !m.compactedBy);
  if (!s) return false;
  chat.messages = chat.messages.filter((m) => m !== s);
  for (const m of chat.messages) if (m.compactedBy === s.id) delete m.compactedBy;
  return true;
}
