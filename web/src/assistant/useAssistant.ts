import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { assistantApi, streamTurn, type AssistantContext, type ChatMessage, type GoalDraft, type Proposal, type StreamEvent, type ToolRun } from './api';

/** The reply being written: its text so far and the Code Mode scripts it ran. */
export interface Streaming {
  id?: string;
  text: string;
  tools: ToolRun[];
  /** When the question went out (the timeline's clock). */
  startedAt: number;
}

export interface Assistant {
  /** The project the chat is in (none: the chats with no project). */
  ws?: string;
  /** The open chat; none is a new chat, saved by its first message. */
  chatId?: string;
  title?: string;
  messages: ChatMessage[];
  agent?: string;
  model?: string;
  models: string[];
  /** OpenRouter's free models can be picked too (Tether runs on another agent). */
  openrouter?: boolean;
  /** NVIDIA's free models can be picked too (Tether runs on another agent). */
  nvidia?: boolean;
  loading: boolean;
  error?: string;
  streaming?: Streaming;
  /** A Compact now or Undo is under way. */
  compacting: boolean;
  /** Summarize the older messages (one model call), or with `undo` put the newest compaction's messages back. */
  compact(undo?: boolean): Promise<void>;
  /** While a reply streams, a message waits in `queue` and goes out when the reply is over. */
  send(text: string, o?: SendOptions): Promise<void>;
  /** Messages sent while a reply streamed, oldest first. */
  queue: { id: string; text: string }[];
  unqueue(id: string): void;
  /** Ask a reply's question again: in its place when it is the latest, else as a new message. */
  regenerate(messageId: string): Promise<void>;
  /** Try the last thing that failed again (loading the chat, or sending). */
  retry(): void;
  /** Drop a stopped or failed reply. */
  discard(messageId: string): Promise<void>;
  stop(): void;
  /** Read the chat again (a turn made elsewhere); not while a reply streams. */
  refresh(): void;
  rename(title: string): Promise<void>;
  /** A goal card's Start carries its edits (`draft`). */
  decide(proposal: Proposal, decision: 'start' | 'dismiss', draft?: GoalDraft): Promise<Proposal>;
  /** Asks to build, fix or do something come back as goal cards (the composer's switch). */
  asksToGoals: boolean;
  setAsksToGoals(on: boolean): Promise<void>;
  tool(messageId: string, askId: string, decision: 'once' | 'always' | 'deny'): Promise<void>;
  feedback(messageId: string, value: 'up' | 'down' | null, why?: { reasons: string[]; note?: string }): void;
  turnIntoRun(messageId: string): Promise<void>;
  /** Mark a question card answered locally (its answers go out as the next message). */
  answered(messageId: string, result: string): void;
}

export interface SendOptions {
  context?: AssistantContext;
  model?: string;
  agent?: string;
  bot?: string;
  attachments?: { name: string; text: string }[];
  answer?: { message: string; result: string };
  regenerate?: string;
}

/** The messages left once `id` and the question before it are dropped (as the server does for a regenerate). */
export function withoutTurn(list: ChatMessage[], id: string): ChatMessage[] {
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return list;
  const q = list.slice(0, i).findLastIndex((m) => m.role === 'you');
  return list.slice(0, q >= 0 ? q : i);
}

const patch = (list: ChatMessage[], id: string, f: (m: ChatMessage) => ChatMessage) => list.map((m) => (m.id === id ? f(m) : m));
const keyOf = (ws: string | undefined, chat: string | undefined) => `${ws ?? ''}\0${chat ?? ''}`;

/**
 * One chat with Tether (`chatId` in the project `ws`; none is a new chat): loaded when enabled and whenever the project or
 * the chat changes, then kept here. A turn streams in (text, then Code Mode scripts as they run) and ends with the saved
 * reply; Stop aborts it, and so does moving to another chat or project. A new chat's first message makes it: `created`
 * gets its id and must make `chatId` follow. A chat that is gone (deleted, another project's) calls `gone`.
 */
