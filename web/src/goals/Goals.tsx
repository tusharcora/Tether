import { ArrowLeft, Copy, Link2, ListPlus, Settings } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, fmtUsd } from '../api';
import { ScoreBreakdown } from '../components/assistant-ui/elements/score-breakdown';
import { Timeline } from '../components/assistant-ui/elements/timeline';
import type { NodeAction } from '../components/bencho/ActionNode';
import { CreateMenu } from '../components/bencho/CreateMenu';
import { Button, buttonClass } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import { Textarea } from '../components/kept/textarea/textarea';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { WorkspaceRow } from '../home/workspaces';
import { hashFor, usePoll, type Route } from '../hooks';
import type { TeamsReply } from '../teams/teamsApi';
import { RunDiff } from '../ui/RunDiff';
import { useNotify } from '../ui/notify';
import { QuietLine, Section } from '../ui/studio/Section';
import { StatusBadge, type Tone } from '../ui/studio/StatusBadge';
import { Dock, FloatBar, ToolScreen } from '../ui/studio/ToolFrame';
import { useCreateIntent } from '../ui/useCreateIntent';
import { cn } from '../ui/cn';
import { AssigneePicker } from './AssigneePicker';
import { Avatars, Roster, useWho } from './Avatars';
import { endOf, GoalNode, sections, TypeTile } from './GoalNode';
import { LimitsField, draftOf, limitsBody, type LimitDraft } from './LimitsField';
import { copyOf, goalEvents, goalScore, goalsApi, inProject, isOpen, noLimits, STATUS_LABEL, TYPE_GLYPH, TYPE_LABEL, typeOf, type Assignee, type GoalType, type GoalView } from './goalsApi';
import { LoopFlow } from './LoopFlow';
import { CheckDialog, NewGoalForm, TypeField } from './NewGoalDialog';
import { Tracker } from './Tracker';
import './goals.css';

export { ApproveButton } from './GoalNode';

const TONE: Record<GoalView['status'], Tone> = { active: 'live', needs_you: 'needs', paused: 'neutral', met: 'done', stopped: 'failed' };
const pct = (n: number, of: number) => (of ? Math.min(100, Math.round((n / of) * 100)) : 0);
/** "Nov 30": a list row's due date or the day a goal finished. */
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dueDay = (d: string) => {
  const [y, m, n] = d.split('-').map(Number);
  return day(new Date(y!, m! - 1, n).getTime());
};

/** A goal's status badge: an open tracker reads Open; a working loop pulses. */
const Badge = ({ g }: { g: GoalView }) =>
  g.kind === 'tracker' && g.status === 'active' ? <StatusBadge tone="neutral" label="Open" /> : <StatusBadge tone={TONE[g.status]} label={STATUS_LABEL[g.status]} pulse={g.status === 'active' && g.kind === 'loop'} />;

