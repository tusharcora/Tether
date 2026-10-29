import { useEffect, useRef, useState } from 'react';
import type { OrModel } from '../../../src/openrouter';
import { AIComposer } from '../components/composer/AIComposer';
import { cn } from '../ui/cn';
import { usePoll } from '../hooks';
import { MODELS_PATH } from '../settings/accountsApi';
import type { Route } from '../hooks';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type AssistantContext } from './api';
import { ContextRing } from './ContextRing';
import { Thread } from './Thread';
import type { Assistant } from './useAssistant';

/**
 * The prompt: text files, the model picker, dictation, send and stop. The picked model is kept per project and defaults
 * to the bound agent's. The draft can be held by the caller (the New chat screen's starters fill it).
 */
export function ChatComposer(p: { chat: Assistant; project?: string; context: AssistantContext; placeholder?: string; draft?: string; onDraft?: (v: string) => void; onSent?: () => void }) {
  const { chat } = p;
  const [own, setOwn] = useState('');
  const draft = p.draft ?? own;
  const setDraft = p.onDraft ?? setOwn;
  const mkey = `tether.assistant.model.${p.project ?? '_'}`;
  const [model, setModelState] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(mkey) ?? undefined;
    } catch {
      return undefined;
    }
  });
  // undefined is Auto: no override, the bound agent's model answers
  const setModel = (m: string | undefined) => {
    setModelState(m);
    try {
      if (m === undefined) localStorage.removeItem(mkey);
      else localStorage.setItem(mkey, m);
    } catch {
      /* storage unavailable */
    }
  };
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const send = (text: string, m?: string) => {
    const t = text.trim().slice(0, MESSAGE_MAX);
    if (!t || chat.streaming) return;
    setDraft('');
    const attachments = files;
    setFiles([]);
    p.onSent?.();
    void chat.send(t, { context: p.context, ...(m || picked ? { model: m ?? picked } : {}), ...agentFor(m ?? picked), ...(attachments.length ? { attachments } : {}) });
  };
  const read = async (list: File[]) => {
    const next = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.slice(0, ATTACH_MAX_BYTES).text() })));
    setFiles((cur) => [...cur, ...next].slice(0, ATTACH_MAX_FILES));
  };
  // on OpenRouter the menu says which models are free and what they can do (spec §7.4)
  const or = usePoll<{ models: OrModel[] }>(chat.agent === 'openrouter' || chat.openrouter ? MODELS_PATH : null, 3_600_000);
  const tags = or.data && Object.fromEntries(or.data.models.map((m) => [m.id, [m.free && 'free', m.tools && 'tools', m.images && 'images'].filter((t): t is string => !!t)]));
  // Tether on another agent: OpenRouter's free models follow its own, and picking one runs that turn on OpenRouter
  const orFree = chat.openrouter ? (or.data?.models ?? []).filter((m) => m.free).map((m) => m.id) : [];
  const models = [...chat.models, ...orFree.filter((id) => !chat.models.includes(id))];
  const picked = model && models.includes(model) ? model : undefined;
  const agentFor = (m?: string) => (m && orFree.includes(m) && !chat.models.includes(m) ? { agent: 'openrouter' } : {});
  return (
    <AIComposer
      aria-label="Message Tether"
      placeholder={p.placeholder ?? 'Ask Tether…'}
      value={draft}
      onValueChange={setDraft}
      models={models}
      model={picked}
      autoModel={chat.model}
      onModelChange={setModel}
      loading={!!chat.streaming}
      onStop={chat.stop}
      onSubmit={send}
      files={files.map((f) => f.name)}
      onFiles={(f) => void read(f)}
      onRemoveFile={(name) => setFiles((c) => c.filter((x) => x.name !== name))}
      accept="text/*,.md,.json,.ts,.tsx,.js,.py,.log,.csv,.yml,.yaml"
      favKey="tether.assistant.favModels"
      tags={tags}
      extra={<ContextRing chat={chat} />}
    />
  );
}

/** The conversation: the chat's thread and the composer. `wide`: the full screen's centred 760 px column. */
export function Chat(p: { chat: Assistant; project?: string; context: AssistantContext; onGo: (r: Route) => void; wide?: boolean; placeholder?: string }) {
  const { chat } = p;
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // follow the reply as it streams, unless the person scrolled up
  useEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming]);

  const column = p.wide ? 'mx-auto w-full max-w-[760px]' : '';
  return (
    <>
      <div
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className={cn('flex min-h-0 flex-1 flex-col overflow-auto', p.wide ? 'px-12 py-7' : 'p-4')}
        role="log"
        aria-label="Conversation with Tether"
        aria-busy={!!chat.streaming}
      >
        <div className={cn('flex flex-col gap-3', column)}>
          <Thread chat={chat} onGo={p.onGo} empty={`Ask about ${p.project ?? 'your work'}: what's running, a run's result, the code.`} />
        </div>
      </div>
      <div className={p.wide ? 'px-12 pt-3 pb-5' : 'p-3'}>
        <div className={column}>
          <ChatComposer chat={chat} project={p.project} context={p.context} placeholder={p.placeholder} onSent={() => (pinned.current = true)} />
        </div>
      </div>
    </>
  );
}
