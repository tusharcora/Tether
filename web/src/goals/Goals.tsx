import { useEffect, useState, type ReactNode } from 'react';
import { api, fmtUsd } from '../api';
import { ScoreBreakdown } from '../components/assistant-ui/elements/score-breakdown';
import { Timeline } from '../components/assistant-ui/elements/timeline';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Route } from '../hooks';
import { RunDiff } from '../ui/RunDiff';
import { useNotify } from '../ui/notify';
import { ListRow } from '../ui/studio/ListRow';
import { QuietLine } from '../ui/studio/Section';
import { StatusBadge, type Tone } from '../ui/studio/StatusBadge';
import { Dock, FloatBar, ToolScreen } from '../ui/studio/ToolFrame';
import { useCreateIntent } from '../ui/useCreateIntent';
import { cn } from '../ui/cn';
import { goalEvents, goalLine, goalScore, goalsApi, inProject, isOpen, STATUS_LABEL, type GoalView } from './goalsApi';
import { LoopFlow } from './LoopFlow';
import { CheckDialog, NewGoalForm } from './NewGoalDialog';
import { Tracker } from './Tracker';
import './goals.css';

type Filter = 'all' | 'active' | 'met';
const TONE: Record<GoalView['status'], Tone> = { active: 'live', needs_you: 'needs', paused: 'neutral', met: 'done', stopped: 'failed' };
const pct = (n: number, of: number) => (of ? Math.min(100, Math.round((n / of) * 100)) : 0);

/** A goal's status badge: an open tracker reads Open; a working loop pulses. */
const Badge = ({ g }: { g: GoalView }) =>
  g.kind === 'tracker' && g.status === 'active' ? <StatusBadge tone="neutral" label="Open" /> : <StatusBadge tone={TONE[g.status]} label={STATUS_LABEL[g.status]} pulse={g.status === 'active' && g.kind === 'loop'} />;

/** A 3 px bar: a row's progress, a limit. */
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
}

/** A goal's score from its real factors; `brief`: the total and verdict alone (a list row, a team card). */
export function GoalScore({ goal, brief }: { goal: GoalView; brief?: boolean }) {
  const s = goalScore(goal);
  return <ScoreBreakdown className={cn('goal-score', { brief: !!brief })} verdict={s.verdict} total={s.total} outOf={s.outOf} criteria={s.criteria} visibleCount={brief ? 0 : s.criteria.length} />;
}

