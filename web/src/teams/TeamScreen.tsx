import { ArrowUp, Settings } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, fmtUsd, type RunView } from '../api';
import { LinkPreview } from '../components/assistant-ui/elements/link-preview';
import { SpeakerIdentity } from '../components/assistant-ui/elements/speaker-identity';
import { TeamRunCard } from '../assistant/taskCards';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { Loading } from '../components/Loading';
import { Face, TETHER_ID } from '../Face';
import { GoalScore } from '../goals/Goals';
import { goalLine, noLimits, type GoalView } from '../goals/goalsApi';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Route } from '../hooks';
import { RunGraph } from '../runs/RunGraph';
import { StepInspector } from '../runs/StepInspector';
import { useRunStream } from '../runStream';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { RunDiff } from '../ui/RunDiff';
import { FaceStack } from '../ui/studio/FaceStack';
import { InlineError } from '../ui/studio/InlineError';
import { shortRunId } from '../ui/studio/RunGlyph';
import { TeamForm } from './NewTeam';
import { focusOn, handoffEdges, roomCounts, runOf, stripItems, type Who } from './roomModel';
import { approversLine, PLACE, teamsApi, type Card, type TeamMessage, type TeamsReply, type TeamView } from './teamsApi';
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

/** People and agents as nodes in a ring, hand-offs of the last week as lines (thicker for more); a node focuses the chat on them. */
function WholeTeam({ who, edges, focus, onFocus }: { who: Who[]; edges: { from: string; to: string; n: number }[]; focus?: string; onFocus: (w: Who) => void }) {
  const W = 820;
  const H = 460;
  const R = Math.min(W, H) / 2 - 70;
  const at = new Map(who.map((w, i) => [w.id, { x: W / 2 + R * Math.cos((2 * Math.PI * i) / who.length - Math.PI / 2), y: H / 2 + R * Math.sin((2 * Math.PI * i) / who.length - Math.PI / 2) }]));
  const count = (id: string) => edges.filter((e) => e.from === id || e.to === id).reduce((a, e) => a + e.n, 0);
  return (
    <div className="tr-whole">
      <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {edges.map((e) => {
          const a = at.get(e.from)!;
          const b = at.get(e.to)!;
          return <line key={`${e.from}>${e.to}`} className="tr-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1 + Math.min(e.n, 6)} />;
        })}
      </svg>
      {who.map((w) => {
        const pos = at.get(w.id)!;
        const n = count(w.id);
        return (
          <button key={w.id} type="button" className="tr-who" style={{ left: `${(pos.x / W) * 100}%`, top: `${(pos.y / H) * 100}%` }} aria-pressed={focus === w.id} aria-label={`${w.name}: focus the chat on them`} onClick={() => onFocus(w)}>
            {w.kind === 'agent' ? <Face id={w.id} size={24} /> : <span className="tm-avatar small">{w.name.charAt(0).toUpperCase()}</span>}
            <span>
              {w.name}
              <small>{n ? `${n} hand-off${n === 1 ? '' : 's'} this week` : 'no hand-offs this week'}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const SEG: Record<string, string> = { done: 'done', running: 'working', awaiting: 'waiting', error: 'failed' };

/**
 * A team's room (board 2): the header with its live runs, what needs you and today's spend; the map (This run: the picked
 * run's steps from you to your approval, a step opening in the inspector; Whole team: who hands work to whom, a member
 * focusing the chat) with zoom, the runs strip under it (team runs and loops; the live one by default), and the channel.
 * Polled: cards are edited in place on the server, so a poll shows progress and decisions as they happen.
 */
export function TeamScreen(p: { id: string; goals?: GoalView[]; agents: TeamsReply['agents']; projects: WorkspaceRow[]; onGo: (r: Route) => void; onChanged: () => void; onNewAgent: () => void }) {
  const notify = useNotify();
  const view = usePoll<TeamView>(`/api/teams/${encodeURIComponent(p.id)}`, VIEW_MS);
  const [settings, setSettings] = useState(false);
  const [diff, setDiff] = useState<{ title: string; text?: string }>();
  const [mapView, setMapView] = useState<'run' | 'team'>('run');
  const [pick, setPick] = useState<string>();
  const [pickRun, setPickRun] = useState<string>();
  const [focus, setFocus] = useState<Who>();
  const [step, setStep] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const end = useRef<HTMLLIElement>(null);
  const v = view.data;
  const count = v?.messages.length ?? 0;
  const items = stripItems({ messages: v?.messages ?? [] }, p.goals);
  const item = items.find((x) => x.id === pick) ?? items[0];
  const runId = pickRun ?? runOf(item);
  const stream = useRunStream(mapView === 'run' ? runId : undefined);
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
  /** A team run opens here, in the room: the map follows it. */
  const openRun = (id: string) => (setPickRun(id), setMapView('run'), setStep(undefined));
  const runAct = async (path: string, body: unknown = {}) => {
    try {
      stream.setRun(await api<RunView>('POST', `/api/runs/${runId}/${path}`, body));
      refresh();
      return true;
    } catch (e) {
      notify.fail(e);
      return false;
    }
  };
  const who: Who[] = [...t.people.map((x) => ({ id: x.id, name: x.name, kind: 'person' as const })), ...v.members.map((m) => ({ id: m.id, name: m.name, kind: 'agent' as const }))];
  const counts = roomCounts(v, p.goals);
  const run = stream.run;
  const done = run ? run.pipeline.nodes.filter((n) => run.nodes[n.id]?.status === 'done').length : 0;
  const shown = focus ? focusOn(v.messages, focus) : v.messages;
  const itemAt = item?.at ?? Date.now();

  return (
    <div className="tm">
      <header className="tm-head">
        <h1>
          <span aria-hidden="true">#</span> {t.name}
        </h1>
        <span className="tm-sub">{`${PLACE[t.place]} team · you + ${t.agents.length} agent${t.agents.length === 1 ? '' : 's'} · ${p.projects.find((w) => w.id === t.project)?.name ?? t.project} · ${t.approvers === 'any' ? 'any of you can approve' : `${approversLine(t)} can approve`}`}</span>
        <span className="tm-gap" />
        {counts.live ? <span className="tr-chip live">{`${counts.live} live run${counts.live === 1 ? '' : 's'}`}</span> : null}
        {counts.needs ? <span className="tr-chip needs">{`${counts.needs} needs you`}</span> : null}
        <span className="tm-sub">{`${fmtUsd(v.spend.usd)} of ${fmtUsd(t.limits.usdPerDay)} today`}</span>
        <FaceStack bots={t.agents} size={22} />
        <Button variant="secondary" size="sm" onClick={() => setSettings(true)}>
          Add member
        </Button>
        <Button variant="secondary" size="icon" aria-label="Team settings" onClick={() => setSettings(true)}>
          <Settings size={15} aria-hidden="true" />
        </Button>
      </header>
      <div className="tm-body tr">
        <section className="tr-map" aria-label="Team map">
          <div className="tr-bar">
            <div className="tr-tabs" role="tablist" aria-label="Map view">
              <button type="button" role="tab" aria-selected={mapView === 'run'} onClick={() => setMapView('run')}>
                This run
              </button>
              <button type="button" role="tab" aria-selected={mapView === 'team'} onClick={() => setMapView('team')}>
                Whole team
              </button>
            </div>
            {mapView === 'run' && run ? <span className="tm-sub">{`${run.task.split('\n')[0]!.slice(0, 80)}${run.pipeline.nodes.length ? ` · step ${Math.min(done + 1, run.pipeline.nodes.length)} of ${run.pipeline.nodes.length}` : ''}`}</span> : null}
            <span className="tr-hint">{mapView === 'team' ? 'Click someone to focus the chat on them' : 'Click a step to see what it did'}</span>
          </div>
          <div className="tr-canvas">
            {mapView === 'team' ? (
              <WholeTeam who={who} edges={handoffEdges(v.messages, who)} focus={focus?.id} onFocus={setFocus} />
            ) : run && run.pipeline.nodes.length ? (
              <RunGraph run={run} you={`asked ${time(itemAt)}`} zoom={zoom} selected={step} onSelect={setStep} />
            ) : (
              <p className="tm-muted tr-empty">{runId ? (run ? 'Tether is planning this run…' : 'Loading the run…') : 'No runs yet. @mention an agent in the chat to hand it work.'}</p>
            )}
            {mapView === 'run' && run?.pipeline.nodes.length ? (
              <div className="tr-zoom" role="group" aria-label="Zoom">
                <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                  −
                </Button>
                <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.25))}>
                  +
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
                  Fit
                </Button>
              </div>
            ) : null}
          </div>
          <div className="tr-strip">
            <div className="tr-strip-head">
              <b>{`Runs in # ${t.name}`}</b>
              <span>switch the map between them</span>
              <button type="button" className="tm-link" onClick={() => p.onGo({ tab: 'runs' })}>
                All runs
              </button>
            </div>
            <div className="tr-cards">
              {items.length ? null : <span className="tm-muted">None yet.</span>}
              {items.map((x) => (
                <button key={x.id} type="button" className="tr-card" aria-pressed={!pickRun && item?.id === x.id} onClick={() => (setPick(x.id), setPickRun(undefined), setMapView('run'), setStep(undefined))}>
                  <span className="tr-card-top">
                    <span className={cn('tm-dot', { live: x.kind === 'run' ? x.card.status === 'running' : x.goal?.status === 'active' })} aria-hidden="true" />
                    <b>{x.title}</b>
                    {x.kind === 'loop' ? <span className="tm-muted">loop</span> : x.pr ? <span className="tm-muted">{`PR #${x.pr.number}`}</span> : null}
                  </span>
                  {x.kind === 'run' ? (
                    x.card.steps.length ? (
                      <span className="rl-track" aria-label={`${x.card.steps.filter((s) => s.status === 'done').length} of ${x.card.steps.length} steps done`} role="img">
                        {x.card.steps.map((s) => (
                          <span key={s.id} className={cn('rl-seg', `s-${SEG[s.status] ?? 'queued'}`)} />
                        ))}
                      </span>
                    ) : (
                      <span className="tm-muted">{x.pr ? (x.pr.merged ? `merged · ${fmtUsd(x.card.costUsd)}` : `PR open · ${fmtUsd(x.card.costUsd)}`) : x.card.status}</span>
                    )
                  ) : (
                    <span className="tm-muted">{x.goal ? goalLine(x.goal) : 'starting'}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="tm-channel" aria-label="Team chat">
          {focus ? (
            <div className="tr-focus" role="status">
              {`Showing ${focus.name}`} ·{' '}
              <button type="button" className="tm-link" onClick={() => setFocus(undefined)}>
                Show all
              </button>
            </div>
          ) : null}
          <ol className="tm-msgs" aria-label="Messages" aria-live="polite">
            {shown.length ? null : <li className="tm-empty">{focus ? `Nothing from or to ${focus.name} yet.` : 'Say hello, or @mention an agent to hand it a question, a task or a loop.'}</li>}
            {shown.map((m) => (
              <li key={m.id} className="tm-msg who">
                {/* who spoke, from the element; the body below keeps its mentions and cards (the element's text is plain) */}
                <SpeakerIdentity turns={[{ id: m.id, kind: SPEAKER[m.from.kind], name: m.from.name, detail: [m.from.kind === 'agent' ? `agent${specialty(m.from.id) ? ` · ${specialty(m.from.id)}` : ''}` : '', time(m.at)].filter(Boolean).join(' · '), text: '', avatar: m.from.kind === 'person' ? undefined : <Face id={m.from.kind === 'tether' ? TETHER_ID : m.from.id} size={24} label="" /> }]} />
                <div className="tm-msg-main">
                  <p className={cn('tm-text', { pending: !!m.pending })} aria-busy={m.pending || undefined}>
                    {withMentions(m.text, names)}
                  </p>
                  {m.card ? <CardView msg={m} card={m.card} team={v} goals={p.goals} onGo={p.onGo} onAct={act} onDiff={showDiff} onRun={openRun} /> : null}
                </div>
              </li>
            ))}
            <li ref={end} aria-hidden="true" />
          </ol>
          <Composer name={t.name} options={v.members.map((m) => ({ id: m.id, name: m.name, hint: m.specialty }))} onSend={(text) => teamsApi.post(t.id, text).then(refresh)} />
        </section>
      </div>

      <AnimatePresence>{step && run ? <StepInspector key="insp" run={run} events={stream.events} target={{ mode: 'step', node: step }} onTarget={(x) => x.mode === 'step' && setStep(x.node)} onClose={() => setStep(undefined)} onAct={runAct} /> : null}</AnimatePresence>
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

function CardView(p: { msg: TeamMessage; card: Card; team: TeamView; goals?: GoalView[]; onGo: (r: Route) => void; onAct: Act; onDiff: (m: TeamMessage, title: string) => void; onRun: (runId: string) => void }) {
  const c = p.card;
  if (c.kind === 'run') return <TeamRunCard card={c} onOpen={() => p.onRun(c.runId)} />;
  if (c.kind === 'loop') return <LoopCard goal={p.goals?.find((g) => g.id === c.goalId)} onRun={p.onRun} />;
  if (c.kind === 'approval') return <AskCard msg={p.msg} card={c} team={p.team} onAct={p.onAct} onDiff={p.onDiff} />;
  if (c.kind === 'proposal') return <ProposalCard msg={p.msg} card={c} onAct={p.onAct} onRun={p.onRun} />;
  // no unfurl: the link and what the PR card already knows
  return <LinkPreview layout="compact" href={c.url} title={`PR #${c.number} · ${c.title}`} description={c.merged ? 'merged' : 'open'} />;
}

/** A loop: its live state, spend against its limits, and the chain of runs leading to its check. */
function LoopCard({ goal: g, onRun }: { goal?: GoalView; onRun: (runId: string) => void }) {
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
            <button type="button" className={cn('tm-chip', i.attempt?.after ? (i.attempt.after.ok ? 'done' : 'idle') : 'live')} onClick={() => i.runId && onRun(i.runId)}>
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
function ProposalCard({ msg, card: c, onAct, onRun }: { msg: TeamMessage; card: Extract<Card, { kind: 'proposal' }>; onAct: Act; onRun: (runId: string) => void }) {
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
        <button type="button" className="tm-link" onClick={() => onRun(c.runId!)}>
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
