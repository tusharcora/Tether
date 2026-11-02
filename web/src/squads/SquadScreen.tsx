import { ArrowUp, CornerUpLeft, ExternalLink, Pin, Plus, Settings, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { fmtDur, fmtUsd } from '../api';
import { TeamRunCard } from '../assistant/taskCards';
import { useCaps } from '../caps';
import { LinkPreview } from '../components/assistant-ui/elements/link-preview';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { Loading } from '../components/Loading';
import { Face, TETHER_ID } from '../Face';
import type { GoalView } from '../goals/goalsApi';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Route } from '../hooks';
import { TeamForm } from '../teams/NewTeam';
import { PairPanel, TeamPeople } from '../teams/TeamPeople';
import { approversLine, availability, MARK, REACTIONS, teamsApi, type Card, type TeamMessage, type TeamsReply, type TeamView, type Work } from '../teams/teamsApi';
import { Bars } from '../tickets/Tickets';
import { shippedPerDay, squadCounts } from '../tickets/ticketModel';
import type { Schedule } from '../triggers/Schedules';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { RunDiff } from '../ui/RunDiff';
import { InlineError } from '../ui/studio/InlineError';
import { shortRunId } from '../ui/studio/RunGlyph';
import { useNow } from '../home/Elapsed';
import { channel, mapToday, markSeen, pinned, rightNow, threadOf, threadSummary, typing, type Focus, type Member } from './squadModel';
import '../teams/teams.css';
import './squads.css';

const VIEW_MS = 1500;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Message text with its @mentions of the squad highlighted. */
function withMentions(text: string, names: string[]): ReactNode[] {
  if (!names.length) return [text];
  const re = new RegExp(`(@(?:${names.map(esc).join('|')}))(?![\\w-])`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <span key={i} className="tm-mention">{part}</span> : part));
}
const Avatar = ({ m, size = 34 }: { m: Pick<TeamMessage, 'from'>; size?: number }) =>
  m.from.kind === 'person' ? (
    <span className="sq-person" style={{ width: size, height: size }} aria-hidden="true">
      {m.from.name === 'you' ? 'Y' : m.from.name.slice(0, 2).toUpperCase()}
    </span>
  ) : (
    <Face id={m.from.kind === 'tether' ? TETHER_ID : m.from.id} size={size} label="" />
  );
const who = (n: string) => (n === 'you' ? 'You' : n);

/**
 * A squad (spec 2026-10-30-squads-tickets §2.2-2.4, board 8): the header with Chat | Map, the Right now strip (a card per
 * busy agent, a You card, the free agents; a card filters the channel), the channel (messages in a teammate's voice with
 * What I did, hand-off chips, reactions, threads, hover actions; the ship card; the typing line), the composer with
 * suggestions and an @ picker that says who is free, and on the right the thread panel or the squad pulse.
 */
