import { useEffect, useRef, useState } from 'react';
import type { OrModel } from '../../../src/openrouter';
import { AIComposer } from '../components/composer/AIComposer';
import { usePoll } from '../hooks';
import { MODELS_PATH } from '../settings/accountsApi';
import type { Route } from '../hooks';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type AssistantContext } from './api';
import { Thread } from './Thread';
import type { Assistant } from './useAssistant';

/** The conversation inside the panel: the project's thread and the composer (text files, model picker, dictation). */
export function Chat(p: { chat: Assistant; project?: string; context: AssistantContext; onGo: (r: Route) => void }) {
  const { chat } = p;
  const [draft, setDraft] = useState('');
  // the picked model is kept per project (the panel remounts when it docks), and defaults to the bound agent's model
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
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // follow the reply as it streams, unless the person scrolled up
  useEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming]);

  const send = (text: string, m?: string) => {
    const t = text.trim().slice(0, MESSAGE_MAX);
    if (!t || chat.streaming) return;
    setDraft('');
    const attachments = files;
    setFiles([]);
    pinned.current = true;
    void chat.send(t, { context: p.context, ...(m || picked ? { model: m ?? picked } : {}), ...(attachments.length ? { attachments } : {}) });
  };
  const read = async (list: File[]) => {
    const next = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.slice(0, ATTACH_MAX_BYTES).text() })));
    setFiles((cur) => [...cur, ...next].slice(0, ATTACH_MAX_FILES));
  };
  const picked = model && chat.models.includes(model) ? model : undefined;
  // on OpenRouter the menu says which models are free and what they can do (spec §7.4)
  const or = usePoll<{ models: OrModel[] }>(chat.agent === 'openrouter' ? MODELS_PATH : null, 3_600_000);
  const tags = or.data && Object.fromEntries(or.data.models.map((m) => [m.id, [m.free && 'free', m.tools && 'tools', m.images && 'images'].filter((t): t is string => !!t)]));

  return (
    <>
      <div
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4"
        role="log"
        aria-label="Conversation with Tether"
        aria-busy={!!chat.streaming}
      >
        <Thread chat={chat} onGo={p.onGo} empty={`Ask about ${p.project ?? 'your work'}: what's running, a run's result, the code.`} />
      </div>
      <div className="p-3">
        <AIComposer
          aria-label="Message Tether"
          placeholder="Ask Tether…"
          value={draft}
          onValueChange={setDraft}
          models={chat.models}
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
        />
      </div>
    </>
  );
}
