/**
 * The context window, shared by the server (auto-compact) and the dashboard (the composer's ring): how full the answering
 * model's context is from what the last turn sent. Sizes come from the agent's reported count when there is one, else from
 * characters (about 4 to a token). Pure: the web imports it.
 */
import type { ChatMessage, ContextUse } from './types.js';

/** Room kept for the reply. */
export const RESERVED = 8000;
/** Auto-compact when a turn would pass this share of the context. */
export const AUTO_COMPACT = 0.9;
/** Messages a compaction keeps as they are. */
export const KEEP = 4;
/** Fewer older messages than this: nothing worth a model call. */
export const MIN_FOLD = 2;

export type PartKey = keyof ContextUse['parts'] | 'reserved' | 'free';
export const PART_LABEL: Record<PartKey, string> = { prompt: "Tether's prompt", tools: 'Tools', memory: 'Memory', messages: 'Messages', reserved: 'Reserved', free: 'Free' };
export const OWN = "Agent's own prompt and tools";

export interface ContextPart {
  key: PartKey;
  label: string;
  tokens: number;
  items: [string, number][];
}
export interface ContextView {
  parts: ContextPart[];
  used: number;
  size: number;
  pct: number;
  /** An estimate, not the agent's count. */
  about: boolean;
  /** Tokens left before auto-compact. */
  untilAuto: number;
}

export const estimate = (chars: number) => Math.ceil(chars / 4);

/** Context sizes Tether knows without asking anyone: Claude's. OpenRouter's come from its models list (server). */
export function knownSize(agent: string, model?: string): number | undefined {
  if (agent !== 'claude') return undefined;
  return model?.includes('[1m]') ? 1_000_000 : 200_000;
}

/** The ring's numbers; undefined when the model's size is unknown. */
export function contextView(u: ContextUse): ContextView | undefined {
  if (!u.size) return undefined;
  const keys = ['prompt', 'tools', 'memory', 'messages'] as const;
  const sent = keys.map((key) => ({ key, items: u.parts[key].map(([l, c]): [string, number] => [l, estimate(c)]) }));
  const est = sent.reduce((a, p) => a + p.items.reduce((b, [, t]) => b + t, 0), 0);
  if (u.tokens !== undefined && u.tokens >= est) {
    // what the agent counted beyond what Tether sent: its own system prompt and tool definitions
    if (u.tokens > est) sent[1]!.items.push([OWN, u.tokens - est]);
  } else if (u.tokens !== undefined && est > 0) {
    const k = u.tokens / est;
    for (const p of sent) p.items = p.items.map(([l, t]) => [l, Math.round(t * k)]);
  }
  const parts: ContextPart[] = sent.map((p) => ({ key: p.key, label: PART_LABEL[p.key], tokens: p.items.reduce((a, [, t]) => a + t, 0), items: p.items }));
  parts.push({ key: 'reserved', label: PART_LABEL.reserved, tokens: RESERVED, items: [['Room for the reply', RESERVED]] });
  const used = parts.reduce((a, p) => a + p.tokens, 0);
  const free = Math.max(0, u.size - used);
  parts.push({ key: 'free', label: PART_LABEL.free, tokens: free, items: [['Left for this chat', free]] });
  return { parts, used, size: u.size, pct: Math.min(100, Math.round((used / u.size) * 100)), about: u.tokens === undefined || !!u.about, untilAuto: Math.max(0, Math.round(AUTO_COMPACT * u.size) - used) };
}

/** Would a turn adding `extraChars` pass the auto-compact line? Never for an unknown size. */
export function overflows(u: ContextUse, extraChars: number): boolean {
  const v = contextView(u);
  return !!v && v.used + estimate(extraChars) > AUTO_COMPACT * v.size;
}

/** What a compaction folds: every message not already folded, but the last KEEP. */
export function foldable(messages: ChatMessage[]): ChatMessage[] {
  const live = messages.filter((m) => !m.compactedBy);
  return live.slice(0, Math.max(0, live.length - KEEP));
}

/** The newest context record by time: a turn's, or a summary's (it sits before the kept messages but is newer than them). */
export function latestContext(messages: ChatMessage[]): { use: ContextUse; summary: boolean } | undefined {
  let best: ChatMessage | undefined;
  for (const m of messages) if (m.context && !m.compactedBy && (!best || m.at >= best.at)) best = m;
  return best && { use: best.context!, summary: !!best.compact };
}