export function useAssistant(ws: string | undefined, chatId: string | undefined, enabled: boolean, on: { created?: (id: string) => void; gone?: (id: string) => void } = {}): Assistant {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState<string>();
  const [meta, setMeta] = useState<{ agent?: string; model?: string; models: string[]; openrouter?: boolean; nvidia?: boolean; asksToGoals: boolean }>({ models: [], asksToGoals: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [streaming, setStreaming] = useState<Streaming>();
  const [compacting, setCompacting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [queue, setQueueState] = useState<(Assistant['queue'][number] & { o: SendOptions })[]>([]);
  const queued = useRef(queue);
  const setQueue = (q: typeof queue) => ((queued.current = q), setQueueState(q));
  const failed = useRef<(() => void) | undefined>(undefined);
  const loadedFor = useRef<string | null>(null);
  const abort = useRef<AbortController | undefined>(undefined);
  const ref = useRef({ ws, chatId, key: keyOf(ws, chatId), on });
  ref.current = { ws, chatId, key: keyOf(ws, chatId), on };

  useEffect(() => {
    const key = keyOf(ws, chatId);
    if (!enabled || loadedFor.current === key) return;
    loadedFor.current = key;
    abort.current?.abort();
    setQueue([]);
    setStreaming(undefined);
    setLoading(true);
    setError(undefined);
    let live = true;
    assistantApi.chat(ws, chatId).then(
      (v) => {
        if (!live) return;
        setMessages(v.messages);
        setTitle(v.title);
        setMeta({ agent: v.agent, model: v.model, models: v.models, openrouter: v.openrouter, nvidia: v.nvidia, asksToGoals: v.asksToGoals !== false });
        setLoading(false);
      },
      (e: Error) => {
        if (!live) return;
        setMessages([]);
        setTitle(undefined);
        setLoading(false);
        loadedFor.current = null;
        if (chatId && e instanceof ApiError && e.status === 404) ref.current.on.gone?.(chatId);
        else (setError(e.message), (failed.current = () => setNonce((n) => n + 1)));
      },
    );
    return () => {
      live = false;
    };
  }, [ws, chatId, enabled, nonce]);

  const send: Assistant['send'] = useCallback(async (text, o = {}) => {
    if (abort.current) return void setQueue([...queued.current, { id: `q-${Date.now().toString(36)}${queued.current.length}`, text, o }]);
    const ctl = new AbortController();
    abort.current = ctl;
    const { ws: forWs, chatId: forChat } = ref.current;
    let forKey = ref.current.key;
    let draft: Streaming = { text: '', tools: [], startedAt: Date.now() };
    setStreaming(draft);
    setError(undefined);
    const onEvent = (e: StreamEvent) => {
      if (forKey !== ref.current.key) return;
      if (e.type === 'start') {
        if (!forChat) {
          // this message made the chat: from here on it is the open one, with nothing to load
          forKey = ref.current.key = loadedFor.current = keyOf(forWs, e.chat);
          setTitle(e.title);
          ref.current.on.created?.(e.chat);
        }
        setMessages((l) => [...(o.regenerate ? withoutTurn(l, o.regenerate) : l), e.you]);
        draft = { ...draft, id: e.id };
      } else if (e.type === 'delta') draft = { ...draft, text: draft.text + e.text };
      else if (e.type === 'tool') draft = { ...draft, tools: [...draft.tools.filter((t) => t.id !== e.tool.id), e.tool] };
      // the context ran full: the server summarized older messages before this turn
      else if (e.type === 'compacted') setMessages(e.messages);
      else if (e.type === 'done') {
        setMessages((l) => [...l, e.message]);
        // no id left: a Stop after the reply arrived adds nothing
        draft = { text: '', tools: [], startedAt: draft.startedAt };
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
      await streamTurn({ ws: forWs, ...(forChat ? { chat: forChat } : {}), message: text, ...(o.context ? { context: o.context } : {}), ...(o.model ? { model: o.model } : {}), ...(o.agent ? { agent: o.agent } : {}), ...(o.bot ? { bot: o.bot } : {}), ...(o.attachments?.length ? { attachments: o.attachments } : {}), ...(o.answer ? { answer: o.answer } : {}), ...(o.regenerate ? { regenerate: o.regenerate } : {}) }, onEvent, ctl.signal);
    } catch (e) {
      if (forKey === ref.current.key) {
        const stopped = ctl.signal.aborted;
        // a stopped turn keeps what was written; the server saves the same
        if (stopped && draft.id) setMessages((l) => [...l, { id: draft.id!, role: 'tether', text: draft.text, at: Date.now(), ...(draft.tools.length ? { tools: draft.tools } : {}), error: 'Stopped.' }]);
        else if (!stopped) (setError((e as Error).message), (failed.current = () => void send(text, o)));
      }
    } finally {
      if (abort.current === ctl) abort.current = undefined;
      setStreaming((s) => (s === draft || ctl.signal.aborted ? undefined : s));
      // the next queued message goes out now the turn is over, in this chat only
      const next = queued.current[0];
      if (next && !abort.current && forKey === ref.current.key) (setQueue(queued.current.slice(1)), void send(next.text, next.o));
    }
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);
  const chat = () => ref.current.chatId;

  return {
    ws,
    chatId,
    title,
    messages,
    ...meta,
    loading,
    error,
    streaming,
    compacting,
    compact: async (undo) => {
      const id = chat();
      if (!id) return;
      setCompacting(true);
      try {
        const r = await assistantApi.compact(ref.current.ws, id, undo);
        if (chat() === id) setMessages(r.messages);
      } finally {
        setCompacting(false);
      }
    },
    send,
    queue: queue.map(({ id, text }) => ({ id, text })),
    unqueue: (id) => setQueue(queued.current.filter((x) => x.id !== id)),
    regenerate: async (messageId) => {
      const i = messages.findIndex((m) => m.id === messageId);
      const question = messages.slice(0, i).findLast((m) => m.role === 'you');
      if (i < 0 || !question) return;
      // on the agent and model that answered (the page it was asked on is not kept)
      const use = messages[i]!.context;
      const on = { ...(use?.model ? { model: use.model } : {}), ...(use?.agent ? { agent: use.agent } : {}) };
      await send(question.text, i === messages.length - 1 ? { ...on, regenerate: messageId } : on);
    },
    retry: () => {
      const f = failed.current;
      failed.current = undefined;
      setError(undefined);
      f?.();
    },
    discard: async (messageId) => {
      const id = chat();
      setMessages((l) => l.filter((m) => m.id !== messageId));
      if (id) await assistantApi.discard(ref.current.ws, id, messageId);
    },
    stop,
    refresh: () => {
      if (abort.current) return;
      loadedFor.current = null;
      setNonce((n) => n + 1);
    },
    rename: async (t) => {
      const id = chat();
      if (!id) return;
      const r = await assistantApi.rename(ref.current.ws, id, t);
      if (chat() === id) setTitle(r.chat.title);
    },
    setAsksToGoals: async (on) => {
      setMeta((m) => ({ ...m, asksToGoals: on }));
      try {
        await assistantApi.settings(on);
      } catch (e) {
        setMeta((m) => ({ ...m, asksToGoals: !on }));
        throw e;
      }
    },
    decide: async (proposal, decision, draft) => {
      const { proposal: next } = await assistantApi.decide(ref.current.ws, chat(), proposal.id, decision, draft);
      setMessages((l) => l.map((m) => (m.proposals?.some((x) => x.id === next.id) ? { ...m, proposals: m.proposals.map((x) => (x.id === next.id ? next : x)) } : m)));
      return next;
    },
    tool: async (messageId, askId, decision) => {
      const { ask } = await assistantApi.tool(ref.current.ws, chat(), askId, decision);
      setMessages((l) => patch(l, messageId, (m) => ({ ...m, toolAsks: m.toolAsks?.map((a) => (a.id === ask.id ? ask : a)) })));
    },
    feedback: (messageId, value, why) => {
      setMessages((l) => patch(l, messageId, (m) => ({ ...m, feedback: value ?? undefined, ...(why ? { feedbackNote: why } : {}) })));
      void assistantApi.feedback(ref.current.ws, chat(), messageId, value, why).catch(() => {});
    },
    turnIntoRun: async (messageId) => {
      const { message } = await assistantApi.turnIntoRun(ref.current.ws, chat(), messageId);
      setMessages((l) => patch(l, messageId, () => message));
    },
    answered: (messageId, result) => setMessages((l) => patch(l, messageId, (m) => (m.ask ? { ...m, ask: { ...m.ask, status: 'answered', result } } : m))),
  };
}

const ACTIVE = (ws: string | undefined) => `tether.assistant.chat.${ws ?? '_'}`;
function storedActive(ws: string | undefined): string | undefined {
  try {
    return localStorage.getItem(ACTIVE(ws)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The chat open in the mini chat and on the full screen, one per project, remembered on this device (none: a new chat). */
export function useActiveChat(ws: string | undefined): [string | undefined, (id: string | undefined) => void] {
  const [state, setState] = useState(() => ({ ws, id: storedActive(ws) }));
  const id = state.ws === ws ? state.id : storedActive(ws);
  const set = useCallback(
    (next: string | undefined) => {
      try {
        if (next) localStorage.setItem(ACTIVE(ws), next);
        else localStorage.removeItem(ACTIVE(ws));
      } catch {
        /* storage unavailable */
      }
      setState({ ws, id: next });
    },
    [ws],
  );
  return [id, set];
}
