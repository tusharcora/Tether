import { useState } from 'react';
import type { Pipeline } from '../api';
import { Picker } from '../components/bencho/Picker';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { useCrew } from '../crewStore';
import { Face } from '../Face';
import { TypeTile } from '../goals/GoalNode';
import { statusWord, TYPE_LABEL, type GoalView } from '../goals/goalsApi';
import { draftOf, LimitsField, limitsBody, limitsLine, type LimitDraft } from '../goals/LimitsField';
import { NewGoalForm, type DraftFields } from '../goals/NewGoalDialog';
import { usePoll, type Route } from '../hooks';
import { TEAMS_PATH, type TeamsReply } from '../teams/teamsApi';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { shortRunId } from '../ui/studio/RunGlyph';
import { TryMore } from '../runs/TryMore';
import type { GoalDraft, Proposal } from './api';
import type { Assistant } from './useAssistant';

/** The follow-up "Just answer, no goal" sends, so Tether answers in prose instead. */
export const JUST_ANSWER = "Just answer, don't make a goal.";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The workflow as a chain of steps: a saved workflow's own steps (approvals ask the person); the team path is the agents'
 * roles, then the person's approval when it asks, then the PR. Without a team, Tether plans first.
 */
export function stepsOf(d: Pick<GoalDraft, 'workflow' | 'agents' | 'team' | 'approval'>, pipeline?: Pick<Pipeline, 'nodes'>): { label: string; ask?: boolean }[] {
  if (d.workflow !== 'team' && pipeline) return pipeline.nodes.map((n) => ({ label: n.title ?? n.role ?? n.id, ...(n.kind === 'approval' ? { ask: true } : {}) }));
  const work = d.agents.map((a) => ({ label: cap(a.role) }));
  return [...(d.team ? [] : [{ label: 'Tether plans' }]), ...(work.length ? work : [{ label: 'Work' }]), ...(d.approval === 'ask' ? [{ label: 'You approve', ask: true }] : []), { label: 'Open PR' }];
}

const CHIP: Record<Proposal['status'], string> = { proposed: 'Ready to start', started: 'Starting…', dismissed: 'No goal', failed: 'Could not start' };

/**
 * An ask that became a goal (board 1): what it is, when it is done, the team, the agents (each swappable), the workflow
 * as a chain of steps and the optional limits. Start sends the card's edits and starts it; Edit goal opens the goal form
 * on the draft; "Just answer, no goal" drops it and asks again for a plain answer. Once started it follows the goal.
 */
