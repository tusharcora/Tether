import { Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PromptInput } from '../components/beui/agents/prompt-input';
import { UploadDropzone } from '../components/bencho/UploadDropzone';
import type { Route } from '../hooks';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type AssistantContext } from './api';
import { Thread } from './Thread';
import type { Assistant } from './useAssistant';

/** The conversation inside the panel: the project's thread, a dropzone for text files, and the prompt. */
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
  const setModel = (m: string) => {
    setModelState(m);
    try {
      localStorage.setItem(mkey, m);
    } catch {
      /* storage unavailable */
    }
  };
  const [attach, setAttach] = useState(false);
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
    setAttach(false);
    pinned.current = true;
    void chat.send(t, { context: p.context, ...(m || picked ? { model: m ?? picked } : {}), ...(attachments.length ? { attachments } : {}) });
  };
  const read = async (list: File[]) => {
    const next = await Promise.all(list.map(async (f) => ({ name: f.name, text: (await f.text()).slice(0, ATTACH_MAX_BYTES) })));
    setFiles((cur) => [...cur, ...next].slice(0, ATTACH_MAX_FILES));
  };
  const models = chat.models.map((m) => ({ value: m, label: m }));
  const picked = model && chat.models.includes(model) ? model : undefined;

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
      <div className="flex flex-col gap-2 border-t border-border p-3">
        {attach ? <UploadDropzone maxBytes={ATTACH_MAX_BYTES} maxFiles={ATTACH_MAX_FILES} accept="text/*,.md,.json,.ts,.tsx,.js,.py,.log,.csv,.yml,.yaml" onFiles={(f) => void read(f)} /> : null}
        {files.length ? (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span key={f.name} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} className="grid place-items-center border-0 bg-transparent p-0 text-muted-foreground" onClick={() => setFiles((c) => c.filter((x) => x !== f))}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <PromptInput
          aria-label="Message Tether"
          placeholder="Ask Tether…"
          value={draft}
          onValueChange={setDraft}
          minRows={1}
          maxRows={5}
          models={models.length > 1 ? models : undefined}
          model={picked ?? chat.model ?? models[0]?.value}
          onModelChange={setModel}
          loading={!!chat.streaming}
          onStop={chat.stop}
          onSubmit={send}
          leadingAction={
            <button type="button" className="tether-icon-btn" aria-label="Attach a file" aria-pressed={attach} onClick={() => setAttach((a) => !a)}>
              <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          }
        />
      </div>
    </>
  );
}
