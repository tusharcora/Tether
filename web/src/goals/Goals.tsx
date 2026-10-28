import { ListChecks } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, fmtUsd } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Route } from '../hooks';
import { RunDiff } from '../ui/RunDiff';
import { useNotify } from '../ui/notify';
import { EmptyState } from '../ui/studio/EmptyState';
import { ListRow } from '../ui/studio/ListRow';
import { RUN_STATE_LABEL, RunGlyph } from '../ui/studio/RunGlyph';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { StatusChip, type Tone } from '../ui/studio/StatusChip';
import { useCreateIntent } from '../ui/useCreateIntent';
import { cn } from '../ui/cn';
import { glyphOf, goalMeta, goalsApi, inProject, isOpen, STATUS_LABEL, type GoalView } from './goalsApi';
import { LoopFlow } from './LoopFlow';
import { CheckDialog, NewGoalDialog } from './NewGoalDialog';
import { Tracker } from './Tracker';
import './goals.css';

type Filter = 'all' | 'active' | 'met';
const TONE: Record<GoalView['status'], Tone> = { active: 'live', needs_you: 'needs', paused: 'neutral', met: 'done', stopped: 'failed' };

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

/** Goals (`#/goals`): the rows on the left, the open goal on the right: a loop's flow of action nodes, or a tracker's checklist. */
export function Goals(p: GoalsProps) {
  const notify = useNotify();
  const { goals, error, set, drop } = p.goals;
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const flows = usePoll<{ name: string }[]>(newOpen ? '/api/pipelines' : null, 60_000);
  useCreateIntent(p.create, true, () => setNewOpen(true));

  const mine = inProject(goals, p.project?.id);
  const shown = mine.filter((g) => (filter === 'all' ? true : filter === 'met' ? g.status === 'met' : isOpen(g)));
  const open = mine.find((g) => g.id === p.selected);
  const tabs = [
    { value: 'all', label: 'All', accessory: mine.length },
    { value: 'active', label: 'Active', accessory: mine.filter(isOpen).length },
    { value: 'met', label: 'Met', accessory: mine.filter((g) => g.status === 'met').length },
  ];

  return (
    <div className="goals">
      <section className="goals-list" aria-label="Goals">
        <ScreenHeader
          title="Goals"
          meta={goals ? `${mine.filter(isOpen).length} active` : undefined}
          actions={
            <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
              New goal
            </Button>
          }
        />
        <div className="goals-tabs">
          <SegmentedControl label="Show goals" options={tabs.map((t) => ({ value: t.value, label: t.label, accessory: <span className="mut">{t.accessory}</span> }))} value={filter} onValueChange={(v) => setFilter(v as Filter)} />
        </div>
        {error && !goals ? (
          <p className="sl-alert" role="alert">
            Could not load goals: {error}
          </p>
        ) : null}
        {goals && !shown.length ? (
          <EmptyState
            title={mine.length ? 'No goals here' : 'No goals yet'}
            description="A goal is an outcome Tether works toward: a loop that re-runs a check until it passes, or a checklist you tick off."
            action={
              <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
                New goal
              </Button>
            }
          />
        ) : null}
        <ul className="sl-list goals-rows">
          {shown.map((g) => (
            <ListRow
              key={g.id}
              className={cn('goal-row', { current: g.id === p.selected })}
              lead={g.kind === 'tracker' ? <ListChecks size={14} strokeWidth={1.6} aria-label="Tracker" role="img" className="goal-tracker-glyph" /> : <RunGlyph state={glyphOf(g)} />}
              title={g.title}
              onOpen={() => p.onSelect(g.id)}
              meta={goalMeta(g)}
              actions={g.status === 'needs_you' && g.pending ? <ApproveButton goal={g} onDone={set} /> : <span className="sl-sr">{RUN_STATE_LABEL[glyphOf(g)]}</span>}
              extra={
                <span className="goal-bar" role="progressbar" aria-label={`${g.title} progress`} aria-valuenow={Math.round(g.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${Math.round(g.progress * 100)}%` }} className={cn({ met: g.status === 'met' })} />
                </span>
              }
            />
          ))}
        </ul>
      </section>
      <section className="goal-detail" aria-label="Goal">
        {open ? (
          <Detail key={open.id} goal={open} set={set} drop={(id) => (drop(id), p.onSelect())} onGo={p.onGo} />
        ) : (
          <div className="goal-none">
            <EmptyState title="Pick a goal" description="Open one to see its loop or its checklist." />
          </div>
        )}
      </section>
      <NewGoalDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projects={p.projects}
        current={p.project?.id}
        workflows={(flows.data ?? []).map((f) => f.name)}
        onCreated={(g) => (set(g), p.onSelect(g.id), notify.ok(`Goal created: ${g.title}`))}
      />
    </div>
  );
}

function Detail({ goal: g, set, drop, onGo }: { goal: GoalView; set: (g: GoalView) => void; drop: (id: string) => void; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const [checking, setChecking] = useState(false);
  const [settings, setSettings] = useState(false);
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
  const budgetPct = g.budgetUsd ? Math.min(100, Math.round((g.spentUsd / g.budgetUsd) * 100)) : 0;

  return (
    <div className="gd-wrap">
      <header className="gd-head">
        <div className="gd-title">
          <h2>{g.title}</h2>
          <StatusChip tone={g.kind === 'tracker' && g.status === 'active' ? 'neutral' : TONE[g.status]} label={g.kind === 'tracker' && g.status === 'active' ? 'Open' : STATUS_LABEL[g.status]} pulse={g.status === 'active' && g.kind === 'loop'} />
        </div>
        <p className="sl-meta">
          {g.kind === 'loop' ? 'Outcome loop' : 'Tracker'} · {g.workflow === 'team' ? 'Team' : `Workflow ${g.workflow}`}
          {g.status === 'met' ? ` · ${fmtUsd(g.spentUsd)} · ${runs} ${runs === 1 ? 'run' : 'runs'}` : ''}
        </p>
        {g.reason && g.status === 'stopped' ? <p className="sl-note">{g.reason}</p> : null}
        {g.kind === 'loop' && g.status !== 'met' && g.status !== 'stopped' ? (
          <div className="row">
            <Button size="sm" variant="secondary" onClick={() => void run(() => goalsApi.patch(g.id, { status: g.status === 'paused' ? 'active' : 'paused' }))}>
              {g.status === 'paused' ? 'Resume goal' : 'Pause goal'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void run(() => goalsApi.patch(g.id, { status: 'stopped' }))}>
              Stop
            </Button>
          </div>
        ) : null}
      </header>

      {g.kind === 'loop' ? (
        <>
          <div className="gd-limits" aria-label="Limits">
            <div className="gd-limit">
              <span className="mut">Budget</span>
              <span className="mono">
                {fmtUsd(g.spentUsd)} of {fmtUsd(g.budgetUsd)}
              </span>
              <span className="goal-bar" role="progressbar" aria-label="Budget used" aria-valuenow={budgetPct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${budgetPct}%` }} />
              </span>
            </div>
            <div className="gd-limit">
              <span className="mut">Runs</span>
              <span className="mono">
                {runs} of {g.maxRuns}
              </span>
            </div>
            <SegmentedControl label="Approval" options={[{ value: 'ask', label: 'Ask each run' }, { value: 'auto', label: 'Auto' }]} value={g.approval} onValueChange={(v) => void run(() => goalsApi.patch(g.id, { approval: v }))} />
          </div>
          <div className="gd-grid">
            <LoopFlow
              goal={g}
              checking={checking}
              act={{
                runCheck: () => {
                  setChecking(true);
                  void run(() => goalsApi.check(g.id)).finally(() => setChecking(false));
                },
                saveCommand: (command) => g.check && void run(() => goalsApi.patch(g.id, { check: { ...g.check, command } })),
                settings: () => setSettings(true),
                openRun: (id) => onGo({ tab: 'runs', id }),
                retry: (id) => void run(() => api('POST', `/api/runs/${id}/resume`, { retryFailed: true }).then(() => notify.ok('Retrying the run'))),
                diff: setDiffRun,
                start: (plan) => void run(() => goalsApi.next(g.id, 'start', plan)),
                skip: () => void run(() => goalsApi.next(g.id, 'skip')),
                duplicate: () => void run(() => goalsApi.create({ title: `${g.title} (copy)`, workspace: g.workspace, workflow: g.workflow, check: g.check, budgetUsd: g.budgetUsd, maxRuns: g.maxRuns, approval: g.approval }).then((c) => (set(c), notify.ok('Goal duplicated')))),
              }}
            />
          </div>
        </>
      ) : (
        <Tracker
          goal={g}
          onGo={onGo}
          onToggle={(item, done) => void run(async () => (await goalsApi.toggleItem(g.id, item, done), api<GoalView>('GET', `/api/goals/${g.id}`)))}
          onAdd={(text) => void run(async () => (await goalsApi.addItem(g.id, text), api<GoalView>('GET', `/api/goals/${g.id}`)))}
          onToLoop={() => setToLoop(true)}
        />
      )}

      <SettingsDialog open={settings} goal={g} onClose={() => setSettings(false)} onSaved={set} onDeleted={() => (setSettings(false), drop(g.id))} />
      <DiffDialog run={diffRun} onClose={() => setDiffRun(undefined)} />
      <CheckDialog goal={toLoop ? g : undefined} onClose={() => setToLoop(false)} onDone={set} />
    </div>
  );
}

/** Budget, runs and due date; Delete is here, behind its own question. */
function SettingsDialog(p: { open: boolean; goal: GoalView; onClose: () => void; onSaved: (g: GoalView) => void; onDeleted: () => void }) {
  const notify = useNotify();
  const [budget, setBudget] = useState(String(p.goal.budgetUsd));
  const [runs, setRuns] = useState(String(p.goal.maxRuns));
  const [due, setDue] = useState(p.goal.dueDate ?? '');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => setAsking(false), [p.open]);
  const loop = p.goal.kind === 'loop';
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      {p.open ? (
        asking ? (
          <DialogContent title={`Delete ${p.goal.title}?`} description="The goal and its checklist go. Its runs stay in Runs.">
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
          </DialogContent>
        ) : (
          <DialogContent title="Goal settings">
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
          </DialogContent>
        )
      ) : null}
    </Dialog>
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