/** A visible approval: an amber button, since the run waits for the person. */
export function ApproveButton(p: { goal: GoalView; onDone: (g: GoalView) => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="goal-approve"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          p.onDone(await goalsApi.next(p.goal.id, 'start'));
        } catch (err) {
          notify.fail(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      Approve run
    </button>
  );
}

/**
 * Goals (`#/goals`) in the tool frame: the rows dock on the left; the open goal's title and actions float at the top, a
 * loop's flow (or a tracker's checklist) sits on the canvas, a loop's limits float at the bottom; settings and new goal dock right.
 */
export function Goals(p: GoalsProps) {
  const notify = useNotify();
  const { goals, error, set, drop } = p.goals;
  const [filter, setFilter] = useState<Filter>('all');
  const [dock, setDock] = useState<'settings' | 'new'>();
  const flows = usePoll<{ name: string }[]>(dock === 'new' ? '/api/pipelines' : null, 60_000);
  useCreateIntent(p.create, true, () => setDock('new'));

  const mine = inProject(goals, p.project?.id);
  const shown = mine.filter((g) => (filter === 'all' ? true : filter === 'met' ? g.status === 'met' : isOpen(g)));
  // nothing picked (or an id not in the list): the first listed goal shows, with no route change, so Back still works
  const open = mine.find((g) => g.id === p.selected) ?? shown[0];
  const tabs = [
    { value: 'all', label: 'All', accessory: mine.length },
    { value: 'active', label: 'Active', accessory: mine.filter(isOpen).length },
    { value: 'met', label: 'Met', accessory: mine.filter((g) => g.status === 'met').length },
  ];
  const closeDock = () => setDock(undefined);
  const newGoal = (
    <Button size="sm" variant="primary" onClick={() => setDock('new')}>
      + New goal
    </Button>
  );

  return (
    <ToolScreen className={cn('gl-screen', { docked: !!dock })}>
      <aside className="gl-list" aria-label="Goals">
        <div className="gl-head">
          <h1>Goals</h1>
          <SegmentedControl label="Show goals" options={tabs.map((t) => ({ value: t.value, label: t.label, accessory: <span className="mut">{t.accessory}</span> }))} value={filter} onValueChange={(v) => setFilter(v as Filter)} />
        </div>
        {error && !goals ? (
          <p className="sl-alert" role="alert">
            Could not load goals: {error}
          </p>
        ) : null}
        {goals && !shown.length ? <QuietLine>{mine.length ? 'No goals here.' : 'No goals yet. A goal is an outcome Tether works toward: a loop that re-runs a check until it passes, or a checklist you tick off.'}</QuietLine> : null}
        <ul className="sl-list gl-rows">
          {shown.map((g) => (
            <ListRow
              key={g.id}
              className={cn('gl-row', { current: g.id === open?.id })}
              title={g.title}
              onOpen={() => p.onSelect(g.id)}
              meta={goalLine(g)}
              actions={<Badge g={g} />}
              extra={
                <>
                  {g.kind === 'loop' ? <Bar label={`${g.title} budget used`} value={pct(g.spentUsd, g.budgetUsd)} met={g.status === 'met'} /> : <Bar label={`${g.title} progress`} value={Math.round(g.progress * 100)} met={g.status === 'met'} />}
                  <GoalScore goal={g} brief />
                  {g.status === 'needs_you' && g.pending ? <ApproveButton goal={g} onDone={set} /> : null}
                </>
              }
            />
          ))}
        </ul>
        <button type="button" className="gl-new" onClick={() => setDock('new')}>
          + New goal
        </button>
      </aside>
      {open ? <Detail key={open.id} goal={open} set={set} onSettings={() => setDock('settings')} onGo={p.onGo} newGoal={newGoal} /> : <FloatBar at="right">{newGoal}</FloatBar>}
      {dock === 'settings' && open ? (
        <Dock label="Goal settings" head={<h2 className="gl-dock-title">Goal settings</h2>} onClose={closeDock}>
          <GoalSettings key={open.id} goal={open} onClose={closeDock} onSaved={set} onDeleted={() => (closeDock(), drop(open.id), p.onSelect())} />
        </Dock>
      ) : dock === 'new' ? (
        <Dock label="New goal" head={<h2 className="gl-dock-title">New goal</h2>} onClose={closeDock}>
          <NewGoalForm
            projects={p.projects}
            current={p.project?.id}
            workflows={(flows.data ?? []).map((f) => f.name)}
            onCancel={closeDock}
            onCreated={(g) => (closeDock(), set(g), p.onSelect(g.id), notify.ok(`Goal created: ${g.title}`))}
          />
        </Dock>
      ) : null}
    </ToolScreen>
  );
}

/** The open goal: its title bar, its actions, the canvas and (for a loop) the limits bar. */
function Detail({ goal: g, set, onSettings, onGo, newGoal }: { goal: GoalView; set: (g: GoalView) => void; onSettings: () => void; onGo: (r: Route) => void; newGoal: ReactNode }) {
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
  const duplicate = () => void run(() => goalsApi.create({ title: `${g.title} (copy)`, workspace: g.workspace, workflow: g.workflow, check: g.check, budgetUsd: g.budgetUsd, maxRuns: g.maxRuns, approval: g.approval }).then((c) => (set(c), notify.ok('Goal duplicated'))));

  return (
    <>
      <FloatBar at="left" className="gl-titlebar">
        <h2 className="gl-title">{g.title}</h2>
        <Badge g={g} />
        <span className="gl-kind">
          {loop ? `Outcome loop · ${g.workflow === 'team' ? 'Team' : `Workflow ${g.workflow}`}` : 'Tracker'}
          {g.status === 'met' ? ` · ${fmtUsd(g.spentUsd)} · ${runs} ${runs === 1 ? 'run' : 'runs'}` : ''}
        </span>
      </FloatBar>
      <FloatBar at="right">
        <div className="gl-acts" role="group" aria-label="Goal actions">
          {loop && g.status !== 'met' && g.status !== 'stopped' ? (
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
            }}
          />
        ) : (
          <Tracker
            goal={g}
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
            <div className="gl-limit">
              <span className="gl-limit-top">
                Budget
                <b className="mono">
                  {fmtUsd(g.spentUsd)} of {fmtUsd(g.budgetUsd)}
                </b>
              </span>
              <Bar label="Budget used" value={pct(g.spentUsd, g.budgetUsd)} />
            </div>
            <div className="gl-limit">
              <span className="gl-limit-top">
                Runs
                <b className="mono">
                  {runs} of {g.maxRuns}
                </b>
              </span>
              <Bar label="Runs used" value={pct(runs, g.maxRuns)} />
            </div>
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
  const [budget, setBudget] = useState(String(p.goal.budgetUsd));
  const [runs, setRuns] = useState(String(p.goal.maxRuns));
  const [due, setDue] = useState(p.goal.dueDate ?? '');
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
          p.onSaved(await goalsApi.patch(p.goal.id, { ...(loop ? { budgetUsd: Number(budget), maxRuns: Number(runs) } : {}), dueDate: due || null }));
          p.onClose();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      {loop ? (
        <div className="gd-row">
          <Input label="Budget ($)" type="number" min={0.01} step="any" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <Input label="Max runs" type="number" min={1} max={50} step={1} value={runs} onChange={(e) => setRuns(e.target.value)} />
        </div>
      ) : null}
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
