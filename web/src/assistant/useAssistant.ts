import { useCallback, useEffect, useRef, useState } from 'react';
import { assistantApi, streamTurn, type AssistantContext, type ChatMessage, type Proposal, type StreamEvent, type ToolRun } from './api';

/** The reply being written: its text so far and the Code Mode scripts it ran. */
export interface Streaming {
  id?: string;
  text: string;
  tools: ToolRun[];
}

export interface Assistant {
  messages: ChatMessage[];
  agent?: string;
  model?: string;
  models: string[];
  /** OpenRouter's free models can be picked too (Tether runs on another agent). */
  openrouter?: boolean;
  loading: boolean;
  error?: string;
  streaming?: Streaming;
  send(text: string, o?: { context?: AssistantContext; model?: string; agent?: string; attachments?: { name: string; text: string }[]; answer?: { message: string; result: string } }): Promise<void>;
  stop(): void;
  newChat(): Promise<void>;
  decide(proposal: Proposal, decision: 'start' | 'dismiss'): Promise<Proposal>;
  tool(messageId: string, askId: string, decision: 'once' | 'always' | 'deny'): Promise<void>;
  feedback(messageId: string, value: 'up' | 'down' | null): void;
  turnIntoRun(messageId: string): Promise<void>;
  /** Mark a question card answered locally (its answers go out as the next message). */
  answered(messageId: string, result: string): void;
}

const patch = (list: ChatMessage[], id: string, f: (m: ChatMessage) => ChatMessage) => list.map((m) => (m.id === id ? f(m) : m));

/**
 * The project's chat with Tether: loaded when the panel first opens on a project (and again when the project changes), then
 * kept here. A turn streams in (text, then Code Mode scripts as they run) and ends with the saved reply; Stop aborts it.
 */
export function useAssistant(ws: string | undefined, enabled: boolean): Assistant {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<{ agent?: string; model?: string; models: string[]; openrouter?: boolean }>({ models: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [streaming, setStreaming] = useState<Streaming>();
  const loadedFor = useRef<string | null>(null);
  const abort = useRef<AbortController | undefined>(undefined);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const key = ws ?? '';
    if (!enabled || loadedFor.current === key) return;
    loadedFor.current = key;
    abort.current?.abort();
    setStreaming(undefined);
    setLoading(true);
    setError(undefined);
    let live = true;
    assistantApi.chat(ws).then(
      (v) => {
        if (!live) return;
        setMessages(v.messages);
        setMeta({ agent: v.agent, model: v.model, models: v.models, openrouter: v.openrouter });
        setLoading(false);
      },
      (e: Error) => {
        if (!live) return;
        setMessages([]);
        setError(e.message);
        setLoading(false);
        loadedFor.current = null;
      },
    );
    return () => {
      live = false;
    };
  }, [ws, enabled]);

  const send: Assistant['send'] = useCallback(async (text, o = {}) => {
    if (abort.current) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const forWs = wsRef.current;
    let draft: Streaming = { text: '', tools: [] };
    setStreaming(draft);
    setError(undefined);
    const onEvent = (e: StreamEvent) => {
      if (forWs !== wsRef.current) return;
      if (e.type === 'start') {
        setMessages((l) => [...l, e.you]);
        draft = { ...draft, id: e.id };
      } else if (e.type === 'delta') draft = { ...draft, text: draft.text + e.text };
      else if (e.type === 'tool') draft = { ...draft, tools: [...draft.tools.filter((t) => t.id !== e.tool.id), e.tool] };
      else if (e.type === 'done') {
        setMessages((l) => [...l, e.message]);
        draft = { text: '', tools: [] };
        setStreaming(undefined);
        return;
      } else if (e.type === 'error') {
        setMessages((l) => [...l, { id: draft.id ?? `err-${Date.now()}`, role: 'tether', text: draft.text, at: Date.now(), error: e.error }]);
        setStreaming(undefined);
        return;
      }
      setStreaming(draft);
    };
    try {
      await streamTurn({ ws: forWs, message: text, ...(o.context ? { context: o.context } : {}), ...(o.model ? { model: o.model } : {}), ...(o.agent ? { agent: o.agent } : {}), ...(o.attachments?.length ? { attachments: o.attachments } : {}), ...(o.answer ? { answer: o.answer } : {}) }, onEvent, ctl.signal);
    } catch (e) {
      if (forWs === wsRef.current) {
        const stopped = ctl.signal.aborted;
        // a stopped turn keeps what was written; the server saves the same
        if (stopped && draft.id) setMessages((l) => [...l, { id: draft.id!, role: 'tether', text: draft.text, at: Date.now(), ...(draft.tools.length ? { tools: draft.tools } : {}), error: 'Stopped.' }]);
        else if (!stopped) setError((e as Error).message);
      }
    } finally {
      if (abort.current === ctl) abort.current = undefined;
      setStreaming((s) => (s === draft || ctl.signal.aborted ? undefined : s));
    }
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);

  return {
    messages,
    ...meta,
    loading,
    error,
    streaming,
    send,
    stop,
    newChat: async () => {
      abort.current?.abort();
      const r = await assistantApi.newChat(wsRef.current);
      setMessages(r.messages);
      setStreaming(undefined);
    },
    decide: async (proposal, decision) => {
      const { proposal: next } = await assistantApi.decide(wsRef.current, proposal.id, decision);
      setMessages((l) => l.map((m) => (m.proposals?.some((x) => x.id === next.id) ? { ...m, proposals: m.proposals.map((x) => (x.id === next.id ? next : x)) } : m)));
      return next;
    },
    tool: async (messageId, askId, decision) => {
      const { ask } = await assistantApi.tool(wsRef.current, askId, decision);
      setMessages((l) => patch(l, messageId, (m) => ({ ...m, toolAsks: m.toolAsks?.map((a) => (a.id === ask.id ? ask : a)) })));
    },
    feedback: (messageId, value) => {
      setMessages((l) => patch(l, messageId, (m) => ({ ...m, feedback: value ?? undefined })));
      void assistantApi.feedback(wsRef.current, messageId, value).catch(() => {});
    },
    turnIntoRun: async (messageId) => {
      const { message } = await assistantApi.turnIntoRun(wsRef.current, messageId);
      setMessages((l) => patch(l, messageId, () => message));
    },
    answered: (messageId, result) => setMessages((l) => patch(l, messageId, (m) => (m.ask ? { ...m, ask: { ...m.ask, status: 'answered', result } } : m))),
  };
}