export function SquadScreen(p: { id: string; tickets?: GoalView[]; agents: TeamsReply['agents']; projects: WorkspaceRow[]; onGo: (r: Route) => void; onChanged: () => void; onNewAgent: () => void }) {
  const notify = useNotify();
  const caps = useCaps();
  const view = usePoll<TeamView>(`/api/squads/${encodeURIComponent(p.id)}`, VIEW_MS);
  const schedules = usePoll<Schedule[]>('/api/schedules', 60_000);
  const [mode, setMode] = useState<'chat' | 'map'>('chat');
  const [focus, setFocus] = useState<Focus>('all');
  const [thread, setThread] = useState<string>();
  const [settings, setSettings] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [diff, setDiff] = useState<{ title: string; text?: string }>();
  const [report, setReport] = useState<TeamMessage>();
  const [draft, setDraft] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const end = useRef<HTMLLIElement>(null);
  const now = useNow(true, 1000);
  const v = view.data;
  const count = v?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
    markSeen(p.id);
  }, [count, p.id]);

  if (!v) return <Loading loading={!view.error} lines={6} label="Loading the squad">{view.error ? <InlineError message={view.error} onRetry={() => void view.refresh()} /> : null}</Loading>;
  const t = v.team;
  const telegram = t.place === 'telegram';
  const names = [...v.members.map((m) => m.name), ...t.people.map((x) => x.name)];
  const refresh = () => (void view.refresh(), p.onChanged());
  const fail = (e: unknown) => (notify.fail(e), refresh());
  const act = (msg: TeamMessage, body: { action: string; reason?: string; task?: string }) => teamsApi.decide(t.id, msg.id, body).then(refresh, fail);
  const showDiff = (msg: TeamMessage, title: string) => {
    setDiff({ title });
    teamsApi.diff(t.id, msg.id).then((d) => setDiff({ title, text: d.diff }), (e: unknown) => (setDiff(undefined), notify.fail(e)));
  };
  const now0 = rightNow(v);
  const working = now0.busy.length;
  const needs = now0.you?.count ?? 0;
  const shown = channel(v.messages, focus, v.members);
  const pick = (f: Focus) => setFocus((cur) => (cur === f ? 'all' : f));
  const focusName = focus === 'you' ? 'you' : v.members.find((m) => m.id === focus)?.name;
  const ticketOf = (id?: string) => (id ? p.tickets?.find((x) => x.id === id) : undefined);
  const typingNow = typing(v.messages);
  const threadRoot = thread ? v.messages.find((m) => m.id === thread) : undefined;
  const send = (text: string, inThread?: string) => teamsApi.post(t.id, text, inThread).then(refresh);
  const row = (m: TeamMessage, compact = false) => (
    <MessageRow
      key={m.id}
      m={m}
      names={names}
      compact={compact}
      summary={compact ? undefined : threadSummary(v.messages, m.id)}
      card={m.card ? <CardView msg={m} card={m.card} team={v} ticket={ticketOf(m.ticket)} onAct={act} onDiff={showDiff} onGo={p.onGo} onUndo={() => teamsApi.undo(t.id, m.id).then(refresh, fail)} /> : null}
      onReact={(r) => void teamsApi.react(t.id, m.id, r).then(refresh, fail)}
      onPin={() => void teamsApi.pin(t.id, m.id, !m.pinned).then(refresh, fail)}
      onThread={compact ? undefined : () => setThread(m.id)}
      onRun={m.run ? () => p.onGo({ tab: 'runs', id: m.run! }) : undefined}
      onReport={() => setReport(m)}
      onDiff={() => showDiff(m, 'Diff')}
    />
  );

  return (
    <div className="sq">
      <header className="sq-head">
        <div className="sq-title">
          <h1>
            <span aria-hidden="true">{MARK[t.place]}</span> {t.name}
          </h1>
          <span className="tm-sub">
            {`${p.projects.find((w) => w.id === t.project)?.name ?? t.project} · ${working} working`}
            {needs ? (
              <>
                {' · '}
                <span className="sq-amber">{`${needs} need${needs === 1 ? 's' : ''} you`}</span>
              </>
            ) : null}
            {` · ${caps ? `${fmtUsd(v.spend.usd)} of ${fmtUsd(t.limits.usdPerDay)} today` : `${fmtUsd(v.spend.usd)} today`}`}
          </span>
        </div>
        <span className="tm-gap" />
        <div className="sq-tabs" role="tablist" aria-label="View">
          {(['chat', 'map'] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={mode === x} onClick={() => setMode(x)}>
              {x === 'chat' ? 'Chat' : 'Map'}
            </button>
          ))}
        </div>
        {telegram ? (
          <Button variant="secondary" size="sm" onClick={() => setPeopleOpen(true)}>
            People and permissions
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setSettings(true)}>
            Add agent
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Squad settings" onClick={() => setSettings(true)}>
          <Settings size={15} aria-hidden="true" />
        </Button>
      </header>

      <section className="sq-now" aria-label="Right now">
        {now0.busy.map((m) => (
          <button key={m.id} type="button" className="sq-card" aria-pressed={focus === m.id} onClick={() => pick(m.id)}>
            <span className="sq-row">
              <span className="sq-bob">
                <Face id={m.id} size={30} label="" animate="always" />
              </span>
              <span className="sq-col">
                <b>{m.name}</b>
                <span className="sq-live">{m.line ?? m.state}</span>
              </span>
              {m.since ? <span className="sq-clock">{clock(now - m.since)}</span> : null}
            </span>
            <span className="sq-bar">
              <i className={cn({ shimmer: m.state !== 'waiting' })} style={{ width: `${Math.round((m.progress ?? (m.state === 'waiting' ? 1 : 0.3)) * 100)}%` }} />
            </span>
            <span className="sq-mut">{[m.title, m.ticket && ticketOf(m.ticket)?.key].filter(Boolean).join(' · ') || m.state}</span>
          </button>
        ))}
        {now0.you ? (
          <button type="button" className="sq-card you" aria-pressed={focus === 'you'} onClick={() => pick('you')}>
            <span className="sq-row">
              <span className="sq-person" style={{ width: 30, height: 30 }} aria-hidden="true">
                Y
              </span>
              <span className="sq-col">
                <b>You</b>
                <span className="sq-amber">{`${now0.you.count} thing${now0.you.count === 1 ? '' : 's'} to decide`}</span>
              </span>
            </span>
            <span className="sq-bar">
              <i className="amber" style={{ width: '100%' }} />
            </span>
            <span className="sq-mut">{now0.you.first}</span>
          </button>
        ) : null}
        <button type="button" className="sq-card free" aria-pressed={focus === 'all'} onClick={() => setFocus('all')}>
          {now0.free.length ? (
            <>
              <span className="sq-faces">
                {now0.free.slice(0, 4).map((m) => (
                  <Face key={m.id} id={m.id} size={26} label="" />
                ))}
              </span>
              <span>
                <b>{now0.free.map((m) => m.name).join(', ')}</b> <span className="sq-mut">free</span>
              </span>
            </>
          ) : (
            <b>Everyone is busy</b>
          )}
          <span className="sq-live">{focus === 'all' ? 'Showing everyone' : 'Show everyone'}</span>
        </button>
      </section>

      {mode === 'chat' ? (
        <div className="sq-body">
          <section className="sq-chat" aria-label="Squad chat">
            {telegram && !t.link ? <PairPanel id={t.id} onGo={p.onGo} /> : null}
            {focus !== 'all' ? (
              <div className="sq-filter" role="status">
                {`Showing ${focusName} only`}
                <Button variant="ghost" size="sm" onClick={() => setFocus('all')}>
                  Show everyone
                </Button>
              </div>
            ) : null}
            <ol className="sq-msgs" aria-label="Messages" aria-live="polite">
              <li className="sq-day" aria-hidden="true">
                <span />
                Today
                <span />
              </li>
              {shown.length ? null : <li className="tm-empty">{focus !== 'all' ? `Nothing from or to ${focusName} yet.` : 'Say hello, or @mention an agent to hand it a question, a task or recurring work.'}</li>}
              {shown.filter((m) => !(m.pending && m.from.kind === 'agent')).map((m) => row(m))}
              {typingNow ? (
                <li className="sq-typing" aria-label={`${typingNow.name} ${typingNow.line}`}>
                  <span className="sq-bob">
                    <Face id={typingNow.id} size={34} label="" animate="always" />
                  </span>
                  <span>
                    <b>{typingNow.name}</b> {typingNow.line}
                  </span>
                  <span className="sq-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </li>
              ) : null}
              <li ref={end} aria-hidden="true" />
            </ol>
            {telegram ? (
              <p className="tm-readonly">This squad lives in Telegram: talk to it in the group. This room mirrors what Tether posted there and what it heard.</p>
            ) : (
              <Composer key={draft.n} name={t.name} members={v.members} start={draft.text} onSend={(text) => send(text)} chips={suggestions(v.members)} onChip={(text) => setDraft((d) => ({ text, n: d.n + 1 }))} />
            )}
          </section>
          {threadRoot ? (
            <aside className="sq-side" aria-label="Thread">
              <div className="sq-side-head">
                <b>Thread</b>
                <span className="sq-mut">{`${who(threadRoot.from.name)} · ${threadRoot.text.split(/(?<=[.!?])\s/)[0]!.slice(0, 40)}`}</span>
                <Button variant="ghost" size="icon" aria-label="Close thread" onClick={() => setThread(undefined)}>
                  <X size={15} aria-hidden="true" />
                </Button>
              </div>
              <ol className="sq-thread" aria-label="Replies">
                {row(threadRoot, true)}
                {threadOf(v.messages, threadRoot.id).map((m) => row(m, true))}
                {typing(v.messages, threadRoot.id) ? <li className="sq-mut">{`${typing(v.messages, threadRoot.id)!.name} ${typing(v.messages, threadRoot.id)!.line}…`}</li> : null}
              </ol>
              {telegram ? null : <ThreadReply onSend={(text) => send(text, threadRoot.id)} />}
            </aside>
          ) : (
            <Pulse v={v} tickets={p.tickets} schedules={schedules.data ?? []} now={now} onGo={p.onGo} onMessage={(id) => setThread(id)} />
          )}
        </div>
      ) : (
        <SquadMap v={v} now={now} />
      )}

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent title={`${t.name} settings`} className="tm-dialog">
          {settings ? <TeamForm team={t} agents={p.agents} projects={p.projects} onSaved={() => (setSettings(false), refresh())} onCancel={() => setSettings(false)} onNewAgent={p.onNewAgent} onDeleted={() => (setSettings(false), p.onChanged(), p.onGo({ tab: 'home' }))} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DialogContent title={`People and permissions · ${t.name}`} className="tm-dialog">
          {peopleOpen ? <TeamPeople team={t} members={v.members} onChanged={refresh} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(undefined)}>
        <DialogContent title={diff?.title ?? 'Diff'} className="tm-dialog">
          {diff?.text === undefined ? <Loading loading lines={6} label="Loading the diff" /> : diff.text ? <RunDiff text={diff.text} /> : <p className="tm-muted">No changes.</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(undefined)}>
        <DialogContent title={`${report?.from.name ?? ''}'s full report`} className="tm-dialog">
          <pre className="sq-report">{report?.report ?? report?.text}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The composer's suggestions (board 8): ask the first agent, have the reviewer look at a PR, ask what everyone is doing. */
function suggestions(members: Member[]): { label: string; text: string }[] {
  const first = members[0];
  const reviewer = members.find((m) => /review/i.test(m.specialty)) ?? members[1];
  return [...(first ? [{ label: `Ask ${first.name} to…`, text: `@${first.name} ` }] : []), ...(reviewer ? [{ label: `Have ${reviewer.name} review a PR`, text: `@${reviewer.name} review PR #` }] : []), { label: "What's everyone doing?", text: "What's everyone working on?" }];
}

/** One message (board 8): the speaker, the text in a teammate's voice, What I did, the card, the hand-off chip, reactions, the thread link, and the hover actions (also reachable by keyboard). */
function MessageRow(p: { m: TeamMessage; names: string[]; compact?: boolean; summary?: ReturnType<typeof threadSummary>; card: ReactNode; onReact: (r: string) => void; onPin: () => void; onThread?: () => void; onRun?: () => void; onReport: () => void; onDiff: () => void }) {
  const { m } = p;
  const [reacting, setReacting] = useState(false);
  return (
    <li className={cn('sq-msg', { compact: !!p.compact })}>
      <Avatar m={m} size={p.compact ? 26 : 34} />
      <div className="sq-main">
        <div className="sq-who">
          <b>{who(m.from.name)}</b>
          <span>{time(m.at)}</span>
          {m.pinned ? <span className="sq-pinned">pinned</span> : null}
        </div>
        <p className="sq-text">{withMentions(m.text, p.names)}</p>
        {m.work ? <WhatIDid work={m.work} hasReport={!!m.report} onReport={p.onReport} onDiff={p.onDiff} onRun={p.onRun} /> : null}
        {p.card}
        {m.handoff ? (
          <span className="sq-handoff">
            <Face id={m.handoff.to} size={20} label="" />
            Handed to <b>{m.handoff.name}</b>
            {m.handoff.review ? ' for a review' : ''}
          </span>
        ) : null}
        {m.reactions ? (
          <span className="sq-reactions">
            {Object.entries(m.reactions).map(([r, people]) => (
              <button key={r} type="button" className="sq-react" aria-pressed={people.includes('you')} aria-label={`${r}: ${people.join(', ')}`} onClick={() => p.onReact(r)}>
                {`${r} · ${people.length}`}
              </button>
            ))}
          </span>
        ) : null}
        {p.summary && p.onThread ? (
          <button type="button" className="sq-thread-link" onClick={p.onThread}>
            <span className="sq-faces">
              {p.summary.who.slice(0, 3).map((id) => (
                <Face key={id} id={id} size={16} label="" />
              ))}
            </span>
            {`${p.summary.n} repl${p.summary.n === 1 ? 'y' : 'ies'} · ${p.summary.line}`}
          </button>
        ) : null}
      </div>
      <div className="sq-hover" role="toolbar" aria-label="Message actions">
        <button type="button" aria-label="React" aria-expanded={reacting} onClick={() => setReacting((x) => !x)}>
          <Plus size={14} aria-hidden="true" />
        </button>
        {p.onThread ? (
          <button type="button" aria-label="Reply in thread" onClick={p.onThread}>
            <CornerUpLeft size={14} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" aria-label={m.pinned ? 'Unpin' : 'Pin to the pulse'} aria-pressed={!!m.pinned} onClick={p.onPin}>
          <Pin size={14} aria-hidden="true" />
        </button>
        {p.onRun ? (
          <button type="button" aria-label="Open the run" onClick={p.onRun}>
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        ) : null}
        {reacting ? (
          <span className="sq-pick" role="group" aria-label="Reactions">
            {REACTIONS.map((r) => (
              <button key={r} type="button" onClick={() => (setReacting(false), p.onReact(r))}>
                {r}
              </button>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** What I did (board 9): the files, size, the commands and their results, how long and on what; then Full report, Diff and Open the run. */
export function WhatIDid({ work: w, hasReport, onReport, onDiff, onRun }: { work: Work; hasReport: boolean; onReport: () => void; onDiff: () => void; onRun?: () => void }) {
  const [open, setOpen] = useState(false);
  const failed = w.ran.some((r) => !r.ok);
  return (
    <div className="sq-work">
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span className={cn('sq-dot', failed ? 'bad' : 'ok')} aria-hidden="true" />
        What I did
        <span className="sq-mono">
          {`${w.files.length} file${w.files.length === 1 ? '' : 's'} · `}
          <span className="ok">{`+${w.plus}`}</span> <span className="bad">{`−${w.minus}`}</span>
          {w.ms ? ` · ${fmtDur(w.ms)}` : ''}
          {w.model ? ` · ${w.model}` : ''}
        </span>
        <span className="sq-mut sq-end">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="sq-work-body">
          {w.files.length ? (
            <div className="sq-did">
              <span>Edited</span>
              <span className="sq-mono">{w.files.join(' · ')}</span>
            </div>
          ) : null}
          {w.ran.map((r) => (
            <div key={r.command} className="sq-did">
              <span>Ran</span>
              <span className="sq-mono">{r.command}</span>
              <span className={cn('sq-end', r.ok ? 'ok' : 'bad')}>{r.summary ?? (r.ok ? 'passed' : 'failed')}</span>
            </div>
          ))}
          <div className="sq-links">
            {hasReport ? (
              <button type="button" className="tm-link" onClick={onReport}>
                Full report
              </button>
            ) : null}
            <button type="button" className="tm-link" onClick={onDiff}>
              Diff
            </button>
            {onRun ? (
              <button type="button" className="tm-link" onClick={onRun}>
                Open the run
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Act = (m: TeamMessage, body: { action: string; reason?: string; task?: string }) => Promise<void>;

function CardView(p: { msg: TeamMessage; card: Card; team: TeamView; ticket?: GoalView; onAct: Act; onDiff: (m: TeamMessage, title: string) => void; onGo: (r: Route) => void; onUndo: () => Promise<void> }) {
  const c = p.card;
  if (c.kind === 'run') return <TeamRunCard card={c} onOpen={() => p.onGo({ tab: 'runs', id: c.runId })} />;
  if (c.kind === 'loop') return <LoopCard ticket={p.ticket} onGo={p.onGo} />;
  if (c.kind === 'approval' && c.what === 'ship') return <ShipCard msg={p.msg} card={c} ticket={p.ticket} team={p.team} onAct={p.onAct} onDiff={p.onDiff} onUndo={p.onUndo} />;
  if (c.kind === 'approval') return <AskCard msg={p.msg} card={c} team={p.team} onAct={p.onAct} />;
  if (c.kind === 'proposal') return <ProposalCard msg={p.msg} card={c} onAct={p.onAct} onGo={p.onGo} />;
  return <LinkPreview layout="compact" href={c.url} title={`PR #${c.number} · ${c.title}`} description={c.merged ? 'merged' : 'open'} />;
}

/**
 * The ship card (board 8): the change's size as a +/− bar, chips for the tests, the review and the ticket's criteria;
 * Ship it / See the diff / Not yet (a reason, then the agent reworks once). After Ship it: who shipped it and the PR
 * opening, open, merged; Undo until it merges.
 */
export function ShipCard({ msg, card: c, ticket, team, onAct, onDiff, onUndo }: { msg: TeamMessage; card: Extract<Card, { kind: 'approval' }>; ticket?: GoalView; team: TeamView; onAct: Act; onDiff: (m: TeamMessage, title: string) => void; onUndo: () => Promise<void> }) {
  const [why, setWhy] = useState<string>();
  const [busy, setBusy] = useState(false);
  const id = useId();
  const go = (body: { action: string; reason?: string }) => {
    setBusy(true);
    void onAct(msg, body).finally(() => (setBusy(false), setWhy(undefined)));
  };
  const plus = c.plus ?? 0;
  const minus = c.minus ?? 0;
  const total = Math.max(1, plus + minus);
  const met = ticket?.criteria.filter((x) => x.done).length ?? 0;
  if (c.status === 'superseded') return <div className="sq-ship done-quiet">{`${c.title} · replaced by a newer run`}</div>;
  if (c.status === 'rejected') return <div className="sq-ship sent">{`Sent back by ${who(c.by ?? 'someone')}${c.reason ? ` · ${c.reason}` : ''}`}</div>;
  if (c.status === 'approved') {
    const sh = c.ship;
    const pr = sh?.pr ? `PR #${sh.pr.number}` : 'the PR';
    const state = !sh ? 'approved' : sh.state === 'merged' ? `${pr} merged` : sh.state === 'open' ? `${pr} open, merging once checks pass` : sh.state === 'failed' ? `not shipped: ${sh.error ?? 'it failed'}` : 'opening the PR';
    const undo = sh && (sh.state === 'shipping' || sh.state === 'open');
    return (
      <div className={cn('sq-shipped', { bad: sh?.state === 'failed' })} role="status">
        {`Shipped by ${who(c.by ?? 'someone')} · ${state}${c.at ? ` · ${time(c.at)}` : ''}`}
        {undo ? (
          <Button variant="ghost" size="sm" loading={busy} onClick={() => (setBusy(true), void onUndo().finally(() => setBusy(false)))}>
            Undo
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="sq-ship" role="group" aria-labelledby={id}>
      <div className="sq-row">
        <b id={id}>{c.title}</b>
        {c.files !== undefined ? <span className="sq-mono sq-end">{`${c.files} file${c.files === 1 ? '' : 's'}`}</span> : null}
      </div>
      {c.plus !== undefined ? (
        <div className="sq-pm" role="img" aria-label={`${plus} lines added, ${minus} removed`}>
          <span style={{ width: `${(plus / total) * 100}%` }} />
          <span style={{ width: `${(minus / total) * 100}%` }} />
        </div>
      ) : null}
      <div className="sq-chips">
        {c.tests ? <span className={cn('sq-chip', c.tests.ok ? 'ok' : 'bad')}>{c.tests.line}</span> : null}
        {c.review ? <span className={cn('sq-chip', c.review.pass === undefined ? '' : c.review.pass ? 'ok' : 'warn')}>{c.review.pass === undefined ? `${c.review.by} reviewing` : c.review.pass ? `${c.review.by} approved` : `${c.review.by} asked for changes`}</span> : null}
        {ticket?.criteria.length ? <span className={cn('sq-chip', met === ticket.criteria.length ? 'ok' : '')}>{`${met}/${ticket.criteria.length} criteria`}</span> : null}
        {c.plus !== undefined ? <span className="sq-chip">{`+${plus} −${minus}`}</span> : null}
      </div>
      {why !== undefined ? (
        <form className="tm-reject" onSubmit={(e) => (e.preventDefault(), go({ action: 'reject', reason: why.trim() || undefined }))}>
          <label htmlFor={`${id}-why`}>What should change? (optional: the agent reworks it once with this)</label>
          <textarea id={`${id}-why`} rows={2} maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
          <span className="tm-row">
            <Button type="button" variant="ghost" size="sm" onClick={() => setWhy(undefined)}>
              Cancel
            </Button>
            <Button type="submit" variant="secondary" size="sm" loading={busy}>
              Send back
            </Button>
          </span>
        </form>
      ) : (
        <div className="sq-row">
          <Button size="sm" loading={busy} onClick={() => go({ action: 'approve' })}>
            Ship it
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onDiff(msg, c.title)}>
            See the diff
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setWhy('')}>
            Not yet
          </Button>
          <span className="sq-mut sq-end">{team.team.approvers === 'any' ? '' : `Only ${approversLine(team.team)} can ship`}</span>
        </div>
      )}
    </div>
  );
}

/** Plan and next-run approvals. */
function AskCard({ msg, card: c, team, onAct }: { msg: TeamMessage; card: Extract<Card, { kind: 'approval' }>; team: TeamView; onAct: Act }) {
  const [busy, setBusy] = useState(false);
  const id = useId();
  const go = (action: string) => {
    setBusy(true);
    void onAct(msg, { action }).finally(() => setBusy(false));
  };
  const next = c.what === 'next';
  return (
    <div className={cn('tm-card ask', { pending: c.status === 'pending' })} role="group" aria-labelledby={id}>
      <b id={id}>{c.title}</b>
      {c.detail ? <span className="tm-detail">{c.detail}</span> : null}
      {c.status !== 'pending' ? (
        <span className={cn('tm-decided', c.status)}>{`${c.status === 'approved' ? '✓ Approved' : c.status === 'superseded' ? 'Replaced' : '✕ Rejected'} by ${who(c.by ?? 'someone')}${c.at ? ` · ${time(c.at)}` : ''}`}</span>
      ) : (
        <span className="tm-row">
          <span className="tm-muted tm-grow">{team.team.approvers === 'any' ? 'Anyone here can approve' : `Only ${approversLine(team.team)} can approve`}</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => go('reject')}>
            {next ? 'Skip' : 'Reject'}
          </Button>
          <Button size="sm" loading={busy} onClick={() => go('approve')}>
            {next ? 'Start run' : 'Approve'}
          </Button>
        </span>
      )}
    </div>
  );
}

/** A run an agent suggests: Start run, Edit (the task) or Dismiss. */
function ProposalCard({ msg, card: c, onAct, onGo }: { msg: TeamMessage; card: Extract<Card, { kind: 'proposal' }>; onAct: Act; onGo: (r: Route) => void }) {
  const [edit, setEdit] = useState<string>();
  const [busy, setBusy] = useState(false);
  const go = (body: { action: string; task?: string }) => {
    setBusy(true);
    void onAct(msg, body).finally(() => setBusy(false));
  };
  return (
    <div className="tm-card" role="group" aria-label="Proposed run">
      <b>{c.loop ? 'Start recurring work?' : 'Start a run?'}</b>
      {edit !== undefined ? <textarea className="tm-edit" aria-label="Task for the run" rows={3} value={edit} onChange={(e) => setEdit(e.target.value)} /> : <span className="tm-detail">{c.task}</span>}
      {c.status === 'proposed' ? (
        <span className="tm-row">
          <span className="tm-grow" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => go({ action: 'dismiss' })}>
            Dismiss
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEdit(edit === undefined ? c.task : undefined)}>
            {edit === undefined ? 'Edit' : 'Done'}
          </Button>
          <Button size="sm" loading={busy} onClick={() => go({ action: 'start', ...(edit?.trim() ? { task: edit.trim() } : {}) })}>
            Start run
          </Button>
        </span>
      ) : c.status === 'started' && c.runId ? (
        <button type="button" className="tm-link" onClick={() => onGo({ tab: 'runs', id: c.runId! })}>
          {`Started ${shortRunId(c.runId)}`}
        </button>
      ) : (
        <span className="tm-muted">Dismissed</span>
      )}
    </div>
  );
}

/** A recurring ticket in the channel: its runs so far against its limits, and its auto-checked criterion. */
function LoopCard({ ticket: g, onGo }: { ticket?: GoalView; onGo: (r: Route) => void }) {
  if (!g) return <div className="tm-card loop">Recurring ticket · starting…</div>;
  const runs = g.items.filter((i) => i.kind === 'run');
  return (
    <div className="tm-card loop">
      <span className="tm-card-top">
        <span className={cn('tm-dot', { live: g.status === 'active' || g.status === 'needs_you' })} aria-hidden="true" />
        <button type="button" className="tm-link" onClick={() => onGo({ tab: 'tickets', id: g.id })}>{`${g.key} · ${g.title}`}</button>
        <span className="tm-mono">{`run ${runs.length}${g.maxRuns ? ` of ≤${g.maxRuns}` : ''} · ${fmtUsd(g.spentUsd)}${g.budgetUsd ? ` / ${fmtUsd(g.budgetUsd)}` : ''}`}</span>
      </span>
      <ol className="tm-chain" aria-label="Runs so far">
        {runs.map((i) => (
          <li key={i.id}>
            <button type="button" className={cn('tm-chip', i.attempt?.after ? (i.attempt.after.ok ? 'done' : 'idle') : 'live')} onClick={() => i.runId && onGo({ tab: 'runs', id: i.runId })}>
              {`${i.runId ? shortRunId(i.runId) : 'run'} · ${i.attempt?.after ? (i.attempt.after.summary ?? (i.attempt.after.ok ? 'passing' : 'failing')) : 'working'}`}
            </button>
          </li>
        ))}
        <li>
          <span className={cn('tm-chip', g.status === 'met' ? 'done' : 'idle')}>{`check: ${g.check?.command ?? ''}`}</span>
        </li>
      </ol>
      {g.status === 'met' || g.status === 'stopped' || g.status === 'paused' ? <span className="tm-muted">{g.status === 'met' ? 'Done' : `${g.status === 'paused' ? 'Paused' : 'Stopped'}${g.reason ? `: ${g.reason}` : ''}`}</span> : null}
    </div>
  );
}

/**
 * The squad pulse (board 8, when no thread is open): the squad's tickets per status (each opens the board on this squad),
 * what shipped today with five days of shipping, what is coming up (queued pickups, recurring tickets and their next
 * scheduled time) and what is pinned.
 */
function Pulse({ v, tickets = [], schedules, now, onGo, onMessage }: { v: TeamView; tickets?: GoalView[]; schedules: Schedule[]; now: number; onGo: (r: Route) => void; onMessage: (id: string) => void }) {
  const id = v.team.id;
  const mine = tickets.filter((x) => x.squad === id || x.team === id);
  const today = new Date(now).setHours(0, 0, 0, 0);
  const shipped = mine.filter((x) => x.stage === 'done' && (x.endedAt ?? 0) >= today);
  const recurring = mine.filter((x) => x.kind === 'loop' && x.stage !== 'done' && x.stage !== 'canceled');
  const nextOf = (g: GoalView) => schedules.filter((s) => s.enabled && s.target.kind === 'goal' && s.target.goalId === g.id && s.nextAt).map((s) => s.nextAt!).sort()[0];
  const pins = pinned(v.messages);
  const name = (bot: string) => v.members.find((m) => m.id === bot)?.name ?? bot;
  return (
    <aside className="sq-side pulse" aria-label="Squad pulse">
      <div className="sq-block">
        <div className="sq-row">
          <b>Squad tickets</b>
          <button type="button" className="tm-link sq-end" onClick={() => onGo({ tab: 'tickets', squad: id })}>
            Open board
          </button>
        </div>
        <div className="sq-counts">
          {squadCounts(tickets, id).map((c) => (
            <button key={c.stage} type="button" className={cn('sq-count', `s-${c.stage}`)} aria-label={`${c.n} ${c.label}: open the board`} onClick={() => onGo({ tab: 'tickets', squad: id })}>
              <b>{c.n}</b>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sq-block">
        <b>Shipped today</b>
        {shipped.length ? (
          shipped.map((x) => (
            <button key={x.id} type="button" className="sq-line" onClick={() => onGo({ tab: 'tickets', id: x.id })}>
              <span className="sq-dot ok" aria-hidden="true" />
              <span className="sq-grow">{`${x.key} ${x.title}`}</span>
              {x.prs?.at(-1) ? <span className="sq-mono">{`#${x.prs.at(-1)!.number}`}</span> : null}
            </button>
          ))
        ) : (
          <span className="sq-mut">Nothing shipped today yet.</span>
        )}
        <Bars days={shippedPerDay(mine, now, 5)} label="Tickets shipped per day, last 5 days" />
      </div>
      {v.queue.length || recurring.length ? (
        <div className="sq-block">
          <b>Coming up</b>
          {v.queue.map((q) => (
            <div key={q.id} className="sq-line">
              <Face id={q.bot} size={20} label="" />
              <span className="sq-grow">{`${name(q.bot)} picks up ${tickets.find((x) => x.id === q.ticket)?.key ?? 'a task'} next`}</span>
              <span className="sq-mut">queued</span>
            </div>
          ))}
          {recurring.map((g) => {
            const at = nextOf(g);
            return (
              <button key={g.id} type="button" className="sq-line" onClick={() => onGo({ tab: 'tickets', id: g.id })}>
                <span className="sq-tile" aria-hidden="true">
                  ↻
                </span>
                <span className="sq-grow">{g.title}</span>
                <span className="sq-mut">{at ? time(Date.parse(at)) : g.status === 'active' ? 'running' : 'on demand'}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="sq-block">
        <b>Pinned</b>
        {pins.length ? (
          pins.map((x) => (
            <button key={x.id} type="button" className="sq-pin" onClick={() => onMessage(x.id)}>
              <span className="sq-mut">{`${x.kind} ·`}</span> {x.text}
            </button>
          ))
        ) : (
          <span className="sq-mut">Pin a decision or a link from a message's menu.</span>
        )}
      </div>
    </aside>
  );
}

/** The Map (board 8): you and the agents, lines for who handed work to whom today; a line moves while that work is live. */
function SquadMap({ v, now }: { v: TeamView; now: number }) {
  const W = 900;
  const H = 520;
  const nodes = [{ id: 'you', name: 'You', line: '' }, ...v.members.map((m) => ({ id: m.id, name: m.name, line: m.state === 'idle' ? 'free' : m.state }))];
  const at = new Map(nodes.map((n, i) => [n.id, i === 0 ? { x: 160, y: H / 2 } : { x: 420 + 280 * ((i - 1) % 2), y: 90 + ((i - 1) * 340) / Math.max(1, nodes.length - 2) }]));
  const edges = mapToday(v.messages, v.members, now);
  return (
    <div className="sq-map" role="img" aria-label={`Who handed work to whom today: ${edges.length ? edges.map((e) => `${e.from === 'you' ? 'You' : nodes.find((n) => n.id === e.from)?.name} to ${nodes.find((n) => n.id === e.to)?.name}${e.live ? ' (live)' : ''}`).join(', ') : 'nobody yet'}`}>
      <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {edges.map((e) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          return <path key={`${e.from}>${e.to}`} className={cn('sq-edge', { live: e.live })} d={`M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`} strokeWidth={1.5 + Math.min(e.n, 4) * 0.5} />;
        })}
      </svg>
      {nodes.map((n) => {
        const pos = at.get(n.id)!;
        const busy = n.id !== 'you' && n.line !== 'free';
        return (
          <div key={n.id} className={cn('sq-node', { idle: !busy && n.id !== 'you' })} style={{ left: `${(pos.x / W) * 100}%`, top: `${(pos.y / H) * 100}%` }}>
            {n.id === 'you' ? (
              <span className="sq-person" style={{ width: 52, height: 52 }} aria-hidden="true">
                Y
              </span>
            ) : (
              <span className={cn({ 'sq-bob': busy })}>
                <Face id={n.id} size={52} label="" animate={busy ? 'always' : 'hover'} />
              </span>
            )}
            <span>{n.id === 'you' ? 'You' : `${n.name} · ${n.line}`}</span>
          </div>
        );
      })}
      <p className="sq-caption">Lines show who handed work to whom today · moving lines are live</p>
    </div>
  );
}

/** A reply in the thread panel. */
function ThreadReply({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const notify = useNotify();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(text.trim());
      setText('');
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="sq-reply" onSubmit={(e) => (e.preventDefault(), void send())}>
      <label htmlFor={id} className="sr-only">
        Reply in the thread
      </label>
      <textarea id={id} rows={1} placeholder="Reply…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send())} />
      <Button type="submit" size="icon" aria-label="Send reply" disabled={!text.trim()} loading={busy}>
        <ArrowUp size={15} aria-hidden="true" />
      </Button>
    </form>
  );
}

/**
 * The message box (board 8): suggestion chips, Enter sends, Shift+Enter is a new line, and @ (typed, or the @ button)
 * opens the picker: each agent with its face and whether it is free now or busy (a task then waits its turn).
 */
function Composer(p: { name: string; members: Member[]; start: string; chips: { label: string; text: string }[]; onChip: (text: string) => void; onSend: (text: string) => Promise<void> }) {
  const notify = useNotify();
  const [text, setText] = useState(p.start);
  const [caret, setCaret] = useState(p.start.length);
  const [sel, setSel] = useState(0);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    if (p.start) box.current?.focus();
  }, [p.start]);
  const word = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  const q = word?.[2]?.toLowerCase();
  const matches = q === undefined ? [] : p.members.filter((o) => o.name.toLowerCase().startsWith(q) || o.id.startsWith(q));
  const open = matches.length > 0 && !closed;
  const at = Math.min(sel, Math.max(0, matches.length - 1));
  const pick = (o: { name: string }) => {
    const startAt = caret - (q?.length ?? 0) - 1;
    const next = `${text.slice(0, startAt)}@${o.name} ${text.slice(caret)}`;
    const pos = startAt + o.name.length + 2;
    setText(next);
    setCaret(pos);
    setSel(0);
    requestAnimationFrame(() => box.current?.setSelectionRange(pos, pos));
  };
  const mention = () => {
    const pre = text && !/\s$/.test(text) ? `${text} @` : `${text}@`;
    setText(pre);
    setCaret(pre.length);
    setClosed(false);
    box.current?.focus();
  };
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await p.onSend(t);
      setText('');
      setCaret(0);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setSel((at + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    } else if (open && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      pick(matches[at]!);
    } else if (open && e.key === 'Escape') {
      e.preventDefault();
      setClosed(true);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  return (
    <form className="sq-composer" aria-label={`Message # ${p.name}`} onSubmit={(e) => (e.preventDefault(), void send())}>
      <div className="sq-chips">
        {p.chips.map((c) => (
          <button key={c.label} type="button" className="sq-chip button" onClick={() => p.onChip(c.text)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="sq-box">
        {open ? (
          <ul id={`${id}-list`} className="sq-suggest" role="listbox" aria-label="Mention">
            {matches.map((o, i) => {
              const a = availability(o.state);
              return (
                <li key={o.id} id={`${id}-o${i}`} role="option" aria-selected={i === at} onMouseDown={(e) => (e.preventDefault(), pick(o))}>
                  <Face id={o.id} size={20} label="" />
                  <span>{o.name}</span>
                  <span className={cn('sq-avail', a.free ? 'ok' : 'busy')}>{a.line}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <label htmlFor={id} className="sr-only">{`Message # ${p.name}`}</label>
        <textarea
          ref={box}
          id={id}
          rows={1}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${id}-o${at}` : undefined}
          placeholder={`Message # ${p.name} — @ someone to hand them work`}
          value={text}
          onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart ?? e.target.value.length), setClosed(false))}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Mention someone" onClick={mention}>
          @
        </Button>
        <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()} loading={busy}>
          <ArrowUp size={15} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