export function GoalCard({ proposal: p, chat, project, onGo }: { proposal: Proposal; chat: Assistant; project?: string; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const { crew } = useCrew();
  const [draft, setDraft] = useState<GoalDraft>(p.draft!);
  const [limits, setLimits] = useState<LimitDraft>(() => draftOf(p.draft?.limits));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'start' | 'dismiss'>();
  /** The run Try more ways starts from, while its picker is open. */
  const [trying, setTrying] = useState<string>();
  const open = p.status === 'proposed';
  const roster = usePoll<TeamsReply>(open ? TEAMS_PATH : null, 60_000).data;
  const workflows = usePoll<{ name: string }[]>(editing ? '/api/pipelines' : null, 60_000).data;
  const pipeline = usePoll<{ pipeline: Pipeline }>(draft.workflow !== 'team' ? `/api/pipelines/${encodeURIComponent(draft.workflow)}` : null, 300_000).data?.pipeline;
  const goal = usePoll<GoalView>(p.status === 'started' && p.goalId ? `/api/goals/${encodeURIComponent(p.goalId)}` : null, 2500).data;
  const team = roster?.teams.find((t) => t.id === draft.team);
  const nameOf = (id: string) => crew[id]?.name ?? roster?.agents.find((a) => a.id === id)?.name ?? id;
  const lastRun = goal?.items.filter((i) => i.kind === 'run' && i.runId).at(-1);

  const decide = async (d: 'start' | 'dismiss') => {
    setBusy(d);
    try {
      const next = await chat.decide(p, d, d === 'start' ? { ...draft, limits: limitsBody(limits) as GoalDraft['limits'] } : undefined);
      if (next.status === 'started') notify.ok('Goal started');
      if (d === 'dismiss') await chat.send(JUST_ANSWER);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(undefined);
    }
  };
  const swap = (from: string, to: string) => setDraft((x) => ({ ...x, agents: x.agents.map((a) => (a.id === from ? { id: to, role: a.role } : a)) }));
  const saveEdit = (f: DraftFields) => {
    setDraft((x) => ({ ...x, title: f.title, type: f.type, description: f.description, workflow: f.workflow, check: f.check, approval: f.approval }));
    setLimits(draftOf(f.limits));
    setEditing(false);
  };

  return (
    <article className="gc mt-2" aria-label={`Goal card: ${draft.title}`}>
      <header className="gc-head">
        <TypeTile type={draft.type} />
        <span className="gc-title">
          <b>{draft.title}</b>
          <span>{`${TYPE_LABEL[draft.type]} · new goal in ${project ?? 'this project'} · ${p.status === 'started' ? 'started' : 'not started'}`}</span>
        </span>
        <span className={cn('gc-chip', p.status === 'proposed' ? 'needs' : p.status === 'failed' ? 'bad' : goal?.status === 'met' ? 'ok' : 'live')}>{goal ? statusWord(goal) : CHIP[p.status]}</span>
      </header>
      <dl className="gc-rows">
        <dt>Done when</dt>
        <dd>{draft.check ? <code className="gc-mono">{draft.check.command}</code> : <span className="mut">its run is done (no check)</span>}{draft.check ? <span className="mut">{draft.check.kind === 'number' ? `reaches ${draft.check.target}` : 'passes'}</span> : null}</dd>
        <dt>Team</dt>
        <dd>{draft.team ? <span className="gc-tag">{`# ${team?.name ?? draft.team}`}</span> : <span className="mut">No team: Tether plans the run</span>}</dd>
        <dt>Agents</dt>
        <dd className="gc-agents">
          {draft.agents.length ? null : <span className="mut">Tether picks them when it plans</span>}
          {draft.agents.map((a) => (
            <span key={a.id} className="gc-agent">
              <Face id={a.id} size={24} />
              <b>{nameOf(a.id)}</b>
              <span className="mut">{[a.role, a.model, a.why].filter(Boolean).join(' · ')}</span>
              {open ? (
                <Picker
                  label={`Swap ${nameOf(a.id)}`}
                  hideLabel
                  options={(roster?.agents ?? []).filter((x) => x.id === a.id || !draft.agents.some((y) => y.id === x.id)).map((x) => ({ id: x.id, name: x.name, hint: x.specialty }))}
                  value={[a.id]}
                  onChange={(ids) => ids[0] && ids[0] !== a.id && swap(a.id, ids[0])}
                  className="gc-swap"
                  trigger={<span className="gc-swap-label">Swap</span>}
                />
              ) : null}
            </span>
          ))}
        </dd>
        <dt>Workflow</dt>
        <dd className="gc-steps">
          {stepsOf(draft, pipeline).map((s, i) => (
            <span key={`${i}:${s.label}`} className="gc-stepwrap">
              {i ? <span className="gc-arrow" aria-hidden="true">→</span> : null}
              <span className={cn('gc-step', s.ask && 'ask')}>{s.label}</span>
            </span>
          ))}
          <span className="mut gc-wf">{draft.workflow === 'team' ? (draft.team ? 'Team workflow' : 'Team run') : `"${draft.workflow}" workflow`}</span>
        </dd>
        <dt>
          Limits <span className="gc-opt">(optional)</span>
        </dt>
        <dd>{open ? <LimitsField value={limits} onChange={setLimits} approval={draft.approval} /> : <span>{limitsLine(draft.limits ?? {})}</span>}</dd>
      </dl>
      <footer className="gc-foot">
        {open ? (
          <>
            <Button size="sm" variant="primary" loading={busy === 'start'} disabled={!!busy} onClick={() => void decide('start')}>
              Start
            </Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setEditing(true)}>
              Edit goal
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'dismiss'} disabled={!!busy} onClick={() => void decide('dismiss')}>
              Just answer, no goal
            </Button>
          </>
        ) : p.status === 'failed' ? (
          <span className="gc-note">{p.note ?? 'Could not start'}</span>
        ) : p.status === 'dismissed' ? (
          <span className="mut">No goal made.</span>
        ) : lastRun ? (
          <>
            <button type="button" className="gc-link" onClick={() => onGo({ tab: 'runs', id: lastRun.runId })}>
              {`Run ${shortRunId(lastRun.runId!)}${lastRun.runStatus ? ` · ${lastRun.runStatus}` : ''}`}
            </button>
            {draft.workflow !== 'team' ? (
              <button type="button" className="gc-link" onClick={() => setTrying(lastRun.runId)}>
                Try 2 more ways
              </button>
            ) : null}
          </>
        ) : (
          <span className="mut">{goal?.status === 'active' && goal.kind === 'loop' ? 'Checking first…' : 'Starting its run…'}</span>
        )}
        {p.goalId && p.status !== 'dismissed' ? (
          <button type="button" className="gc-link gc-open" onClick={() => onGo({ tab: 'goals', id: p.goalId })}>
            Open in Goals →
          </button>
        ) : null}
      </footer>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit goal" description="Changes stay on this card until you press Start.">
          {editing ? <NewGoalForm projects={[]} workflows={(workflows ?? []).map((w) => w.name)} onCreated={() => {}} onCancel={() => setEditing(false)} draft={{ initial: { ...draft, ...(Object.keys(limitsBody(limits)).length ? { limits: limitsBody(limits) as DraftFields['limits'] } : {}) }, onSave: saveEdit }} /> : null}
        </DialogContent>
      </Dialog>
      {trying ? <TryMore runId={trying} onClose={() => setTrying(undefined)} onStarted={(set) => (setTrying(undefined), onGo({ tab: 'attempts', id: set }))} /> : null}
    </article>
  );
}
