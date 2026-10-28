import { useState } from 'react';
import type { Route } from '../hooks';
import type { AssistantContext } from './api';
import type { Assistant } from './useAssistant';

/** The conversation inside the panel: the project's messages and a field to write to Tether. */
export function Chat(p: { chat: Assistant; project?: string; context: AssistantContext; onGo: (r: Route) => void }) {
  const [draft, setDraft] = useState('');
  const { chat } = p;
  const send = () => {
    const text = draft.trim();
    if (!text || chat.streaming) return;
    setDraft('');
    void chat.send(text, { context: p.context });
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" role="log" aria-label="Conversation with Tether" aria-busy={!!chat.streaming}>
        {chat.loading ? <p className="m-0 text-muted-foreground">Loading the chat…</p> : null}
        {chat.error ? <p className="m-0 text-danger">{chat.error}</p> : null}
        {!chat.loading && !chat.messages.length && !chat.streaming ? <p className="m-0 text-muted-foreground">{`Ask about ${p.project ?? 'your work'}: what's running, a run's result, the code.`}</p> : null}
        {chat.messages.map((m) => (
          <div key={m.id} className={m.role === 'you' ? 'self-end max-w-[80%] rounded-xl bg-muted px-3 py-2' : 'max-w-[86%]'} data-role={m.role}>
            {m.text}
          </div>
        ))}
        {chat.streaming ? <div className="max-w-[86%]" data-role="tether">{chat.streaming.text}</div> : null}
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea className="min-h-9 flex-1 resize-none" aria-label="Message Tether" value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} />
        <button type="submit" className="primary" disabled={!draft.trim() || !!chat.streaming}>
          Send
        </button>
      </form>
    </>
  );
}
