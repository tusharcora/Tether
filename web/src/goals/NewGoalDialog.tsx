import { useState } from 'react';
import { Button } from '../components/beui/kit/Button';
import { Input, Select, Switch } from '../components/beui/kit/fields';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { WorkspaceRow } from '../home/workspaces';
import { goalsApi, type GoalCheck, type GoalView } from './goalsApi';
import './goals.css';

type Kind = GoalCheck['kind'];
const KINDS = [
  { value: 'command', label: 'Command' },
  { value: 'tests', label: 'Tests' },
  { value: 'number', label: 'Number target' },
];
const CMD: Record<Kind, [string, string]> = { command: ['Command', 'npm run lint'], tests: ['Test command', 'npm test -- login'], number: ['Command that prints a number', 'npm run bench -- --p95'] };

/** The finish check's fields: its kind, the command and, for a number, the target. `error` is the server's refusal. */
function CheckFields(p: { check: GoalCheck; onChange: (c: GoalCheck) => void }) {
  const [label, ph] = CMD[p.check.kind];
  return (
    <div className="gd-check">
      <SegmentedControl label="Check kind" options={KINDS} value={p.check.kind} onValueChange={(k) => p.onChange({ ...p.check, kind: k as Kind })} />
      <Input label={label} placeholder={ph} value={p.check.command} onChange={(e) => p.onChange({ ...p.check, command: e.target.value })} />
      {p.check.kind === 'number' ? <Input label="Target" description='Like "<=200" or ">=90" against the last number it prints.' placeholder="<=200" value={p.check.target ?? ''} onChange={(e) => p.onChange({ ...p.check, target: e.target.value })} /> : null}
    </div>
  );
}

const BLANK: GoalCheck = { kind: 'command', command: '' };

/** New goal (in the Goals dock): a title and a project; with a finish check it is an outcome loop, without one a tracker. */
export function NewGoalForm(p: { projects: WorkspaceRow[]; current?: string; workflows: string[]; onCreated: (g: GoalView) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [ws, setWs] = useState<string>();
  const [workflow, setWorkflow] = useState('team');
  const [withCheck, setWithCheck] = useState(false);
  const [check, setCheck] = useState<GoalCheck>(BLANK);
  const [budget, setBudget] = useState('5');
  const [runs, setRuns] = useState('5');
  const [approval, setApproval] = useState<'ask' | 'auto'>('ask');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const project = ws ?? p.current ?? p.projects[0]?.id;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const g = await goalsApi.create({
        title,
        workspace: project,
        workflow,
        ...(withCheck ? { check: { ...check, command: check.command.trim(), ...(check.kind === 'number' ? { target: check.target?.trim() } : {}) }, budgetUsd: Number(budget), maxRuns: Number(runs), approval } : {}),
        ...(due ? { dueDate: due } : {}),
      });
      p.onCreated(g);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="gd"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="mut gd-note">{withCheck ? 'An outcome loop: Tether runs until the check passes or a cap is hit.' : 'A tracker: a checklist of items and linked runs.'}</p>
      <Input label="Title" value={title} placeholder="Login tests green" maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
      <Select label="Project" value={project} onValueChange={setWs} options={p.projects.map((w) => ({ value: w.id, label: w.name }))} />
      <Select label="Who works on it" value={workflow} onValueChange={setWorkflow} options={[{ value: 'team', label: 'Team' }, ...p.workflows.map((w) => ({ value: w, label: `Workflow · ${w}` }))]} />
      <div className="gd-switch">
        <div>
          <strong>Add a finish check</strong>
          <p className="mut">Tether re-runs it after every run until it passes.</p>
        </div>
        <Switch aria-label="Add a finish check" checked={withCheck} onCheckedChange={setWithCheck} />
      </div>
      {withCheck ? (
        <>
          <CheckFields check={check} onChange={setCheck} />
          <div className="gd-row">
            <Input label="Budget ($)" type="number" min={0.01} step="any" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <Input label="Max runs" type="number" min={1} max={50} step={1} value={runs} onChange={(e) => setRuns(e.target.value)} />
          </div>
          <SegmentedControl label="Approval" options={[{ value: 'ask', label: 'Ask each run' }, { value: 'auto', label: 'Auto' }]} value={approval} onValueChange={(v) => setApproval(v as 'ask' | 'auto')} />
        </>
      ) : null}
      <Input label="Due date (optional)" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      {error ? (
        <p className="sl-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row end">
        <Button type="button" variant="secondary" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !project || (withCheck && !check.command.trim())}>
          Create goal
        </Button>
      </div>
    </form>
  );
}

/** A tracker gets a finish check and becomes a loop. */
export function CheckDialog(p: { goal?: GoalView; onClose: () => void; onDone: (g: GoalView) => void }) {
  const [check, setCheck] = useState<GoalCheck>(BLANK);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!p.goal} onOpenChange={(o) => !o && p.onClose()}>
      {p.goal ? (
        <DialogContent title="Add a finish check" description="Tether re-runs the check after every run and goes on until it passes or a cap is hit.">
          <form
            className="gd"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              try {
                p.onDone(await goalsApi.patch(p.goal!.id, { check: { ...check, command: check.command.trim() } }));
                p.onClose();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <CheckFields check={check} onChange={setCheck} />
            {error ? (
              <p className="sl-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="row end">
              <Button type="button" variant="secondary" onClick={p.onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!check.command.trim()}>
                Turn into a loop
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
