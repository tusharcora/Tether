import { Bookmark, FoldVertical, ListX, Play, Shapes, Square, SquarePen } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { OrModel } from '../../../src/openrouter';
import { MessageQueue } from '../components/assistant-ui/elements/message-queue';
import { AIComposer, type SlashCommand } from '../components/composer/AIComposer';
import { TEAMS_PATH, type TeamsReply } from '../teams/teamsApi';
import { useNotify } from '../ui/notify';
import { cn } from '../ui/cn';
import { usePoll } from '../hooks';
import { MODELS_PATH, NV_MODELS_PATH } from '../settings/accountsApi';
import type { Route } from '../hooks';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type ArtifactRef, type AssistantContext } from './api';
import { ContextRing } from './ContextRing';
import { PromptsDialog } from './Prompts';
import { Thread } from './Thread';
import type { Assistant } from './useAssistant';

/** NVIDIA's models beside the bound agent's: one group, apart from OpenRouter's (whose `nvidia/…` models group as NVIDIA the maker). */
const NV_GROUP = 'NVIDIA (build.nvidia.com)';
const OR_GROUP = 'OpenRouter · free';

/** Escapes a name for a RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The crew bot a message @mentions first (it answers that turn on its own agent and model), if any. */
export const mentioned = (text: string, bots: { id: string; name: string }[]) => bots.map((b) => ({ b, at: text.search(new RegExp(`(^|\\s)@${esc(b.name)}\\b`)) })).filter((x) => x.at >= 0).sort((x, y) => x.at - y.at)[0]?.b;

/**
 * The prompt: text files, the model picker, dictation, send and stop. The picked model is kept per project and defaults
 * to the bound agent's. The draft can be held by the caller (the New chat screen's starters fill it). "/" lists what the
 * chat can do from here; "@" names a crew agent, who answers that message on its own agent and model; Prompts opens the
 * saved prompts.
 */
