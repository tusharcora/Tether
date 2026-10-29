import type { AssistantContext, ChatMessage, ChatSummary, ChatView, Proposal, StreamEvent, ToolAsk } from '../../../src/assistant/types.js';
import { api, ApiError } from '../api';

export type { AskCard, AssistantContext, ChatMessage, ChatSummary, ChatView, Choice, Cite, Compare, ContextUse, Diagram, OutcomeNode, Proposal, Report, Retrieved, Spec, StreamEvent, TimelineEvent, ToolAsk, ToolRun } from '../../../src/assistant/types.js';
export { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, TITLE_MAX } from '../../../src/assistant/types.js';

/** `?ws=…&chat=…` with the parts that are set. */
const q = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};
/** Where the chat list is read (polled by the sidebar and All chats). */
export const chatsPath = (ws: string | undefined, search?: string) => `/api/assistant/chats${q({ ws, q: search })}`;

export interface SendBody {
  ws?: string;
  /** The chat this message goes to; none starts a new chat (the start event names it). */
  chat?: string;
  message: string;
  context?: AssistantContext;
  model?: string;
  agent?: string;
  attachments?: { name: string; text: string }[];
  /** This message answers the question card on that Tether message; the card collapses to `result`. */
  answer?: { message: string; result: string };
  /** Ask again in place of this reply (the latest): it and its question are dropped first. */
  regenerate?: string;
}

/** The assistant's routes (server: src/assistant/routes.ts). */
export const assistantApi = {
  /** One chat; no `chat`: a new chat's view (no messages). */
  chat: (ws: string | undefined, chat?: string) => api<ChatView>('GET', `/api/assistant${q({ ws, chat })}`),
  rename: (ws: string | undefined, chat: string, title: string) => api<{ chat: ChatSummary }>('PATCH', `/api/assistant/chats/${encodeURIComponent(chat)}`, { ws, title }),
  remove: (ws: string | undefined, chat: string) => api<{ ok: true }>('DELETE', `/api/assistant/chats/${encodeURIComponent(chat)}${q({ ws })}`),
  decide: (ws: string | undefined, chat: string | undefined, id: string, decision: 'start' | 'dismiss') => api<{ proposal: Proposal }>('POST', `/api/assistant/proposals/${encodeURIComponent(id)}`, { ws, chat, decision }),
  turnIntoRun: (ws: string | undefined, chat: string | undefined, from: string) => api<{ message: ChatMessage }>('POST', '/api/assistant/proposals', { ws, chat, from }),
  tool: (ws: string | undefined, chat: string | undefined, id: string, decision: 'once' | 'always' | 'deny') => api<{ ask: ToolAsk }>('POST', `/api/assistant/tools/${encodeURIComponent(id)}`, { ws, chat, decision }),
  feedback: (ws: string | undefined, chat: string | undefined, id: string, value: 'up' | 'down' | null, why?: { reasons: string[]; note?: string }) => api<{ ok: true }>('POST', `/api/assistant/feedback/${encodeURIComponent(id)}`, { ws, chat, value, ...why }),
  /** Drop a stopped or failed reply. */
  discard: (ws: string | undefined, chat: string, id: string) => api<{ ok: true }>('DELETE', `/api/assistant/messages/${encodeURIComponent(id)}${q({ ws, chat })}`),
  /** Compact now (a summary of the older messages) or, with `undo`, put the newest compaction's messages back. */
  compact: (ws: string | undefined, chat: string, undo?: boolean) => api<{ messages: ChatMessage[] }>('POST', '/api/assistant/compact', { ws, chat, ...(undo ? { undo: true } : {}) }),
};

/**
 * One turn, streamed. EventSource cannot POST, so this reads the `text/event-stream` body with fetch. Each `data:` line is
 * one StreamEvent. Aborting the signal stops the turn (the server stops the agent when the connection closes).
 */
export async function streamTurn(body: SendBody, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as StreamEvent);
      } catch {
        /* a malformed frame: skip it */
      }
    }
  }
}
