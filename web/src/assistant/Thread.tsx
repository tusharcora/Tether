import { FileCode2, NotebookText, Play } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { splitArtifacts, wordCount } from '../../../src/assistant/artifactBlocks';
import { SWITCH_MODEL } from '../../../src/openrouter';
import { artifactMeta, KIND_LABEL } from '../artifacts/ArtifactViewer';
import { ArtifactCard } from '../components/assistant-ui/elements/artifact-card';
import type { Route } from '../hooks';
import { ComparisonTable } from '../components/aicss/ComparisonTable';
import { ComparisonCard } from '../components/assistant-ui/elements/comparison-card';
import { DocumentReference } from '../components/assistant-ui/elements/document-reference';
import { ErrorState } from '../components/assistant-ui/elements/error-state';
import { FeedbackDialog } from '../components/assistant-ui/elements/feedback-dialog';
import { MessageActions } from '../components/assistant-ui/elements/message-actions';
import { ResearchReport } from '../components/assistant-ui/elements/research-report';
import { RetrievalChunks } from '../components/assistant-ui/elements/retrieval-chunks';
import { SpecSheet } from '../components/assistant-ui/elements/spec-sheet';
import { StoppedRun } from '../components/assistant-ui/elements/stopped-run';
import { Timeline } from '../components/assistant-ui/elements/timeline';
import { Citations, type CitationItem } from '../components/beui/agents/citations';
import { StreamingResponse } from '../components/beui/agents/streaming-response';
import type { ArtifactRef, ChatMessage, Cite } from './api';
import type { Assistant } from './useAssistant';
import { Markdown } from './Markdown';
import { AskCardView, DiagramCard, ProposalCard, ToolAskCard } from './cards';
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

/** The reply's visible text: artifacts and the trailing ```tether block (sources, proposals, ...) are data, never shown, even half-written. */
export const visibleText = (text: string) => {
  const t = splitArtifacts(text).text;
  const i = t.indexOf('```tether');
  return (i >= 0 ? t.slice(0, i) : t).trimEnd();
};

/** An artifact's card: pressed (or Enter, Space), it opens in the artifact panel. */
function ArtifactRow({ a, project, onOpen }: { a: ArtifactRef; project?: string; onOpen?: (a: ArtifactRef) => void }) {
  const open = onOpen && (() => onOpen(a));
  return (
    <ArtifactCard
      className={cn('mt-2', open && 'cursor-pointer')}
      title={a.title}
      meta={artifactMeta(a, project)}
      {...(open ? { role: 'button', tabIndex: 0, 'aria-label': `Open ${a.title}, ${artifactMeta(a)}`, onClick: open, onKeyDown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) } : {})}
    />
  );
}

/** What a thumbs down can say was wrong (the person's options; a free note goes with them). */
const REASONS = ['Wrong', 'Missed the project', 'Too long', 'Did not answer'];

/** Copy, thumbs up or down (down asks what was wrong), regenerate, and More: turn the answer into a run. */
function ReplyActions({ m, text, chat }: { m: ChatMessage; text: string; chat: Assistant }) {
  const notify = useNotify();
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [selected, setSelected] = useState<string[]>(m.feedbackNote?.reasons ?? []);
  const [note, setNote] = useState(m.feedbackNote?.note ?? '');
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <>
      <MessageActions
        className="mt-1"
        copied={copied}
        reaction={m.feedback ?? null}
        regenerating={false}
        onCopy={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), notify.fail)}
        onReactionChange={(r) => (chat.feedback(m.id, r), setAsking(r === 'down'))}
        onRegenerate={() => void chat.regenerate(m.id)}
        onMore={() => void chat.turnIntoRun(m.id).catch(notify.fail)}
      />
      {asking ? (
        // sent: the dialog closes (its own "sent" line speaks of tuning a model, which Tether does not do)
        <FeedbackDialog
          className="mt-2"
          reasons={REASONS}
          selected={selected}
          note={note}
          sent={false}
          onToggleReason={(r) => setSelected((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]))}
          onNoteChange={setNote}
          onSubmit={() => (chat.feedback(m.id, 'down', { reasons: selected, note: note.trim() || undefined }), setAsking(false))}
        />
      ) : null}
    </>
  );
}

