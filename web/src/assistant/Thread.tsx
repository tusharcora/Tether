import { FileCode2, NotebookText, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { SWITCH_MODEL } from '../../../src/openrouter';
import type { Route } from '../hooks';
import { ComparisonTable } from '../components/aicss/ComparisonTable';
import { Citations, type CitationItem } from '../components/beui/agents/citations';
import { StreamingResponse } from '../components/beui/agents/streaming-response';
import type { ChatMessage, Cite } from './api';
import type { Assistant } from './useAssistant';
import { Markdown } from './Markdown';
import { AskCardView, ProposalCard, ToolAskCard } from './cards';
import { Thinking } from './Thinking';
import { useNotify } from '../ui/notify';
import { cn } from '../ui/cn';

/** Where a citation goes: file:line opens Code, a run opens its page, a note opens the Graph. */
export function routeOf(c: Cite): Route {
  if (c.kind === 'file') return { tab: 'code', id: c.path, ...(c.line ? { line: c.line } : {}) };
  if (c.kind === 'run') return { tab: 'runs', id: c.id };
  return { tab: 'graph', id: c.path };
}

const ICON = { file: FileCode2, run: Play, note: NotebookText } as const;

export function citationItems(cites: Cite[], onGo: (r: Route) => void): CitationItem[] {
  return cites.map((c) => {
    const Icon = ICON[c.kind];
    return {
      id: `c${c.n}`,
      title: c.label,
      domain: c.kind === 'file' ? `${c.path}${c.line ? `:${c.line}` : ''}` : c.kind === 'run' ? `run ${c.id}` : c.path,
      icon: <Icon aria-hidden="true" />,
      onOpen: () => onGo(routeOf(c)),
    };
  });
}

/** The reply's visible text: the trailing ```tether block (sources, proposals, ...) is data, never shown, even half-written. */
export const visibleText = (text: string) => {
  const i = text.indexOf('```tether');
  return (i >= 0 ? text.slice(0, i) : text).trimEnd();
};

/** `asked`: when the question was sent, so the finished timeline says how long Tether thought. */
function TetherMessage({ m, asked, chat, onGo, dim }: { m: ChatMessage; asked?: number; chat: Assistant; onGo: (r: Route) => void; dim?: boolean }) {
  const text = visibleText(m.text);
  return (
    <div className={cn('max-w-[92%]', dim && 'opacity-60')} data-role="tether">
      {m.tools?.length ? <Thinking tools={m.tools} ms={asked !== undefined ? m.at - asked : undefined} /> : null}
      {text || m.error ? (
        <StreamingResponse
          status={m.error && m.error !== 'Stopped.' ? 'error' : 'complete'}
          announce={false}
          copyText={text}
          sources={m.cites?.length ? citationItems(m.cites, onGo) : undefined}
          feedback={m.feedback ?? null}
          onFeedbackChange={(v) => chat.feedback(m.id, v)}
          sourceIdPrefix={`src-${m.id}`}
        >
          <Markdown text={text} cites={new Set((m.cites ?? []).map((c) => c.n))} idPrefix={`src-${m.id}`} onCite={(n) => { const c = m.cites?.find((x) => x.n === n); if (c) onGo(routeOf(c)); }} />
          {m.error?.endsWith(SWITCH_MODEL) ? (
            // out of free requests: the model the assistant runs on is the Tether bot's, in its Runs on
            <p className="m-0 mt-2 text-danger">
              {m.error.slice(0, -SWITCH_MODEL.length)} ·{' '}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-danger underline" onClick={() => onGo({ tab: 'crew', id: 'orchestrator' })}>
                Switch model
              </button>
            </p>
          ) : m.error ? (
            <p className="m-0 mt-2 text-danger">{m.error}</p>
          ) : null}
        </StreamingResponse>
      ) : null}
      {m.compare ? (
        <div className="mt-2">
          <ComparisonTable title={m.compare.title} columns={m.compare.columns} rows={m.compare.rows} />
        </div>
      ) : null}
      {m.ask ? <AskCardView message={m} chat={chat} /> : null}
      {m.toolAsks?.map((a) => <ToolAskCard key={a.id} ask={a} onDecide={(d) => chat.tool(m.id, a.id, d)} />)}
      {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} chat={chat} onGo={onGo} />)}
    </div>
  );
}

/** Where a compaction sits: "38 earlier messages summarized · Show", Undo on the newest one; shown, its summary too. */
function CompactRow({ m, open, newest, onToggle, chat }: { m: ChatMessage; open: boolean; newest: boolean; onToggle: () => void; chat: Assistant }) {
  const notify = useNotify();
  const n = m.compact!.count;
  return (
    <div className={cn('flex flex-col gap-1.5 text-xs text-muted-foreground', m.compactedBy && 'opacity-60')} data-role="summary">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <span>{m.compact!.auto ? `Tether summarized ${n} earlier messages to make room` : `${n} earlier messages summarized`}</span>
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-4" aria-expanded={open} onClick={onToggle}>
          {open ? 'Hide' : 'Show'}
        </button>
        {newest && !m.compactedBy ? (
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-4 disabled:opacity-50" disabled={chat.compacting || !!chat.streaming} onClick={() => void chat.compact(true).catch(notify.fail)}>
            Undo
          </button>
        ) : null}
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
      {open ? <p className="m-0 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-[13px]">{m.text}</p> : null}
    </div>
  );
}

/** The conversation: your messages, and Tether's with their scripts, sources, comparison and cards. Compacted messages fold under their summary. */
export function Thread({ chat, onGo, empty }: { chat: Assistant; onGo: (r: Route) => void; empty: ReactNode }) {
  const live = chat.streaming;
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setShown((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const newest = chat.messages.findLast((m) => m.compact && !m.compactedBy)?.id;
  return (
    <>
      {chat.loading ? <p className="m-0 text-muted-foreground">Loading the chat…</p> : null}
      {chat.error ? <p className="m-0 text-danger">{chat.error}</p> : null}
      {!chat.loading && !chat.messages.length && !live ? <p className="m-0 text-muted-foreground">{empty}</p> : null}
      {chat.messages.map((m, i) =>
        m.compactedBy && !shown.has(m.compactedBy) ? null : m.compact ? (
          <CompactRow key={m.id} m={m} open={shown.has(m.id)} newest={m.id === newest} onToggle={() => toggle(m.id)} chat={chat} />
        ) : m.role === 'you' ? (
          <div key={m.id} className={cn('max-w-[80%] self-end rounded-xl bg-muted px-3 py-2 whitespace-pre-wrap', m.compactedBy && 'opacity-60')} data-role="you">
            {m.text}
            {m.attachments?.length ? <div className="mt-1 text-xs text-muted-foreground">{m.attachments.map((a) => a.name).join(', ')}</div> : null}
          </div>
        ) : (
          <TetherMessage key={m.id} m={m} asked={chat.messages.slice(0, i).findLast((x) => x.role === 'you')?.at} chat={chat} onGo={onGo} dim={!!m.compactedBy} />
        ),
      )}
      {live ? (
        <div className="max-w-[92%]" data-role="tether">
          <Thinking tools={live.tools} startedAt={live.startedAt} />
          <StreamingResponse status="streaming" announce={false}>
            <Markdown text={visibleText(live.text)} />
          </StreamingResponse>
        </div>
      ) : null}
    </>
  );
}
