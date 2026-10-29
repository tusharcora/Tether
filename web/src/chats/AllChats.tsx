import { ArrowUp, ClipboardCheck, ExternalLink, MessageSquare, Play, Square } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { clock } from '../api';
import { chatsPath, type ChatSummary, type Cite, type OutcomeNode } from '../assistant/api';
import { Markdown } from '../assistant/Markdown';
import { routeOf, visibleText } from '../assistant/Thread';
import { useAssistant } from '../assistant/useAssistant';
import { ActionNode } from '../components/bencho/ActionNode';
import { Button } from '../components/beui/kit/Button';
import { SegmentedControl } from '../components/beui/kit/controls';
import { SearchField } from '../components/beui/kit/fields';
import { Loading } from '../components/Loading';
import { usePoll, type Route } from '../hooks';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { FaceStack } from '../ui/studio/FaceStack';
import { shortRunId } from '../ui/studio/RunGlyph';
import './chats.css';

/** The list refreshes this often while a chat is live or waits on the person, else more slowly. */
const LIVE_MS = 3000;
const IDLE_MS = 15_000;
const SEARCH_MS = 250;

const FILTERS = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'needs', label: 'Needs you', match: (c: ChatSummary) => c.kind === 'needs' },
  { value: 'live', label: 'Live', match: (c: ChatSummary) => c.kind === 'live' },
  { value: 'runs', label: 'Led to a run', match: (c: ChatSummary) => c.outcome.some((n) => n.kind === 'Run') },
  { value: 'answers', label: 'Answers only', match: (c: ChatSummary) => c.kind === 'answer' },
] as const;
const KIND_LABEL: Record<ChatSummary['kind'], string> = { live: 'Live', needs: 'Needs you', done: 'Done', failed: 'Failed', answer: 'Answer only' };
const MARK = { Asked: MessageSquare, Proposal: ClipboardCheck, Run: Play } as const;

/** "14:22" today, "Oct 27" before. */
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? clock(t) : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
/** A row's outcome chips: each run with its state, a proposal waiting, or "answer only". */
function chips(c: ChatSummary): { label: string; tone: OutcomeNode['tone'] }[] {
  const out = c.outcome.flatMap((n) => (n.kind === 'Run' ? [{ label: `run ${shortRunId(n.label)}`, tone: n.tone }] : n.kind === 'Proposal' && n.tone === 'needs' ? [{ label: 'proposal waiting', tone: n.tone }] : []));
  return out.length ? out : [{ label: 'answer only', tone: 'idle' }];
}
const citeLabel = (c: Cite) => (c.kind === 'file' ? `${c.path}${c.line ? `:${c.line}` : ''}` : c.kind === 'run' ? `run ${shortRunId(c.id)}` : c.path);

/**
 * All chats (mockup board 3, approved v2): the project's chats with search and filters on the left, each row with its live
 * state, last reply, what it led to and the crew on it; on the right the chosen chat: what it led to as a chain of action
 * nodes (a baton runs along the edge into a live run), an approval bar when a proposal waits, its sources, the last
 * exchange and a composer that continues the chat in place. Choosing a row only previews it: Open chat and Pop out open it.
 */
