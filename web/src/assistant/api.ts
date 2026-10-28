import type { AssistantContext, ChatMessage, ChatView, Proposal, StreamEvent, ToolAsk } from '../../../src/assistant/types.js';
import { api, ApiError } from '../api';

export type { AskCard, AssistantContext, ChatMessage, ChatView, Cite, Compare, Proposal, StreamEvent, ToolAsk, ToolRun } from '../../../src/assistant/types.js';
export { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX } from '../../../src/assistant/types.js';

const q = (ws: string | undefined) => (ws ? `?ws=${encodeURIComponent(ws)}` : '');

export interface SendBody {
  ws?: string;
  message: string;
  context?: AssistantContext;
  model?: string;
  attachments?: { name: string; text: string }[];
  /** This message answers the question card on that Tether message; the card collapses to `result`. */
  answer?: { message: string; result: string };
}

/** The assistant's routes (server: src/assistant/routes.ts). */
export const assistantApi = {
  chat: (ws: string | undefined) => api<ChatView>('GET', `/api/assistant${q(ws)}`),
  newChat: (ws: string | undefined) => api<{ messages: ChatMessage[] }>('POST', '/api/assistant/new', { ws }),
  decide: (ws: string | undefined, id: string, decision: 'start' | 'dismiss') => api<{ proposal: Proposal }>('POST', `/api/assistant/proposals/${encodeURIComponent(id)}`, { ws, decision }),
  turnIntoRun: (ws: string | undefined, from: string) => api<{ message: ChatMessage }>('POST', '/api/assistant/proposals', { ws, from }),
  tool: (ws: string | undefined, id: string, decision: 'once' | 'always' | 'deny') => api<{ ask: ToolAsk }>('POST', `/api/assistant/tools/${encodeURIComponent(id)}`, { ws, decision }),
  feedback: (ws: string | undefined, id: string, value: 'up' | 'down' | null) => api<{ ok: true }>('POST', `/api/assistant/feedback/${encodeURIComponent(id)}`, { ws, value }),
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