/** A 3 px bar: a limit. */
const Bar = (p: { label: string; value: number; met?: boolean }) => (
  <span className="goal-bar" role="progressbar" aria-label={p.label} aria-valuenow={p.value} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${p.value}%` }} className={cn({ met: !!p.met })} />
  </span>
);

export interface GoalsProps {
  goals: ReturnType<typeof import('./goalsApi').useGoals>;
  projects: WorkspaceRow[];
  project?: WorkspaceRow;
  selected?: string;
  onSelect: (id?: string) => void;
  onGo: (r: Route) => void;
  /** The Create menu or ⌘K asked for a new goal (a counter). */
  create?: number;
  /** The teams and agents a goal can be assigned to. */
  teams?: TeamsReply;
}

const NEW_GOAL = (Object.keys(TYPE_LABEL) as GoalType[]).map((t) => ({ id: t, label: TYPE_LABEL[t], icon: <span className={`gn-glyph t-${t}`}>{TYPE_GLYPH[t]}</span> }));

/** A goal's score from its real factors; `brief`: the total and verdict alone (a list row, a team card). */
export function GoalScore({ goal, brief }: { goal: GoalView; brief?: boolean }) {
  const s = goalScore(goal);
  return <ScoreBreakdown className={cn('goal-score', { brief: !!brief })} verdict={s.verdict} total={s.total} outOf={s.outOf} criteria={s.criteria} visibleCount={brief ? 0 : s.criteria.length} />;
}

/** A row in Up next or Done; under the pointer it opens into the full goal node, pushing the rows below it down. */
function GoalRow(p: { goal: GoalView; note: string; node: (g: GoalView) => ReactNode; onOpen: () => void }) {
  const [big, setBig] = useState(false);
  const g = p.goal;
  return (
    <li className="gr" onPointerEnter={() => setBig(true)} onPointerLeave={() => setBig(false)}>
      {big ? (
        p.node(g)
      ) : (
        <div className="gr-row">
          <TypeTile type={g.type} />
          <button type="button" className="gr-open" onClick={p.onOpen}>
            {g.title}
          </button>
          <Avatars who={g.assignees ?? []} size={22} />
          <span className="gr-note">{p.note}</span>
        </div>
      )}
    </li>
  );
}

/**
 * Goals (`#/goals`, board F): Now is a grid of equal goal nodes, each with what happens next under it; Up next (paused) and
 * Done (met or stopped) are two quiet lists. A node or row opens the goal's page (`#/goals/<id>`); settings and new goal dock right.
 */
export function Goals(p: GoalsProps) {
  const notify = useNotify();
  const { goals, error, set, drop } = p.goals;
  const [dock, setDock] = useState<{ kind: 'settings'; id: string } | { kind: 'new'; type?: GoalType }>();
  /** A tracker opened from its arc's Add a step: its add field takes focus. */
  const [addFor, setAddFor] = useState<string>();
  const flows = usePoll<{ name: string }[]>(dock?.kind === 'new' ? '/api/pipelines' : null, 60_000);
  useCreateIntent(p.create, true, () => setDock({ kind: 'new' }));

  const mine = inProject(goals, p.project?.id);
  const open = mine.find((g) => g.id === p.selected);
  const parts = sections(mine);
  const editing = dock?.kind === 'settings' ? mine.find((g) => g.id === dock.id) : undefined;
  const closeDock = () => setDock(undefined);
  const duplicate = (g: GoalView) => void goalsApi.create(copyOf(g)).then((c) => (set(c), notify.ok('Goal duplicated')), notify.fail);
  const arc = (g: GoalView): NodeAction[] => [
    { id: 'link', label: 'Copy link', icon: <Link2 />, onSelect: () => void navigator.clipboard?.writeText(new URL(hashFor({ tab: 'goals', id: g.id }), location.href).href).then(() => notify.ok('Link copied'), notify.fail) },
    ...(g.kind === 'tracker' ? [{ id: 'step', label: 'Add a step', icon: <ListPlus />, onSelect: () => (setAddFor(g.id), p.onSelect(g.id)) }] : []),
    { id: 'dup', label: 'Duplicate', icon: <Copy />, onSelect: () => duplicate(g) },
    { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: () => setDock({ kind: 'settings', id: g.id }) },
  ];
  const node = (g: GoalView) => <GoalNode key={g.id} goal={g} onOpen={() => p.onSelect(g.id)} actions={arc(g)} onDone={set} onWatch={(id) => p.onGo({ tab: 'runs', id })} />;
  const list = (rows: GoalView[], note: (g: GoalView) => string, empty: string) =>
    rows.length ? (
      <ul className="gr-list">
        {rows.map((g) => (
          <GoalRow key={g.id} goal={g} note={note(g)} node={node} onOpen={() => p.onSelect(g.id)} />
        ))}
      </ul>
    ) : (
      <QuietLine>{empty}</QuietLine>
    );
  const newGoal = (
    <CreateMenu label="+ New goal" title="New goal" className={buttonClass()} items={NEW_GOAL} onSelect={(t) => setDock({ kind: 'new', type: t as GoalType })}>
      + New goal
    </CreateMenu>
  );

  return (
    <Roster.Provider value={p.teams}>
      <ToolScreen className={cn('gl-screen', { docked: !!dock })}>
        {open ? (
          <Detail key={open.id} goal={open} set={set} onBack={() => p.onSelect()} onSettings={() => setDock({ kind: 'settings', id: open.id })} onGo={p.onGo} newGoal={newGoal} duplicate={() => duplicate(open)} focusAdd={addFor === open.id} />
        ) : (
          <div className="gl-page">
            <header className="gl-pagehead">
              <h1>Goals</h1>
              {p.project ? <span className="gl-proj">{p.project.name}</span> : null}
              <span className="gl-head-act">{newGoal}</span>
            </header>
            {error && !goals ? (
              <p className="sl-alert" role="alert">
                Could not load goals: {error}
              </p>
            ) : null}
            {goals ? (
              <>
                <Section title="Now" count={parts.now.length || undefined}>
                  {parts.now.length ? <div className="gn-grid">{parts.now.map(node)}</div> : <QuietLine>{mine.length ? 'Nothing in progress.' : 'No goals yet. A goal is an outcome Tether works toward: a loop that re-runs a check until it passes, or a checklist you tick off.'}</QuietLine>}
                </Section>
                <div className="gl-lists">
                  <Section title="Up next" count={parts.next.length || undefined}>
                    {list(parts.next, (g) => (g.dueDate ? `Due ${dueDay(g.dueDate)}` : 'unscheduled'), 'Nothing paused.')}
                  </Section>
                  <Section title="Done" count={parts.done.length || undefined}>
                    {list(parts.done, (g) => day(endOf(g)), 'Nothing finished yet.')}
                  </Section>
                </div>
              </>
            ) : null}
          </div>
        )}
        {editing ? (
          <Dock label="Goal settings" head={<h2 className="gl-dock-title">Goal settings</h2>} onClose={closeDock}>
            <GoalSettings key={editing.id} goal={editing} onClose={closeDock} onSaved={set} onDeleted={() => (closeDock(), drop(editing.id), p.onSelect())} />
          </Dock>
        ) : dock?.kind === 'new' ? (
          <Dock label="New goal" head={<h2 className="gl-dock-title">New goal</h2>} onClose={closeDock}>
            <NewGoalForm
              key={dock.type}
              type={dock.type}
              projects={p.projects}
              current={p.project?.id}
              workflows={(flows.data ?? []).map((f) => f.name)}
              onCancel={closeDock}
              onCreated={(g) => (closeDock(), set(g), p.onSelect(g.id), notify.ok(`Goal created: ${g.title}`))}
            />
          </Dock>
        ) : null}
      </ToolScreen>
    </Roster.Provider>
  );
}

/** The open goal: its title bar, its actions, the canvas and (for a loop) the limits bar. */
function Detail({ goal: g, set, onBack, onSettings, onGo, newGoal, duplicate, focusAdd }: { goal: GoalView; set: (g: GoalView) => void; onBack: () => void; onSettings: () => void; onGo: (r: Route) => void; newGoal: ReactNode; duplicate: () => void; focusAdd: boolean }) {
  const notify = useNotify();
  const [checking, setChecking] = useState(false);
  const [diffRun, setDiffRun] = useState<string>();
  const [toLoop, setToLoop] = useState(false);
  /** Run an action and adopt the goal it returns; a refusal is shown as a toast. */
  const run = async (f: () => Promise<GoalView | unknown>) => {
    try {
      const r = (await f()) as GoalView | undefined;
      if (r && 'items' in r) set(r);
    } catch (e) {
      notify.fail(e);
    }
  };
  const runs = g.items.filter((i) => i.kind === 'run').length;
  const loop = g.kind === 'loop';
  const whoIs = useWho();
  // the Owner (set by team chat) runs the work; read-only here
  const owner: Assignee[] = [...(g.agent ? [{ kind: 'agent' as const, id: g.agent }] : []), ...(g.team ? [{ kind: 'team' as const, id: g.team }] : [])];
  /** Set who works on a step, then take the goal as it now stands. */
  const assign = (item: number, who: Assignee[]) => void run(async () => (await goalsApi.assignItem(g.id, item, who), api<GoalView>('GET', `/api/goals/${g.id}`)));

  return (
    <>
      <FloatBar at="left" className="gl-titlebar">
        <Button size="sm" variant="ghost" aria-label="Back to goals" title="Goals" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
        </Button>
        <TypeTile type={g.type} />
        <h2 className="gl-title">{g.title}</h2>
        <Badge g={g} />
        {owner.length ? (
          <span className="gl-owner" role="group" aria-label="Owner">
            <span className="gl-owner-k">Owner</span>
            <Avatars who={owner} size={22} />
            <span className="gl-owner-name">{owner.map((a) => whoIs(a).name).join(' · ')}</span>
          </span>
        ) : null}
        <AssigneePicker compact value={g.assignees ?? []} onChange={(v) => void run(() => goalsApi.patch(g.id, { assignees: v }))} />
        <span className="gl-kind">
          {loop ? `Outcome loop · ${g.workflow === 'team' ? 'Team' : `Workflow ${g.workflow}`}` : 'Tracker'}
          {g.status === 'met' ? ` · ${fmtUsd(g.spentUsd)} · ${runs} ${runs === 1 ? 'run' : 'runs'}` : ''}
        </span>
      </FloatBar>
      <FloatBar at="right">
        <div className="gl-acts" role="group" aria-label="Goal actions">
          {g.status === 'paused' && !g.startedAt ? (
            <Button size="sm" variant="primary" onClick={() => void run(() => goalsApi.start(g.id))}>
              Start
            </Button>
          ) : loop && g.status !== 'met' && g.status !== 'stopped' ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void run(() => goalsApi.patch(g.id, { status: g.status === 'paused' ? 'active' : 'paused' }))}>
                {g.status === 'paused' ? 'Resume goal' : 'Pause goal'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void run(() => goalsApi.patch(g.id, { status: 'stopped' }))}>
                Stop
              </Button>
            </>
          ) : null}
          {loop ? null : (
            <Button size="sm" variant="secondary" onClick={() => setToLoop(true)}>
              Turn into a loop
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onSettings}>
            Settings
          </Button>
          {loop && g.pending ? (
            <Button size="sm" variant="secondary" onClick={duplicate}>
              Duplicate
            </Button>
          ) : null}
          {newGoal}
        </div>
      </FloatBar>
      <div className={cn('gl-canvas', { loop })}>
        {g.reason && g.status === 'stopped' ? <p className="sl-note">{g.reason}</p> : null}
        {loop ? (
          <LoopFlow
            goal={g}
            checking={checking}
            act={{
              runCheck: () => {
                setChecking(true);
                void run(() => goalsApi.check(g.id)).finally(() => setChecking(false));
              },
              saveCommand: (command) => g.check && void run(() => goalsApi.patch(g.id, { check: { ...g.check, command } })),
              settings: onSettings,
              openRun: (id) => onGo({ tab: 'runs', id }),
              retry: (id) => void run(() => api('POST', `/api/runs/${id}/resume`, { retryFailed: true }).then(() => notify.ok('Retrying the run'))),
              diff: setDiffRun,
              start: (plan) => void run(() => goalsApi.next(g.id, 'start', plan)),
              skip: () => void run(() => goalsApi.next(g.id, 'skip')),
              duplicate,
              assign,
            }}
          />
        ) : (
          <Tracker
            goal={g}
            focusAdd={focusAdd}
            onAssign={assign}
            onGo={onGo}
            onToggle={(item, done) => void run(async () => (await goalsApi.toggleItem(g.id, item, done), api<GoalView>('GET', `/api/goals/${g.id}`)))}
            onAdd={(text) => void run(async () => (await goalsApi.addItem(g.id, text), api<GoalView>('GET', `/api/goals/${g.id}`)))}
          />
        )}
        <GoalScore goal={g} />
        {loop ? <Timeline events={goalEvents(g)} visibleCount={Infinity} /> : null}
      </div>
      {loop ? (
        <FloatBar at="bottom" className="gl-limits">
          <div className="gl-limits-in" role="group" aria-label="Limits">
            {g.budgetUsd !== undefined ? (
              <div className="gl-limit">
                <span className="gl-limit-top">
                  Budget
                  <b className="mono">
                    {fmtUsd(g.spentUsd)} of {fmtUsd(g.budgetUsd)}
                  </b>
                </span>
                <Bar label="Budget used" value={pct(g.spentUsd, g.budgetUsd)} />
              </div>
            ) : null}
            {g.maxRuns !== undefined ? (
              <div className="gl-limit">
                <span className="gl-limit-top">
                  Runs
                  <b className="mono">
                    {runs} of {g.maxRuns}
                  </b>
                </span>
                <Bar label="Runs used" value={pct(runs, g.maxRuns)} />
              </div>
            ) : null}
            {noLimits(g) ? <span className="gl-limit-top mono">{`No limits · ${fmtUsd(g.spentUsd)} spent · ${runs} ${runs === 1 ? 'run' : 'runs'}`}</span> : g.maxMinutes !== undefined ? <span className="gl-limit-top mono">{`Time limit ${g.maxMinutes} min`}</span> : null}
            <SegmentedControl label="Approval" options={[{ value: 'ask', label: 'Ask each run' }, { value: 'auto', label: 'Auto' }]} value={g.approval} onValueChange={(v) => void run(() => goalsApi.patch(g.id, { approval: v }))} />
          </div>
        </FloatBar>
      ) : null}
      <DiffDialog run={diffRun} onClose={() => setDiffRun(undefined)} />
      <CheckDialog goal={toLoop ? g : undefined} onClose={() => setToLoop(false)} onDone={set} />
    </>
  );
}