export function AllChats(p: { ws?: string; project?: { id: string; name: string }; active?: string; onOpen: (id: string) => void; onPopOut: (id: string) => void; onNew: () => void; onGo: (r: Route) => void; onTurnDone: (id: string) => void }) {
  const notify = useNotify();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), SEARCH_MS);
    return () => clearTimeout(t);
  }, [search]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const [busy, setBusy] = useState(false);
  const poll = usePoll<{ chats: ChatSummary[] }>(chatsPath(p.ws, q || undefined), busy ? LIVE_MS : IDLE_MS);
  const all = poll.data?.chats;
  useEffect(() => setBusy(!!all?.some((c) => c.kind === 'live' || c.kind === 'needs')), [all]);
  const shown = (all ?? []).filter(FILTERS.find((f) => f.value === filter)!.match);
  const [selId, setSelId] = useState(p.active);
  const sel = shown.find((c) => c.id === selId) ?? shown[0];

  const preview = useAssistant(p.ws, sel?.id, !!sel);
  const [reply, setReply] = useState('');
  const waiting = preview.messages.flatMap((m) => m.proposals ?? []).find((x) => x.status === 'proposed');
  const decide = (d: 'start' | 'dismiss') => waiting && void preview.decide(waiting, d).then(() => poll.refresh(), notify.fail);
  const lastYou = preview.messages.findLast((m) => m.role === 'you');
  const lastTether = preview.messages.findLast((m) => m.role === 'tether');
  const send = () => {
    const t = reply.trim();
    if (!t || preview.streaming) return;
    setReply('');
    const id = sel!.id;
    // once the turn ends the list catches up, and so does the mini chat when it shows this chat
    void preview.send(t, { context: { page: 'chats' } }).then(() => (void poll.refresh(), p.onTurnDone(id)));
  };

  return (
    <div className="ac">
      <section className="ac-list" aria-label="Chats">
        <div className="ac-top">
          <div className="ac-title">
            <h1>Chats</h1>
            {p.project ? <span className="ac-project">{p.project.name}</span> : null}
            <Button size="sm" onClick={p.onNew}>
              New chat
            </Button>
          </div>
          <SearchField label="Search chats" placeholder="Search chats, runs they started, files they cite…" value={search} onValueChange={setSearch} />
          <SegmentedControl
            label="Filter chats"
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
            options={FILTERS.map((f) => ({ value: f.value, label: f.label, accessory: <span className="ac-count">{(all ?? []).filter(f.match).length}</span> }))}
          />
        </div>
        <Loading loading={!all && !poll.error} lines={6} label="Loading chats" className="ac-rows-wrap">
          {/* keyed on the filter and the search, so the rows stagger in again when either changes */}
          <div key={`${filter}\0${q}`} className="ac-rows">
            {shown.map((c, k) => (
              <button key={c.id} type="button" className="ac-row" style={{ '--k': k } as CSSProperties} aria-label={`${c.title}, ${KIND_LABEL[c.kind]}`} aria-current={c.id === sel?.id || undefined} onClick={() => setSelId(c.id)}>
                <span className={cn('ac-mark', c.kind)} aria-hidden="true" />
                <span className="ac-row-main">
                  <span className="ac-row-top">
                    <b>{c.title}</b>
                    <time>{when(c.updated)}</time>
                  </span>
                  {c.last ? <span className="ac-row-last">{c.last}</span> : null}
                  <span className="ac-chips">
                    {chips(c).map((x, i) => (
                      <span key={i} className={cn('ac-chip', x.tone)}>
                        {x.label}
                      </span>
                    ))}
                    <span className="ac-gap" />
                    <FaceStack bots={c.faces} size={16} />
                  </span>
                </span>
              </button>
            ))}
            {all && !shown.length ? <p className="ac-empty">{all.length || filter !== 'all' ? 'No chat here.' : q ? 'No chat matches.' : 'No chats in this project yet.'}</p> : null}
            {poll.error && !all ? <p className="ac-empty">{poll.error}</p> : null}
          </div>
        </Loading>
      </section>

      <section className="ac-preview" aria-label="Chat preview">
        {sel ? (
          <>
            <div className="ac-head">
              <div>
                <h2>{sel.title}</h2>
                <span className="ac-meta">{[`${sel.count} messages`, preview.model ?? preview.agent, when(sel.updated)].filter(Boolean).join(' · ')}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => p.onPopOut(sel.id)}>
                Pop out <span aria-hidden="true">↘</span>
              </Button>
              <Button size="sm" onClick={() => p.onOpen(sel.id)}>
                Open chat
              </Button>
            </div>
            <div className="ac-led">
              <h3 className="ac-h3">What it led to</h3>
              <ol className="ac-flow" aria-label="What it led to">
                {sel.outcome.map((n, i) => {
                  const Mark = MARK[n.kind];
                  return (
                    <li key={i}>
                      {i ? <span className={cn('ac-link', n.tone === 'live' && 'live')} aria-hidden="true" /> : null}
                      <ActionNode
                        compact
                        tabbable={!!n.runId}
                        label={`${n.kind} actions`}
                        mark={<Mark aria-hidden="true" />}
                        title={n.kind === 'Run' ? shortRunId(n.label) : n.label}
                        line={`${n.kind} · ${n.state}`}
                        tone={n.tone}
                        toneLabel={n.state}
                        actions={n.runId ? [{ id: 'open', label: 'Open run', icon: <ExternalLink />, onSelect: () => p.onGo({ tab: 'runs', id: n.runId }) }] : []}
                      />
                    </li>
                  );
                })}
              </ol>
              {waiting ? (
                <div className="ac-wait" role="group" aria-label="Waiting on you">
                  <p>{`${waiting.kind === 'workflow' ? `Run the ${waiting.workflow} workflow` : 'Start a run'}: ${waiting.task.split('\n')[0]}?`}</p>
                  <Button variant="secondary" size="sm" onClick={() => decide('dismiss')}>
                    Dismiss
                  </Button>
                  <Button size="sm" onClick={() => decide('start')}>
                    Approve
                  </Button>
                </div>
              ) : null}
            </div>
            {sel.cites.length ? (
              <div className="ac-cites">
                {sel.cites.map((c) => (
                  <button key={`${c.kind}:${citeLabel(c)}`} type="button" className="ac-cite" onClick={() => p.onGo(routeOf(c))}>
                    {citeLabel(c)}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="ac-last">
              <h3 className="ac-h3">Last exchange</h3>
              {lastYou ? <div className="ac-you">{lastYou.text}</div> : null}
              {preview.streaming ? (
                <div className="ac-tether" aria-live="polite">
                  <Markdown text={visibleText(preview.streaming.text) || 'Thinking…'} />
                </div>
              ) : lastTether ? (
                <div className="ac-tether">{lastTether.error && !visibleText(lastTether.text) ? <p className="m-0 text-danger">{lastTether.error}</p> : <Markdown text={visibleText(lastTether.text)} />}</div>
              ) : null}
              <form className="ac-continue" onSubmit={(e) => (e.preventDefault(), send())}>
                <input aria-label="Continue this chat" placeholder="Continue this chat without opening it…" value={reply} onChange={(e) => setReply(e.target.value)} />
                {preview.streaming ? (
                  <Button type="button" size="icon" variant="secondary" aria-label="Stop" onClick={preview.stop}>
                    <Square size={12} aria-hidden="true" />
                  </Button>
                ) : (
                  <Button type="submit" size="icon" variant="secondary" aria-label="Send" disabled={!reply.trim()}>
                    <ArrowUp size={15} aria-hidden="true" />
                  </Button>
                )}
              </form>
            </div>
          </>
        ) : (
          <p className="ac-empty">{all?.length ? 'Pick a chat to see what it led to.' : 'Start a chat and it shows up here, with what it led to.'}</p>
        )}
      </section>
    </div>
  );
}
