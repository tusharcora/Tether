import { Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { api, fmtUsd } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { Face } from '../Face';
import { goalsApi, type GoalType, type GoalView, type Idea, type Member, type Priority, type Stage } from '../goals/goalsApi';
import { useNow } from '../home/Elapsed';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Route } from '../hooks';
import { teamsApi, type TeamsReply } from '../teams/teamsApi';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { BARS, BOARD, columns, filterTickets, PRIORITY_LABEL, priorityOf, readyFor, span, STAGE_LABEL, thisWeek, TYPE_WORD, type Filter, type Ticket } from './ticketModel';
import './tickets.css';

const TYPES: GoalType[] = ['feature', 'bugfix', 'refactor', 'chore'];
const GLYPH: Record<GoalType, string> = { feature: '+', bugfix: '!', refactor: '↻', chore: '·' };
const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const STAGES: Stage[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const dayOf = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short' });
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const TypeTile = ({ type }: { type?: GoalType }) => (
  <span className={cn('tk-ty', `t-${type ?? 'feature'}`)} title={TYPE_WORD[type ?? 'feature']} aria-hidden="true">
    {GLYPH[type ?? 'feature']}
  </span>
);
export const PriorityBars = ({ p }: { p: Priority }) => (
  <span className={cn('tk-pri', `p-${BARS[p].tone}`)} role="img" aria-label={p === 'none' ? 'No priority' : `${PRIORITY_LABEL[p]} priority`}>
    {[0, 1, 2].map((i) => (
      <i key={i} className={cn({ on: i < BARS[p].n })} />
    ))}
  </span>
);
const StageDot = ({ s }: { s: Stage }) => <span className={cn('tk-st', `s-${s}`)} aria-hidden="true" />;

type Agents = TeamsReply['agents'];
/** Who a member is, by name: an agent's crew name, "You", or a person's id. */
const nameOf = (agents: Agents, m?: Member) => (!m ? 'nobody' : m.kind === 'agent' ? (agents.find((a) => a.id === m.id)?.name ?? m.id) : m.id === 'owner' ? 'You' : m.id);

/**
 * Tickets (spec 2026-10-30-squads-tickets §2.5, board 10): the This week strip, filters, the Board (a column per status,
 * live progress on the work in flight, ideas from chats in Backlog, free agents and queued pickups in Todo) or the List,
 * and the detail panel with properties, criteria, the ship banner in review, and the activity with a comment box.
 */
export function Tickets(p: { tickets: GoalView[] | undefined; error?: string; onTicket: (t: GoalView) => void; project?: WorkspaceRow; squads?: TeamsReply; onSquadsChanged?: () => void; selected?: string; onSelect: (id?: string) => void; onGo: (r: Route) => void; create?: number; squad?: string; stage?: Stage }) {
  const notify = useNotify();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [f, setF] = useState<Filter>(p.squad ? { squad: p.squad } : {});
  const [making, setMaking] = useState(false);
  const now = useNow(true, 1000);
  useEffect(() => void (p.create && setMaking(true)), [p.create]);
  useEffect(() => setF((x) => ({ ...x, squad: p.squad })), [p.squad]);
  const ws = p.project?.id;
  const ideas = usePoll<Idea[]>(ws ? `/api/tickets/ideas?ws=${encodeURIComponent(ws)}` : null, 30_000);
  const all = useMemo(() => (p.tickets ?? []).filter((t) => !ws || t.workspace === ws), [p.tickets, ws]);
  const squads = (p.squads?.squads ?? []).filter((s) => !ws || s.project === ws);
  const agents = p.squads?.agents ?? [];
  const shown = filterTickets(all, f);
  const cols = columns(shown);
  const week = thisWeek(all, now);
  const ready = readyFor(all, squads, agents);
  const open = all.find((t) => t.id === p.selected);
  const live = (t: Ticket) => agents.find((a) => a.ticket === t.id && a.state && a.state !== 'idle');
  const queuedFor = (t: Ticket) => ready.pickups.find((x) => x.q.ticket === t.id);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'stage' in r) p.onTicket(r as GoalView);
    } catch (e) {
      notify.fail(e);
    }
  };
  const chip = (label: string, on: boolean, click: () => void) => (
    <button type="button" className={cn('tk-chip', { on })} aria-pressed={on} onClick={click}>
      {label}
    </button>
  );
  const plain = !f.needs && !f.bugs && !f.canceled;
  const inReview = all.filter((t) => t.needs && t.stage !== 'done' && t.stage !== 'canceled').length;

  return (
    <div className="tk">
      <header className="tk-head">
        <h1>Tickets</h1>
        <span className="tk-sub">{`${p.project?.name ?? 'All projects'} · ${all.filter((t) => t.stage === 'in_progress').length} in progress${inReview ? ` · ${inReview} waiting on you` : ''}`}</span>
        <span className="tk-gap" />
        <div className="tk-tabs" role="tablist" aria-label="View">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {v === 'board' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setMaking(true)}>
          New ticket
        </Button>
      </header>

      <section className="tk-week" aria-label="This week">
        <div className="tk-tile">
          <div>
            <b className="ok">{week.shipped}</b>
            <span>shipped this week</span>
          </div>
          <Bars days={week.perDay} label="Shipped per day this week" />
        </div>
        <div className="tk-tile">
          <b className="live">{week.inFlight}</b>
          <span>{`in flight${week.who.length ? ` · ${week.who.map((id) => nameOf(agents, { kind: 'agent', id })).join(', ')}` : ''}`}</span>
        </div>
        {week.avgMs !== undefined ? (
          <div className="tk-tile">
            <b>{span(week.avgMs)}</b>
            <span>avg. Todo → Done</span>
          </div>
        ) : null}
        {week.oldest ? (
          <button type="button" className="tk-tile warn" onClick={() => p.onSelect(week.oldest!.ticket.id)}>
            <b>{span(now - week.oldest.since)}</b>
            <span>{`oldest waiting on you · ${week.oldest.ticket.key}`}</span>
          </button>
        ) : null}
      </section>

      <div className="tk-filters" role="group" aria-label="Filters">
        {chip('All', plain, () => setF((x) => ({ squad: x.squad, assignee: x.assignee })))}
        {chip('Needs me', !!f.needs, () => setF((x) => ({ ...x, needs: !x.needs || undefined })))}
        {chip('Bugs', !!f.bugs, () => setF((x) => ({ ...x, bugs: !x.bugs || undefined })))}
        {chip('Canceled', !!f.canceled, () => (setF((x) => ({ ...x, canceled: !x.canceled || undefined })), setView('list')))}
        <label className="tk-pick">
          <span className="sr-only">Squad</span>
          <select value={f.squad ?? ''} onChange={(e) => setF((x) => ({ ...x, squad: e.target.value || undefined }))}>
            <option value="">All squads</option>
            {squads.map((s) => (
              <option key={s.id} value={s.id}>{`# ${s.name}`}</option>
            ))}
          </select>
        </label>
        <label className="tk-pick">
          <span className="sr-only">Assignee</span>
          <select value={f.assignee ?? '*'} onChange={(e) => setF((x) => ({ ...x, assignee: e.target.value === '*' ? undefined : e.target.value }))}>
            <option value="*">Assignee: anyone</option>
            <option value="">Unassigned</option>
            <option value="owner">You</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <span className="tk-tip">Tip: say "fix the sign-in bug" in any chat or squad and a ticket appears here</span>
      </div>

      <div className="tk-body">
        {p.tickets === undefined ? (
          <p className="tk-empty">{p.error ? `Couldn't load tickets: ${p.error}` : 'Loading tickets…'}</p>
        ) : view === 'board' ? (
          <section className="tk-board" aria-label="Board">
            {BOARD.map((s) => (
              <div key={s} className="tk-col" role="group" aria-label={STAGE_LABEL[s]}>
                <div className="tk-colh">
                  <StageDot s={s} />
                  <b>{STAGE_LABEL[s]}</b>
                  {cols[s].length}
                </div>
                {cols[s].map((t) => (
                  <TicketCard key={t.id} t={t} agents={agents} now={now} live={live(t)} queued={!!queuedFor(t)} onOpen={() => p.onSelect(t.id)} />
                ))}
                {s === 'backlog' && ws && ideas.data?.length ? (
                  <div className="tk-box ideas">
                    <span>Ideas from your chats</span>
                    {ideas.data.slice(0, 4).map((i) => (
                      <button key={`${i.chat}:${i.proposal}`} type="button" className="tk-chip" aria-label={`Make a ticket: ${i.title}`} onClick={() =>
                          void act(async () => {
                            const t = await goalsApi.fromIdea(ws, i);
                            void ideas.refresh();
                            return t;
                          })
                        }>
                        {`+ "${i.title}"`}
                      </button>
                    ))}
                    <small>Or type in any chat: "make a ticket to…"</small>
                  </div>
                ) : null}
                {s === 'todo' && (ready.assign.length || ready.pickups.length) ? (
                  <div className="tk-box ready">
                    <span>Ready for an agent</span>
                    {ready.assign.map(({ ticket, agent }) => (
                      <div key={ticket.id} className="tk-ready">
                        <Face id={agent} size={20} label="" />
                        <span>
                          <b>{nameOf(agents, { kind: 'agent', id: agent })}</b>
                          {` is free · could take ${ticket.key}`}
                        </span>
                        <Button size="sm" variant="secondary" onClick={() => void act(async () => (await goalsApi.patch(ticket.id, { assignee: { kind: 'agent', id: agent } }), goalsApi.start(ticket.id)))}>
                          Assign
                        </Button>
                      </div>
                    ))}
                    {ready.pickups.map(({ squad, q, ticket }) => (
                      <div key={q.id} className="tk-ready">
                        <Face id={q.bot} size={20} label="" />
                        <span>
                          <b>{nameOf(agents, { kind: 'agent', id: q.bot })}</b>
                          {` · picks up ${ticket?.key ?? 'a task'} next`}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => void act(async () => (await teamsApi.startQueued(squad, q.id), p.onSquadsChanged?.()))}>
                          Start now
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : (
          <ListView tickets={shown} agents={agents} squads={squads} onOpen={p.onSelect} />
        )}
        {open ? <TicketPanel key={open.id} t={open} agents={agents} squads={squads} now={now} onClose={() => p.onSelect(undefined)} onTicket={p.onTicket} onGo={p.onGo} /> : null}
      </div>
      <Dialog open={making} onOpenChange={setMaking}>
        <DialogContent title="New ticket" className="tk-dialog">
          {making ? (
            <NewTicket
              project={p.project}
              squads={squads}
              agents={agents}
              squad={f.squad}
              onCancel={() => setMaking(false)}
              onMade={(t) => (p.onTicket(t), setMaking(false), p.onSelect(t.id))}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A mini bar chart (no axes): each day's count against the busiest day, today green. */
export function Bars({ days, label }: { days: number[]; label: string }) {
  const max = Math.max(1, ...days);
  return (
    <span className="tk-bars" role="img" aria-label={`${label}: ${days.join(', ')}`}>
      {days.map((n, i) => (
        <i key={i} className={cn({ today: i === days.length - 1 })} style={{ height: `${Math.max(8, (n / max) * 100)}%` }} />
      ))}
    </span>
  );
}

/** A board card (board 10): type, key, priority, title, labels, and by status: live progress, needs-you chips, a done PR. */
function TicketCard({ t, agents, now, live, queued, onOpen }: { t: Ticket; agents: Agents; now: number; live?: Agents[number]; queued: boolean; onOpen: () => void }) {
  const met = t.criteria.filter((c) => c.done).length;
  const pr = t.prs?.at(-1);
  return (
    <button type="button" className={cn('tk-card', `s-${t.stage}`, { needs: !!t.needs })} onClick={onOpen} aria-label={`${t.key} ${t.title}`}>
      <span className="tk-row">
        <TypeTile type={t.type} />
        <span className="tk-id">{t.key}</span>
        {t.stage === 'in_review' && t.needs ? <span className="tk-pill warn">needs you</span> : t.stage === 'done' ? <span className="tk-when">{t.endedAt ? dayOf(t.endedAt) : ''}</span> : <PriorityBars p={priorityOf(t)} />}
      </span>
      <span className="tk-title">{t.title}</span>
      {t.labels?.length && t.stage !== 'done' ? (
        <span className="tk-row wrap">
          {t.labels.map((l) => (
            <span key={l} className="tk-pill">
              {l}
            </span>
          ))}
        </span>
      ) : null}
      {t.stage === 'in_progress' && live ? (
        <>
          <span className="tk-bar">
            <i className="shimmer" style={{ width: `${Math.round((live.progress ?? 0.1) * 100)}%` }} />
          </span>
          <span className="tk-row">
            <Face id={live.id} size={18} label="" animate="always" />
            <span className="tk-live">{`${live.name} · ${live.line ?? live.state}`}</span>
            {live.since ? <span className="tk-when mono">{clock(now - live.since)}</span> : null}
          </span>
        </>
      ) : null}
      {t.stage === 'in_review' ? (
        <span className="tk-row wrap">
          {t.criteria.length ? <span className={cn('tk-pill', { ok: met === t.criteria.length })}>{`${met}/${t.criteria.length} criteria`}</span> : null}
          {pr ? <span className="tk-pill">{`PR #${pr.number}`}</span> : null}
          <span className="tk-faces">
            {[t.assignee, t.reviewer].filter((m): m is Member => m?.kind === 'agent').map((m) => (
              <Face key={m.id} id={m.id} size={18} label="" />
            ))}
          </span>
        </span>
      ) : null}
      {t.stage === 'todo' && t.assignee?.kind === 'agent' ? (
        <span className="tk-row">
          <Face id={t.assignee.id} size={18} label="" />
          <span className="tk-mut">{queued ? `${nameOf(agents, t.assignee)} picks it up next` : nameOf(agents, t.assignee)}</span>
        </span>
      ) : null}
      {t.stage === 'done' && pr ? <span className="tk-pill">{`PR #${pr.number}${pr.merged ? ' merged' : ''}`}</span> : null}
      {t.needs && t.stage !== 'in_review' ? <span className="tk-mut warn">{t.needs}</span> : null}
    </button>
  );
}

/** The List: key, type, title, status, priority, assignee, squad, updated. */
function ListView({ tickets, agents, squads, onOpen }: { tickets: Ticket[]; agents: Agents; squads: TeamsReply['squads']; onOpen: (id: string) => void }) {
  if (!tickets.length) return <p className="tk-empty">No tickets match.</p>;
  return (
    <table className="tk-list">
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Title</th>
          <th scope="col">Status</th>
          <th scope="col">Priority</th>
          <th scope="col">Assignee</th>
          <th scope="col">Squad</th>
          <th scope="col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {[...tickets]
          .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || (b.num ?? 0) - (a.num ?? 0))
          .map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.key}</td>
              <td>
                <button type="button" className="tk-link" onClick={() => onOpen(t.id)}>
                  <TypeTile type={t.type} /> {t.title}
                </button>
              </td>
              <td>
                <StageDot s={t.stage} /> {STAGE_LABEL[t.stage]}
              </td>
              <td>
                <PriorityBars p={priorityOf(t)} />
              </td>
              <td>{t.assignee ? nameOf(agents, t.assignee) : '—'}</td>
              <td>{t.squad ? `# ${squads.find((s) => s.id === t.squad)?.name ?? t.squad}` : '—'}</td>
              <td className="tk-mut">{dayOf(t.activity?.at(-1)?.at ?? t.createdAt)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/** The ship banner's sentence: criteria met, the review, then "Ship it?". */
function shipLine(t: Ticket, agents: Agents): string {
  const met = t.criteria.every((c) => c.done);
  const verdict = [...(t.activity ?? [])].reverse().find((a) => a.verdict);
  const review = verdict ? (verdict.verdict === 'pass' ? `${verdict.who.name} approved` : `${verdict.who.name} asked for changes`) : t.reviewer ? `${nameOf(agents, t.reviewer)} has not reviewed it yet` : '';
  const crit = t.criteria.length ? (met ? 'All criteria met' : `${t.criteria.filter((c) => c.done).length} of ${t.criteria.length} criteria met`) : '';
  return `${[crit, review].filter(Boolean).join(' and ') || 'Ready'}. Ship it?`;
}

/** The detail panel (board 10): properties, criteria, the ship banner in review, the activity and a comment box. */
function TicketPanel({ t, agents, squads, now, onClose, onTicket, onGo }: { t: Ticket; agents: Agents; squads: TeamsReply['squads']; now: number; onClose: () => void; onTicket: (t: GoalView) => void; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const [comment, setComment] = useState('');
  const [crit, setCrit] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'stage' in r) onTicket(r as GoalView);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => api<GoalView>('GET', `/api/tickets/${t.id}`);
  const patch = (body: Record<string, unknown>) => void run(() => goalsApi.patch(t.id, body));
  const member = (v: string): Member | null => (!v ? null : v === 'owner' ? { kind: 'person', id: 'owner' } : { kind: 'agent', id: v });
  const pr = t.prs?.filter((x) => !x.merged).at(-1) ?? t.prs?.at(-1);
  const notStarted = t.status === 'paused' && !t.startedAt;
  const squad = squads.find((s) => s.id === t.squad);
  const send = () => {
    const text = comment.trim();
    if (!text) return;
    void run(async () => {
      const r = await goalsApi.comment(t.id, text);
      setComment('');
      return r;
    });
  };
  return (
    <aside className="tk-panel" aria-label="Ticket">
      <div className="tk-panel-head">
        <TypeTile type={t.type} />
        <span className="tk-id">{t.key}</span>
        <span className="tk-gap" />
        <Button variant="ghost" size="icon" aria-label="Close ticket" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </Button>
      </div>
      <div className="tk-panel-body">
        <h2>{t.title}</h2>
        {t.description ? <p className="tk-desc">{t.description}</p> : null}
        <div className="tk-props">
          <Prop label="Status" id={`${id}-st`}>
            <select id={`${id}-st`} value={t.stage} disabled={busy} onChange={(e) => patch({ stage: e.target.value })}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
            {t.needs ? <span className="tk-mut warn">{t.needs}</span> : null}
          </Prop>
          <Prop label="Priority" id={`${id}-pr`}>
            <select id={`${id}-pr`} value={priorityOf(t)} disabled={busy} onChange={(e) => patch({ priority: e.target.value })}>
              {PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {PRIORITY_LABEL[x]}
                </option>
              ))}
            </select>
          </Prop>
          <Prop label="Assignee" id={`${id}-as`}>
            {t.assignee?.kind === 'agent' ? <Face id={t.assignee.id} size={18} label="" /> : null}
            <select id={`${id}-as`} value={t.assignee ? t.assignee.id : ''} disabled={busy} onChange={(e) => patch({ assignee: member(e.target.value) })}>
              <option value="">Nobody</option>
              <option value="owner">You</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Prop>
          <Prop label="Reviewer" id={`${id}-rv`}>
            <select id={`${id}-rv`} value={t.reviewer ? t.reviewer.id : ''} disabled={busy} onChange={(e) => patch({ reviewer: member(e.target.value) })}>
              <option value="">Nobody</option>
              <option value="owner">You</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Prop>
          <Prop label="Squad" id={`${id}-sq`}>
            <select id={`${id}-sq`} value={t.squad ?? ''} disabled={busy} onChange={(e) => patch({ squad: e.target.value || null })}>
              <option value="">None</option>
              {squads.map((s) => (
                <option key={s.id} value={s.id}>{`# ${s.name}`}</option>
              ))}
            </select>
            {squad ? (
              <button type="button" className="tk-link" onClick={() => onGo({ tab: 'squads', id: squad.id })}>
                Open
              </button>
            ) : null}
          </Prop>
          <Prop label="Linked PR">
            {pr ? (
              <a href={pr.url} target="_blank" rel="noreferrer">{`PR #${pr.number}${pr.merged ? ' · merged' : ''}`}</a>
            ) : (
              <span className="tk-mut">not opened yet</span>
            )}
          </Prop>
          <Prop label="Spent">
            <span className="tk-mut">{fmtUsd(t.spentUsd)}</span>
          </Prop>
          {t.kind === 'loop' && t.team ? (
            <Prop label="Recurring">
              <span className="tk-mut">{`until \`${t.check?.command ?? ''}\` passes`}</span>
            </Prop>
          ) : null}
          {t.origin ? (
            <Prop label="Created from">
              <Origin o={t.origin} squads={squads} onGo={onGo} />
            </Prop>
          ) : null}
        </div>

        <div className="tk-crit" role="group" aria-labelledby={`${id}-cr`}>
          <b id={`${id}-cr`}>Acceptance criteria</b>
          {t.criteria.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={c.done} disabled={busy || !!c.auto} onChange={() => c.item !== undefined && void run(async () => (await goalsApi.toggleItem(t.id, c.item!, !c.done), refresh()))} />
              <span>
                {c.auto ? <span className="mono">{c.text}</span> : c.text}
                {c.auto ? <span className="tk-mut"> (checked automatically)</span> : null}
              </span>
            </label>
          ))}
          <form className="tk-add" onSubmit={(e) => (e.preventDefault(), crit.trim() && void run(async () => (await goalsApi.addItem(t.id, crit.trim()), setCrit(''), refresh())))}>
            <label className="sr-only" htmlFor={`${id}-add`}>
              Add a criterion
            </label>
            <input id={`${id}-add`} placeholder="+ Add a criterion" value={crit} onChange={(e) => setCrit(e.target.value)} />
          </form>
        </div>

        {t.stage === 'in_review' ? (
          <div className="tk-ship" role="group" aria-label="Ship">
            <span>{shipLine(t, agents)}</span>
            <Button size="sm" loading={busy} onClick={() => void run(() => goalsApi.ship(t.id))}>
              {pr && !pr.merged ? `Merge PR #${pr.number}` : 'Ship it'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => goalsApi.sendBack(t.id))}>
              Send back
            </Button>
          </div>
        ) : null}
        {notStarted ? (
          <div className="tk-row">
            <Button size="sm" loading={busy} onClick={() => void run(() => goalsApi.start(t.id))}>
              {t.assignee?.kind === 'agent' && t.squad ? `Hand to ${nameOf(agents, t.assignee)}` : 'Start'}
            </Button>
            <span className="tk-mut">Nothing runs until you start it.</span>
          </div>
        ) : null}

        <div className="tk-activity">
          <b>Activity</b>
          {(t.activity ?? []).map((a, i) => (
            <div key={i} className="tk-act">
              {a.who.kind === 'agent' ? <Face id={a.who.id} size={22} label="" /> : <span className="tk-avatar">{a.who.kind === 'tether' ? 'T' : a.who.name.slice(0, 2).toUpperCase()}</span>}
              <span>
                <b>{a.who.name}</b> {a.text} <span className="tk-mut">{`· ${now - a.at < 86_400_000 ? timeOf(a.at) : dayOf(a.at)}`}</span>
                {a.runId ? (
                  <>
                    {' '}
                    <button type="button" className="tk-link" onClick={() => onGo({ tab: 'runs', id: a.runId! })}>
                      run
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
          <form className="tk-comment" onSubmit={(e) => (e.preventDefault(), send())}>
            <label className="sr-only" htmlFor={`${id}-c`}>
              Comment
            </label>
            <textarea id={`${id}-c`} rows={2} placeholder="Comment, or @ an agent to hand it work…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} />
            <Button type="submit" size="sm" variant="secondary" disabled={!comment.trim()} loading={busy}>
              Comment
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/** Where a ticket came from: its chat, its squad message, or a trigger. */
function Origin({ o, squads, onGo }: { o: NonNullable<Ticket['origin']>; squads: TeamsReply['squads']; onGo: (r: Route) => void }) {
  const go: Route = o.kind === 'chat' ? { tab: 'chats', id: o.chat } : o.kind === 'squad' ? { tab: 'squads', id: o.squad } : { tab: 'triggers' };
  const label = o.kind === 'chat' ? 'a chat' : o.kind === 'squad' ? `a message in # ${squads.find((s) => s.id === o.squad)?.name ?? 'a squad'}` : 'a trigger';
  return (
    <button type="button" className="tk-link" onClick={() => onGo(go)}>
      {label}
    </button>
  );
}

function Prop({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className="tk-prop">
      {id ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}
      <span className="tk-row">{children}</span>
    </div>
  );
}

/** New ticket: title, description, type, priority, status, squad, assignee, reviewer, labels and criteria. */
function NewTicket(p: { project?: WorkspaceRow; squads: TeamsReply['squads']; agents: Agents; squad?: string; onCancel: () => void; onMade: (t: GoalView) => void }) {
  const notify = useNotify();
  const id = useId();
  const [d, setD] = useState({ title: '', description: '', type: 'feature' as GoalType, priority: 'none' as Priority, stage: 'todo' as 'backlog' | 'todo', squad: p.squad ?? '', assignee: '', reviewer: '', labels: '', criteria: '' });
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<typeof d>) => setD((cur) => ({ ...cur, ...x }));
  const member = (v: string) => (v === 'owner' ? { kind: 'person', id: 'owner' } : v ? { kind: 'agent', id: v } : undefined);
  const submit = async () => {
    if (!p.project || !d.title.trim()) return;
    setBusy(true);
    try {
      const lines = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);
      const t = await goalsApi.create({
        title: d.title.trim(),
        workspace: p.project.id,
        type: d.type,
        priority: d.priority,
        stage: d.stage,
        recurring: false,
        ...(d.description.trim() ? { description: d.description.trim() } : {}),
        ...(d.squad ? { squad: d.squad } : {}),
        ...(member(d.assignee) ? { assignee: member(d.assignee) } : {}),
        ...(member(d.reviewer) ? { reviewer: member(d.reviewer) } : {}),
        ...(d.labels.trim() ? { labels: lines(d.labels, /,/) } : {}),
        ...(d.criteria.trim() ? { criteria: lines(d.criteria, /\n/) } : {}),
      });
      p.onMade(t);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const sel = (label: string, key: keyof typeof d, opts: [string, string][]) => (
    <label className="tk-field" htmlFor={`${id}-${key}`}>
      <span>{label}</span>
      <select id={`${id}-${key}`} value={d[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof d>)}>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const who: [string, string][] = [['', 'Nobody'], ['owner', 'You'], ...p.agents.map((a): [string, string] => [a.id, a.name])];
  if (!p.project) return <p className="tk-mut">Open a project first: tickets belong to a project.</p>;
  return (
    <form className="tk-new" onSubmit={(e) => (e.preventDefault(), void submit())}>
      <label className="tk-field" htmlFor={`${id}-title`}>
        <span>Title</span>
        <input id={`${id}-title`} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="Sign-in returns people to where they were" autoFocus />
      </label>
      <label className="tk-field" htmlFor={`${id}-desc`}>
        <span>Description</span>
        <textarea id={`${id}-desc`} rows={3} maxLength={2000} value={d.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="tk-grid">
        {sel('Type', 'type', TYPES.map((x) => [x, TYPE_WORD[x]]))}
        {sel('Priority', 'priority', PRIORITIES.map((x) => [x, PRIORITY_LABEL[x]]))}
        {sel('Status', 'stage', [['todo', 'Todo'], ['backlog', 'Backlog']])}
        {sel('Squad', 'squad', [['', 'None'], ...p.squads.map((s): [string, string] => [s.id, `# ${s.name}`])])}
        {sel('Assignee', 'assignee', who)}
        {sel('Reviewer', 'reviewer', who)}
      </div>
      <label className="tk-field" htmlFor={`${id}-labels`}>
        <span>Labels (comma separated)</span>
        <input id={`${id}-labels`} value={d.labels} onChange={(e) => set({ labels: e.target.value })} placeholder="auth, settings" />
      </label>
      <label className="tk-field" htmlFor={`${id}-crit`}>
        <span>Acceptance criteria (one per line)</span>
        <textarea id={`${id}-crit`} rows={3} value={d.criteria} onChange={(e) => set({ criteria: e.target.value })} />
      </label>
      <div className="tk-row end">
        <Button type="button" variant="ghost" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!d.title.trim()}>
          <Plus size={14} aria-hidden="true" /> Create ticket
        </Button>
      </div>
    </form>
  );
}