/** Budget, runs and due date, in the dock; Delete is here, behind its own question. */
function GoalSettings(p: { goal: GoalView; onClose: () => void; onSaved: (g: GoalView) => void; onDeleted: () => void }) {
  const notify = useNotify();
  const [limits, setLimits] = useState<LimitDraft>(() => draftOf(p.goal));
  const [due, setDue] = useState(p.goal.dueDate ?? '');
  const [type, setType] = useState<GoalType>(typeOf(p.goal));
  const [desc, setDesc] = useState(p.goal.description ?? '');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const loop = p.goal.kind === 'loop';
  if (asking)
    return (
      <div className="gd">
        <p className="gd-ask">
          <strong>{`Delete ${p.goal.title}?`}</strong>
          <span className="mut">The goal and its checklist go. Its runs stay in Runs.</span>
        </p>
        <div className="row end">
          <Button variant="secondary" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await goalsApi.remove(p.goal.id);
                p.onDeleted();
              } catch (e) {
                notify.fail(e);
              }
            }}
          >
            Delete goal
          </Button>
        </div>
      </div>
    );
  return (
    <form
      className="gd"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          p.onSaved(
            await goalsApi.patch(p.goal.id, {
              ...limitsBody(limits, true),
              dueDate: due || null,
              ...(type !== typeOf(p.goal) ? { type } : {}),
              ...(desc.trim() !== (p.goal.description ?? '') ? { description: desc.trim() } : {}),
            }),
          );
          p.onClose();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <TypeField value={type} onChange={setType} />
      <Textarea label="Description" rows={3} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <LimitsField value={limits} onChange={setLimits} approval={p.goal.approval} />
      <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      {error ? (
        <p className="sl-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row between">
        <Button type="button" variant="danger" onClick={() => setAsking(true)}>
          Delete goal…
        </Button>
        <span className="row">
          <Button type="button" variant="secondary" onClick={p.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </span>
      </div>
    </form>
  );
}

/** What a run changed: the run's own diff, the same as its page shows. */
export function DiffDialog(p: { run?: string; onClose: () => void }) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setText(undefined);
    setError(undefined);
    if (!p.run) return;
    let live = true;
    api<{ diff: string }>('GET', `/api/runs/${p.run}/diff`).then((r) => live && setText(r.diff), (e) => live && setError((e as Error).message));
    return () => void (live = false);
  }, [p.run]);
  return (
    <Dialog open={!!p.run} onOpenChange={(o) => !o && p.onClose()}>
      {p.run ? (
        <DialogContent title={`Changes in ${p.run}`} className="max-w-[48rem]">
          {error ? <p className="sl-alert">{error}</p> : text === undefined ? <p className="mut">Loading…</p> : text ? <RunDiff text={text} /> : <p className="mut">This run changed no files.</p>}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