export function ChatComposer(p: { chat: Assistant; project?: string; context: AssistantContext; placeholder?: string; draft?: string; onDraft?: (v: string) => void; onSent?: () => void; onGo?: (r: Route) => void; onNewChat?: () => void }) {
  const { chat } = p;
  const notify = useNotify();
  const [library, setLibrary] = useState(false);
  // the crew agents an @mention can name, from the list the Teams screens use
  const crew = usePoll<TeamsReply>(TEAMS_PATH, 60_000).data?.agents ?? [];
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
    if (!t) return;
    setDraft('');
    const attachments = files;
    setFiles([]);
    p.onSent?.();
    const bot = mentioned(t, crew);
    void chat.send(t, { context: p.context, ...(bot ? { bot: bot.id } : { ...(m || picked ? { model: m ?? picked } : {}), ...agentFor(m ?? picked) }), ...(attachments.length ? { attachments } : {}) });
  };
  const last = chat.messages.at(-1);
  const commands = (
    [
      p.onNewChat && { name: 'new', description: 'Start a new chat', icon: SquarePen, run: p.onNewChat },
      chat.chatId && !chat.streaming && { name: 'compact', description: 'Summarize older messages to make room', icon: FoldVertical, run: () => void chat.compact().catch(notify.fail) },
      { name: 'prompts', description: 'Open your saved prompts', icon: Bookmark, run: () => setLibrary(true) },
      p.onGo && { name: 'artifacts', description: 'Open the pages and docs Tether made', icon: Shapes, run: () => p.onGo!({ tab: 'artifacts' }) },
      last?.role === 'tether' && !last.error && !chat.streaming && { name: 'run', description: 'Turn the last answer into a run', icon: Play, run: () => void chat.turnIntoRun(last.id).catch(notify.fail) },
      chat.queue.length > 0 && { name: 'clear', description: 'Drop the queued messages', icon: ListX, run: () => chat.queue.forEach((x) => chat.unqueue(x.id)) },
      chat.streaming && { name: 'stop', description: 'Stop the reply', icon: Square, run: chat.stop },
    ] as (SlashCommand | false | undefined | '')[]
  ).filter((c): c is SlashCommand => !!c);
  const read = async (list: File[]) => {
    const next = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.slice(0, ATTACH_MAX_BYTES).text() })));
    setFiles((cur) => [...cur, ...next].slice(0, ATTACH_MAX_FILES));
  };
  // on OpenRouter the menu says which models are free and what they can do (spec §7.4); on NVIDIA all are free at about 40 a minute
  const or = usePoll<{ models: OrModel[] }>(chat.agent === 'openrouter' || chat.openrouter ? MODELS_PATH : null, 3_600_000);
  const nv = usePoll<{ models: string[] }>(chat.agent === 'nvidia' || chat.nvidia ? NV_MODELS_PATH : null, 3_600_000);
  const tags = {
    ...(or.data && Object.fromEntries(or.data.models.map((m) => [m.id, [m.free && 'free', m.tools && 'tools', m.images && 'images'].filter((t): t is string => !!t)]))),
    ...Object.fromEntries((nv.data?.models ?? []).map((id) => [id, ['free', '40/min']])),
  };
  // Tether on another agent: OpenRouter's free models and NVIDIA's follow its own, and picking one runs that turn there
  const orFree = chat.openrouter ? (or.data?.models ?? []).filter((m) => m.free).map((m) => m.id) : [];
  const nvFree = chat.nvidia ? (nv.data?.models ?? []).filter((id) => !chat.models.includes(id)) : [];
  const orExtra = orFree.filter((id) => !chat.models.includes(id));
  // the agent's own models, then NVIDIA, then OpenRouter's free ones as one group (not one maker group each)
  const models = [...chat.models, ...nvFree, ...orExtra];
  const picked = model && models.includes(model) ? model : undefined;
  const agentFor = (m?: string) => (m && orFree.includes(m) && !chat.models.includes(m) ? { agent: 'openrouter' } : m && nvFree.includes(m) ? { agent: 'nvidia' } : {});
  return (
    <>
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
        queues
        onSubmit={send}
        files={files.map((f) => f.name)}
        onFiles={(f) => void read(f)}
        onRemoveFile={(name) => setFiles((c) => c.filter((x) => x.name !== name))}
        accept="text/*,.md,.json,.ts,.tsx,.js,.py,.log,.csv,.yml,.yaml"
        favKey="tether.assistant.favModels"
        tags={tags}
        extra={
          <>
            <button type="button" className="aic-pill" aria-label="Saved prompts" title="Saved prompts" onClick={() => setLibrary(true)}>
              <Bookmark size={15} aria-hidden="true" />
            </button>
            <ContextRing chat={chat} />
            {p.project ? (
              <label className="aic-goals" title="Asks to build, fix or do something come back as a goal you can start">
                <input type="checkbox" checked={chat.asksToGoals} onChange={(e) => void chat.setAsksToGoals(e.target.checked).catch(notify.fail)} />
                Turn asks into goals
              </label>
            ) : null}
          </>
        }
        groupOf={(m) => (nvFree.includes(m) ? NV_GROUP : orExtra.includes(m) ? OR_GROUP : undefined)}
        commands={commands}
        people={crew.filter((a) => /^\w+$/.test(a.name)).map((a) => ({ name: a.name, role: 'agent' as const }))}
      />
      <PromptsDialog ws={chat.ws} open={library} onOpenChange={setLibrary} onInsert={(body) => setDraft(draft.trim() ? `${draft.trimEnd()}\n${body}` : body)} />
    </>
  );
}

/** The conversation: the chat's thread and the composer. `wide`: the full screen's centred 760 px column. `idle`: shown under an empty chat. `onArtifact`: an artifact card was pressed. */
export function Chat(p: { chat: Assistant; project?: string; context: AssistantContext; onGo: (r: Route) => void; wide?: boolean; placeholder?: string; idle?: ReactNode; onArtifact?: (a: ArtifactRef) => void; onNewChat?: () => void }) {
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
          <Thread chat={chat} onGo={p.onGo} empty={`Ask about ${p.project ?? 'your work'}: what's running, a run's result, the code.`} project={p.project} onArtifact={p.onArtifact} />
          {p.idle && !chat.loading && !chat.messages.length && !chat.streaming ? p.idle : null}
        </div>
      </div>
      <div className={p.wide ? 'px-12 pt-3 pb-5' : 'p-3'}>
        <div className={column}>
          {chat.queue.length ? <MessageQueue className="mb-2 max-w-none" running={chat.messages.findLast((m) => m.role === 'you')?.text ?? ''} queued={chat.queue} onCancel={chat.unqueue} /> : null}
          <ChatComposer chat={chat} project={p.project} context={p.context} placeholder={p.placeholder} onSent={() => (pinned.current = true)} onGo={p.onGo} onNewChat={p.onNewChat} />
        </div>
      </div>
    </>
  );
}
