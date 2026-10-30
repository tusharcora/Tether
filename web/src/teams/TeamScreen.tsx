import { ArrowUp, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { fmtUsd } from '../api';
import { LinkPreview } from '../components/assistant-ui/elements/link-preview';
import { SpeakerIdentity } from '../components/assistant-ui/elements/speaker-identity';
import { TeamRunCard } from '../assistant/taskCards';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { Loading } from '../components/Loading';
import { Face } from '../Face';
import { GoalScore } from '../goals/Goals';
import { noLimits, type GoalView } from '../goals/goalsApi';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Route } from '../hooks';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { RunDiff } from '../ui/RunDiff';
import { FaceStack } from '../ui/studio/FaceStack';
import { InlineError } from '../ui/studio/InlineError';
import { shortRunId } from '../ui/studio/RunGlyph';
import { StepTrack } from '../ui/studio/StepTrack';
import { TeamForm } from './NewTeam';
import { approversLine, LEVELS, PLACE, STATE_LABEL, teamsApi, type Card, type TeamMessage, type TeamsReply, type TeamView } from './teamsApi';
import './teams.css';

const VIEW_MS = 1500;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SPEAKER = { person: 'user', agent: 'agent', tether: 'agent' } as const;

/** Message text with its @mentions of the team's agents and people highlighted. */
function withMentions(text: string, names: string[]): ReactNode[] {
  if (!names.length) return [text];
  const re = new RegExp(`(@(?:${names.map(esc).join('|')}))(?![\\w-])`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <span key={i} className="tm-mention">{part}</span> : part));
}

/**
 * A team (board 1): the header (name, place, faces, Add member, settings), the channel (messages, @mentions, agent pills,
 * run, loop, approval, proposal and PR cards) with its @-autocomplete composer, and the right panel (Working now, Members,
 * Rules). Polled: cards are edited in place on the server, so a poll shows progress and decisions as they happen.
 */