/** The vault notes the prompt carried; pressing one shows its passage, with Open in Graph. */
function RetrievedNotes({ m, query, onGo }: { m: ChatMessage; query: string; onGo: (r: Route) => void }) {
  const [open, setOpen] = useState<string>();
  const hits = m.retrieved!;
  // the vault's scores are keyword counts: shown relative to the best note
  const top = Math.max(...hits.map((h) => h.score));
  const doc = hits.find((h) => h.path === open);
  const go = () => doc && onGo(routeOf({ n: 0, label: doc.title, kind: 'note', path: doc.path }));
  return (
    <div className="mt-2 flex flex-col gap-2">
      <RetrievalChunks
        query={query}
        chunks={hits.map((h) => ({ id: h.path, source: h.title, locator: h.path, score: top > 0 ? h.score / top : 0, text: h.snippet }))}
        visibleCount={hits.length}
        searching={false}
        onOpen={(id) => setOpen((o) => (o === id ? undefined : id))}
      />
      {doc ? (
        <div className="flex flex-col items-start gap-1.5">
          {/* a note has no pages: it is one, and the passage is the snippet the prompt carried */}
          <DocumentReference title={doc.title} pages={1} anchors={[{ page: 1, quote: doc.snippet }]} activePage={1} onJump={go} />
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-4" onClick={go}>
            Open in Graph
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** `asked`: when the question was sent, so the finished timeline says how long Tether thought; `query`: its text. */
function TetherMessage({ m, asked, query, chat, onGo, dim, project, onArtifact }: { m: ChatMessage; asked?: number; query?: string; chat: Assistant; onGo: (r: Route) => void; dim?: boolean; project?: string; onArtifact?: (a: ArtifactRef) => void }) {
  const notify = useNotify();
  const text = visibleText(m.text);
  const stopped = m.error === 'Stopped.';
  return (
    <div className={cn('max-w-[92%]', dim && 'opacity-60')} data-role="tether">
      {m.tools?.length ? <Thinking tools={m.tools} ms={asked !== undefined ? m.at - asked : undefined} /> : null}
      {stopped ? (
        <StoppedRun words={text.split(/\s+/).filter(Boolean)} reason="stopped" onContinue={() => void chat.send('Continue')} onDiscard={() => void chat.discard(m.id).catch(notify.fail)} />
      ) : text || m.error?.endsWith(SWITCH_MODEL) ? (
        <StreamingResponse status={m.error ? 'error' : 'complete'} announce={false} showActions={false}>
          <Markdown text={text} cites={new Set((m.cites ?? []).map((c) => c.n))} idPrefix={`src-${m.id}`} onCite={(n) => { const c = m.cites?.find((x) => x.n === n); if (c) onGo(routeOf(c)); }} />
          {m.error?.endsWith(SWITCH_MODEL) ? (
            // out of free requests: the model the assistant runs on is the Tether bot's, in its Runs on
            <p className="m-0 mt-2 text-danger">
              {m.error.slice(0, -SWITCH_MODEL.length)} ·{' '}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-danger underline" onClick={() => onGo({ tab: 'crew', id: 'orchestrator' })}>
                Switch model
              </button>
            </p>
          ) : null}
        </StreamingResponse>
      ) : null}
      {m.artifacts?.map((a) => <ArtifactRow key={`${a.id}-${a.version}`} a={a} project={project} onOpen={onArtifact} />)}
      {/* outside the response: its prose rules would space the element's lines */}
      {m.error && !stopped && !m.error.endsWith(SWITCH_MODEL) ? <ErrorState className="mt-2" title="Tether could not answer" detail={m.error} retrying={false} onRetry={() => void chat.regenerate(m.id)} /> : null}
      {m.cites?.length ? <Citations className="mt-1" citations={citationItems(m.cites, onGo)} idPrefix={`src-${m.id}`} /> : null}
      {m.compare ? (
        <div className="mt-2">
          <ComparisonTable title={m.compare.title} columns={m.compare.columns} rows={m.compare.rows} />
        </div>
      ) : null}
      {m.choice ? <ComparisonCard className="mt-2" traitLabels={m.choice.traits} options={m.choice.options.map((o) => ({ id: o.name, ...o }))} recommendedId={m.choice.pick} reason={m.choice.reason} /> : null}
      {m.spec ? <SpecSheet className="mt-2" title={m.spec.title} subtitle={m.spec.subtitle} rows={m.spec.rows} visibleCount={m.spec.rows.length} /> : null}
      {m.report ? <ResearchReport className="mt-2" title={m.report.title} sections={m.report.sections.map((s, i) => ({ id: `s${i}`, heading: s.heading, state: 'done', sources: s.sources, preview: s.summary }))} sourcesRead={m.cites?.length ?? 0} /> : null}
      {m.timeline ? <Timeline className="mt-2" events={m.timeline.map((e, i) => ({ id: `e${i}`, ...e }))} visibleCount={m.timeline.length} /> : null}
      {m.diagram ? <DiagramCard diagram={m.diagram} /> : null}
      {m.retrieved?.length ? <RetrievedNotes m={m} query={query ?? ''} onGo={onGo} /> : null}
      {m.ask ? <AskCardView message={m} chat={chat} /> : null}
      {m.toolAsks?.map((a) => <ToolAskCard key={a.id} ask={a} onDecide={(d) => chat.tool(m.id, a.id, d)} />)}
      {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} chat={chat} onGo={onGo} />)}
      {(text || m.artifacts?.length) && !m.error ? <ReplyActions m={m} text={text} chat={chat} /> : null}
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

const asked = (q?: ChatMessage) => ({ asked: q?.at, query: q?.text });

/** The conversation: your messages, and Tether's with their scripts, sources, comparison and cards. Compacted messages fold under their summary. */
export function Thread({ chat, onGo, empty, project, onArtifact }: { chat: Assistant; onGo: (r: Route) => void; empty: ReactNode; project?: string; onArtifact?: (a: ArtifactRef) => void }) {
  const live = chat.streaming;
  // what the reply is writing: an open artifact is still generating; a closed one is saved when the reply ends
  const writing = live ? splitArtifacts(live.text).artifacts : [];
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setShown((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const newest = chat.messages.findLast((m) => m.compact && !m.compactedBy)?.id;
  return (
    <>
      {chat.loading ? <p className="m-0 text-muted-foreground">Loading the chat…</p> : null}
      {chat.error ? <ErrorState title="Something went wrong" detail={chat.error} retrying={chat.loading} onRetry={chat.retry} /> : null}
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
          <TetherMessage key={m.id} m={m} {...asked(chat.messages.slice(0, i).findLast((x) => x.role === 'you'))} chat={chat} onGo={onGo} dim={!!m.compactedBy} project={project} onArtifact={onArtifact} />
        ),
      )}
      {live ? (
        <div className="max-w-[92%]" data-role="tether">
          <Thinking tools={live.tools} startedAt={live.startedAt} />
          <StreamingResponse status="streaming" announce={false}>
            <Markdown text={visibleText(live.text)} />
          </StreamingResponse>
          {writing.map((a, k) => (
            <ArtifactCard key={k} className="mt-2" title={a.title} meta={`${KIND_LABEL[a.kind]} · ${wordCount(a.content)} words`} generating={!!a.open} words={wordCount(a.content)} />
          ))}
        </div>
      ) : null}
    </>
  );
}