export function TeamScreen(p: { id: string; goals?: GoalView[]; agents: TeamsReply['agents']; projects: WorkspaceRow[]; onGo: (r: Route) => void; onChanged: () => void; onNewAgent: () => void }) {
  const notify = useNotify();
  const view = usePoll<TeamView>(`/api/teams/${encodeURIComponent(p.id)}`, VIEW_MS);
  const [settings, setSettings] = useState(false);
  const [diff, setDiff] = useState<{ title: string; text?: string }>();
  const end = useRef<HTMLLIElement>(null);
  const v = view.data;
  const count = v?.messages.length ?? 0;
  // a block body: newer Chrome's scrollIntoView returns a promise, which React would take for a cleanup
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  if (!v) return <Loading loading={!view.error} lines={6} label="Loading the team">{view.error ? <InlineError message={view.error} onRetry={() => void view.refresh()} /> : null}</Loading>;
  const t = v.team;
  const names = [...v.members.map((m) => m.name), ...t.people.filter((x) => x.id !== 'owner').map((x) => x.name)];
  const specialty = (id: string) => v.members.find((m) => m.id === id)?.specialty;
  const refresh = () => (void view.refresh(), p.onChanged());
  const act = (msg: TeamMessage, body: { action: string; reason?: string; task?: string }) =>
    teamsApi.decide(t.id, msg.id, body).then(refresh, (e: unknown) => {
      notify.fail(e);
      refresh();
    });
  const showDiff = (msg: TeamMessage, title: string) => {
    setDiff({ title });
    teamsApi.diff(t.id, msg.id).then((d) => setDiff({ title, text: d.diff }), (e: unknown) => (setDiff(undefined), notify.fail(e)));
  };

  return (
    <div className="tm">
      <header className="tm-head">
        <h1>
          <span aria-hidden="true">#</span> {t.name}
        </h1>
        <span className="tm-sub">{`${PLACE[t.place]} team · you + ${t.agents.length} agent${t.agents.length === 1 ? '' : 's'}`}</span>
        <span className="tm-gap" />
        <FaceStack bots={t.agents} size={22} />
        <Button variant="secondary" size="sm" onClick={() => setSettings(true)}>
          Add member
        </Button>
        <Button variant="secondary" size="icon" aria-label="Team settings" onClick={() => setSettings(true)}>
          <Settings size={15} aria-hidden="true" />
        </Button>
      </header>
      <div className="tm-body">
        <section className="tm-channel" aria-label="Channel">
          <ol className="tm-msgs" aria-label="Messages" aria-live="polite">
            {v.messages.length ? null : <li className="tm-empty">Say hello, or @mention an agent to hand it a question, a task or a loop.</li>}
            {v.messages.map((m) => (
              <li key={m.id} className="tm-msg who">
                {/* who spoke, from the element; the body below keeps its mentions and cards (the element's text is plain) */}
                <SpeakerIdentity turns={[{ id: m.id, kind: SPEAKER[m.from.kind], name: m.from.name, detail: [m.from.kind === 'agent' ? `agent${specialty(m.from.id) ? ` · ${specialty(m.from.id)}` : ''}` : '', time(m.at)].filter(Boolean).join(' · '), text: '' }]} />
                <div className="tm-msg-main">
                  <p className={cn('tm-text', { pending: !!m.pending })} aria-busy={m.pending || undefined}>
                    {withMentions(m.text, names)}
                  </p>
                  {m.card ? <CardView msg={m} card={m.card} team={v} goals={p.goals} onGo={p.onGo} onAct={act} onDiff={showDiff} /> : null}
                </div>
              </li>
            ))}
            <li ref={end} aria-hidden="true" />
          </ol>
          <Composer name={t.name} options={v.members.map((m) => ({ id: m.id, name: m.name, hint: m.specialty }))} onSend={(text) => teamsApi.post(t.id, text).then(refresh)} />
        </section>
        <aside className="tm-panel" aria-label="About this team">
          <section aria-labelledby={`${t.id}-work`}>
            <h2 id={`${t.id}-work`}>Working now</h2>
            {v.working.length ? null : <p className="tm-muted">Nothing running.</p>}
            {v.working.map((w) => (
              <button key={w.goalId ?? w.runId} type="button" className={cn('tm-work', { needs: w.needs })} onClick={() => p.onGo(w.goalId ? { tab: 'goals', id: w.goalId } : { tab: 'runs', id: w.runId })}>
                <span className="tm-work-top">
                  <Face id={w.agent} size={16} />
                  <b>{w.title}</b>
                  <span className={cn('tm-tag', { needs: w.needs, live: !w.needs })}>{w.needs ? 'needs you' : w.kind}</span>
                </span>
                {w.progress !== undefined ? (
                  <span className="tm-bar" role="progressbar" aria-label={`${w.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.progress * 100)}>
                    <span style={{ width: `${Math.round(w.progress * 100)}%` }} />
                  </span>
                ) : null}
                <span className="tm-mono">{w.line}</span>
              </button>
            ))}
          </section>
          <section aria-labelledby={`${t.id}-members`}>
            <h2 id={`${t.id}-members`}>Members</h2>
            <ul className="tm-members">
              {t.people.map((x) => (
                <li key={x.id}>
                  <span className="tm-avatar small">{x.name.charAt(0).toUpperCase()}</span>
                  <span className="tm-grow">{x.name}</span>
                  <span className="tm-muted">{x.id === 'owner' ? 'owner' : ''}</span>
                </li>
              ))}
              {v.members.map((m) => (
                <li key={m.id}>
                  <Face id={m.id} size={22} />
                  <span className="tm-grow">
                    {m.name} <span className="tm-muted">· {m.specialty}</span>
                  </span>
                  <span className={cn('tm-state', m.state)}>{STATE_LABEL[m.state]}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby={`${t.id}-rules`} className="tm-rules">
            <h2 id={`${t.id}-rules`}>Rules</h2>
            <span>{`Approvals: ${approversLine(t)} · ${LEVELS.find((l) => l.id === t.level)!.label}`}</span>
            <span>{`Limit: ${fmtUsd(t.limits.usdPerDay)} a day · ${t.limits.runsPerDay} runs a day`}</span>
            <span>{`Today: ${fmtUsd(v.spend.usd)} · ${v.spend.runs} run${v.spend.runs === 1 ? '' : 's'}`}</span>
            <span>{`Lives in: ${PLACE[t.place]}`}</span>
            {t.learn ? null : <span>Agents do not learn from this team</span>}
          </section>
        </aside>
      </div>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent title={`${t.name} settings`} className="tm-dialog">
          {settings ? (
            <TeamForm
              team={t}
              agents={p.agents}
              projects={p.projects}
              onSaved={() => (setSettings(false), refresh())}
              onCancel={() => setSettings(false)}
              onNewAgent={p.onNewAgent}
              onDeleted={() => (setSettings(false), p.onChanged(), p.onGo({ tab: 'home' }))}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(undefined)}>
        <DialogContent title={diff?.title ?? 'Diff'} className="tm-dialog">
          {diff?.text === undefined ? <Loading loading lines={6} label="Loading the diff" /> : diff.text ? <RunDiff text={diff.text} /> : <p className="tm-muted">No changes.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Act = (m: TeamMessage, body: { action: string; reason?: string; task?: string }) => Promise<void>;

function CardView(p: { msg: TeamMessage; card: Card; team: TeamView; goals?: GoalView[]; onGo: (r: Route) => void; onAct: Act; onDiff: (m: TeamMessage, title: string) => void }) {
  const c = p.card;
  if (c.kind === 'run') return <TeamRunCard card={c} onOpen={() => p.onGo({ tab: 'runs', id: c.runId })} />;
  if (c.kind === 'loop') return <LoopCard goal={p.goals?.find((g) => g.id === c.goalId)} onGo={p.onGo} />;
  if (c.kind === 'approval') return <AskCard msg={p.msg} card={c} team={p.team} onAct={p.onAct} onDiff={p.onDiff} />;
  if (c.kind === 'proposal') return <ProposalCard msg={p.msg} card={c} onAct={p.onAct} onGo={p.onGo} />;
  // no unfurl: the link and what the PR card already knows
  return <LinkPreview layout="compact" href={c.url} title={`PR #${c.number} · ${c.title}`} description={c.merged ? 'merged' : 'open'} />;
}

/** A loop: its live state, spend against its limits, and the chain of runs leading to its check. */
function LoopCard({ goal: g, onGo }: { goal?: GoalView; onGo: (r: Route) => void }) {
  if (!g) return <div className="tm-card loop">Loop · starting…</div>;
  const runs = g.items.filter((i) => i.kind === 'run');
  const live = g.status === 'active' || g.status === 'needs_you';
  return (
    <div className="tm-card loop">
      <span className="tm-card-top">
        <span className={cn('tm-dot', { live })} aria-hidden="true" />
        <b>{`Loop · ${g.title}`}</b>
        <span className="tm-mono">{`run ${runs.length}${g.maxRuns ? ` of ≤${g.maxRuns}` : ''} · ${fmtUsd(g.spentUsd)}${g.budgetUsd ? ` / ${fmtUsd(g.budgetUsd)}` : ''}${noLimits(g) ? ' · no limits' : ''}`}</span>
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
      {g.status === 'met' || g.status === 'stopped' || g.status === 'paused' ? <span className="tm-muted">{g.status === 'met' ? 'Met' : `${g.status === 'paused' ? 'Paused' : 'Stopped'}${g.reason ? `: ${g.reason}` : ''}`}</span> : null}
      <GoalScore goal={g} brief />
    </div>
  );
}

/** Plan, ship and next-run approvals. Reject asks for an optional reason (the agent reworks once with it). */
function AskCard({ msg, card: c, team, onAct, onDiff }: { msg: TeamMessage; card: Extract<Card, { kind: 'approval' }>; team: TeamView; onAct: Act; onDiff: (m: TeamMessage, title: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const go = (body: { action: string; reason?: string }) => {
    setBusy(true);
    void onAct(msg, body).finally(() => (setBusy(false), setRejecting(false)));
  };
  const next = c.what === 'next';
  return (
    <div className={cn('tm-card ask', { pending: c.status === 'pending' })} role="group" aria-labelledby={id}>
      <b id={id}>{c.title}</b>
      {c.detail ? <span className={cn(c.what === 'ship' ? 'tm-mono' : 'tm-detail')}>{c.detail}</span> : null}
      {c.status !== 'pending' ? (
        <span className={cn('tm-decided', c.status)}>{`${c.status === 'approved' ? '✓ Approved' : '✕ Rejected'} by ${c.by ?? 'someone'}${c.at ? ` · ${time(c.at)}` : ''}${c.reason ? ` · ${c.reason}` : ''}`}</span>
      ) : rejecting ? (
        <form className="tm-reject" onSubmit={(e) => (e.preventDefault(), go({ action: 'reject', reason: reason.trim() || undefined }))}>
          <label htmlFor={`${id}-why`}>Why? (optional: the agent reworks it once with this)</label>
          <textarea id={`${id}-why`} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <span className="tm-row">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" loading={busy}>
              Reject
            </Button>
          </span>
        </form>
      ) : (
        <span className="tm-row">
          <span className="tm-muted tm-grow">{team.team.approvers === 'any' ? 'Any teammate can approve' : `Only ${approversLine(team.team)} can approve`}</span>
          {c.runId && c.what !== 'plan' ? (
            <Button variant="secondary" size="sm" onClick={() => onDiff(msg, c.title)}>
              Review diff
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => (next ? go({ action: 'reject' }) : setRejecting(true))}>
            {next ? 'Skip' : 'Reject'}
          </Button>
          <Button size="sm" loading={busy} onClick={() => go({ action: 'approve' })}>
            {next ? 'Start run' : 'Approve'}
          </Button>
        </span>
      )}
    </div>
  );
}

/** A run the agent suggests in an answer: Start run, Edit (the task) or Dismiss. */
function ProposalCard({ msg, card: c, onAct, onGo }: { msg: TeamMessage; card: Extract<Card, { kind: 'proposal' }>; onAct: Act; onGo: (r: Route) => void }) {
  const [edit, setEdit] = useState<string>();
  const [busy, setBusy] = useState(false);
  const go = (body: { action: string; task?: string }) => {
    setBusy(true);
    void onAct(msg, body).finally(() => setBusy(false));
  };
  return (
    <div className="tm-card" role="group" aria-label="Proposed run">
      <b>Start a run?</b>
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
        <button type="button" className="tm-link" onClick={() => onGo({ tab: 'runs', id: c.runId })}>
          {`Started ${shortRunId(c.runId)}`}
        </button>
      ) : (
        <span className="tm-muted">Dismissed</span>
      )}
    </div>
  );
}

/** The message box: Enter sends, Shift+Enter is a new line, @ suggests the team's agents (arrows, Enter or Tab, Escape). */
function Composer(p: { name: string; options: { id: string; name: string; hint?: string }[]; onSend: (text: string) => Promise<void> }) {
  const notify = useNotify();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const word = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  const q = word?.[2]?.toLowerCase();
  const matches = q === undefined ? [] : p.options.filter((o) => o.name.toLowerCase().startsWith(q) || o.id.startsWith(q));
  const open = matches.length > 0 && !closed;
  const at = Math.min(sel, Math.max(0, matches.length - 1));

  const pick = (o: { name: string }) => {
    const start = caret - (q?.length ?? 0) - 1;
    const next = `${text.slice(0, start)}@${o.name} ${text.slice(caret)}`;
    const pos = start + o.name.length + 2;
    setText(next);
    setCaret(pos);
    setSel(0);
    requestAnimationFrame(() => box.current?.setSelectionRange(pos, pos));
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
    <form className="tm-composer" onSubmit={(e) => (e.preventDefault(), void send())}>
      {open ? (
        <ul id={`${id}-list`} className="tm-suggest" role="listbox" aria-label="Mention">
          {matches.map((o, i) => (
            <li key={o.id} id={`${id}-o${i}`} role="option" aria-selected={i === at} onMouseDown={(e) => (e.preventDefault(), pick(o))}>
              <Face id={o.id} size={18} />
              <b>{o.name}</b>
              {o.hint ? <span className="tm-muted">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={id} className="sr-only">{`Message ${p.name}`}</label>
      <textarea
        ref={box}
        id={id}
        rows={1}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-o${at}` : undefined}
        placeholder={`Message #${p.name} · @ to ping an agent or a teammate`}
        value={text}
        onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart ?? e.target.value.length), setClosed(false))}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKey}
      />
      <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()} loading={busy}>
        <ArrowUp size={15} aria-hidden="true" />
      </Button>
    </form>
  );
}
