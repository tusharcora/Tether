import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ago, api } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Input, Select, Switch } from '../components/beui/kit/fields';
import { Textarea } from '../components/kept/textarea/textarea';
import { usePoll } from '../hooks';
import { cn } from '../ui/cn';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { StatusBadge } from '../ui/studio/StatusBadge';
import type { Workspace } from './types';
import './triggers.css';

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  workspace?: string;
  target: { kind: 'workflow'; workflow: string; task: string } | { kind: 'goal'; goalId: string };
  enabled: boolean;
  nextAt?: string;
  lastRunAt?: string;
  lastRunId?: string;
  lastError?: string;
}
interface GoalLite {
  id: string;
  title: string;
  kind: 'loop' | 'tracker';
  status: string;
}

export const PRESETS = [
  { label: 'Every night 02:00', cron: '0 2 * * *' },
  { label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
  { label: 'Mondays 09:00', cron: '0 9 * * 1' },
  { label: 'Hourly', cron: '0 * * * *' },
];

/** A fire time in the viewer's words: "Thu, Oct 30, 02:00". */
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Draft {
  name: string;
  cron: string;
  kind: 'workflow' | 'goal';
  workspace: string;
  workflow: string;
  task: string;
  goalId: string;
}
const blankDraft = (): Draft => ({ name: '', cron: PRESETS[0]!.cron, kind: 'workflow', workspace: '', workflow: '', task: '', goalId: '' });

/**
 * Schedules on the Triggers screen: each starts a workflow in a workspace, or gives a recurring ticket its next turn, on a cron rule in
 * this machine's time. A list with the next fire, an on/off switch, Run now and Delete, and a form with presets.
 */
export function Schedules(p: { workspaces: Workspace[]; workflows: string[] }) {
  const notify = useNotify();
  const list = usePoll<Schedule[]>('/api/schedules', 10_000);
  const [goals, setGoals] = useState<GoalLite[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<GoalLite[]>('GET', '/api/tickets').then(setGoals).catch(() => undefined);
  }, []);
  const set = (d: Partial<Draft>) => setDraft((x) => (x ? { ...x, ...d } : x));
  const openGoals = goals.filter((g) => g.kind === 'loop' && g.status !== 'met' && g.status !== 'stopped');
  const what = (s: Schedule) => (s.target.kind === 'goal' ? `ticket ${goals.find((g) => g.id === (s.target as { goalId: string }).goalId)?.title ?? s.target.goalId}` : `runs ${s.target.workflow} in ${s.workspace}`);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await list.refresh();
    } catch (e) {
      notify.fail(e);
    }
  }
  const toggle = (s: Schedule) => act(() => api('PATCH', `/api/schedules/${encodeURIComponent(s.id)}`, { enabled: !s.enabled }));
  const remove = (s: Schedule) => act(() => api('DELETE', `/api/schedules/${encodeURIComponent(s.id)}`));
  const runNow = (s: Schedule) =>
    act(async () => {
      const r = await api<Schedule>('POST', `/api/schedules/${encodeURIComponent(s.id)}/run`);
      if (r.lastError) notify.fail(new Error(r.lastError));
      else notify.ok(`${s.name} started`);
    });
  async function save() {
    const d = draft!;
    setBusy(true);
    try {
      const target = d.kind === 'goal' ? { kind: 'goal', goalId: d.goalId } : { kind: 'workflow', workflow: d.workflow.trim(), task: d.task };
      await api('POST', '/api/schedules', { name: d.name, cron: d.cron, ...(d.kind === 'workflow' ? { workspace: d.workspace } : {}), target });
      setDraft(null);
      notify.ok(`${d.name.trim()} scheduled`);
      await list.refresh();
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = list.data ?? [];
  const ready = draft && draft.name.trim() && draft.cron.trim() && (draft.kind === 'goal' ? draft.goalId : draft.workspace && draft.workflow.trim() && draft.task.trim());
  return (
    <section className="sc-section" aria-label="Schedules">
      <div className="sc-head">
        <h2 className="tg-title">Schedules</h2>
        {draft ? null : (
          <Button size="sm" variant="secondary" onClick={() => setDraft({ ...blankDraft(), workspace: p.workspaces.find((w) => w.isDefault)?.id ?? p.workspaces[0]?.id ?? '' })}>
            + New schedule
          </Button>
        )}
      </div>
      {list.error && !list.data ? (
        <InlineError compact message={list.error} onRetry={() => void list.refresh()} />
      ) : rows.length ? (
        <ul className="tg-list">
          {rows.map((s) => (
            <li key={s.id} className={cn('tg-card', { paused: !s.enabled })}>
              <span className="tg-ic" aria-hidden="true">
                <CalendarClock size={18} />
              </span>
              <span className="tg-card-text">
                <span className="tg-line">
                  <b className="tg-id">{s.name}</b>
                  <span className="tg-status">{s.enabled ? (s.nextAt ? `next ${when(s.nextAt)}` : 'never fires again') : 'off'}</span>
                </span>
                <span className="tg-flow">
                  <span className="tg-chip">{s.cron}</span>
                  <span aria-hidden="true">→</span>
                  <span className="tg-chip">{what(s)}</span>
                </span>
                {s.lastError ? (
                  <span className="tg-last">
                    <StatusBadge tone="failed" label="failed" />
                    <span className="tg-meta">{s.lastError}</span>
                  </span>
                ) : s.lastRunAt ? (
                  <span className="tg-meta">
                    {s.lastRunId ? <a href={`#/runs/${encodeURIComponent(s.lastRunId)}`}>last run</a> : 'last turn'} {ago(Date.parse(s.lastRunAt))}
                  </span>
                ) : null}
              </span>
              <span className="tg-side">
                <Switch aria-label={`${s.enabled ? 'Turn off' : 'Turn on'} ${s.name}`} checked={s.enabled} onCheckedChange={() => void toggle(s)} />
                <span className="tg-actions">
                  <Button size="sm" variant="ghost" onClick={() => void runNow(s)}>
                    Run now
                  </Button>
                  <ConfirmButton label="Delete" prompt={`Delete the schedule ${s.name}?`} confirmLabel="Yes, delete" onConfirm={() => remove(s)} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : draft || !list.data ? null : (
        <p className="tg-note">No schedules yet. A schedule starts a workflow or works on a recurring ticket at set times, in this computer's time zone.</p>
      )}
      {draft ? (
        <form
          className="tg-form sc-form"
          aria-label="New schedule"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input label="Name" required value={draft.name} placeholder="Nightly dependency check" onChange={(e) => set({ name: e.target.value })} />
          <Input label="Cron" required value={draft.cron} placeholder="minute hour day month weekday" spellCheck={false} onChange={(e) => set({ cron: e.target.value })} />
          <div className="sc-presets" role="group" aria-label="Presets">
            {PRESETS.map((x) => (
              <Button key={x.cron} type="button" size="sm" variant={draft.cron.trim() === x.cron ? 'primary' : 'secondary'} aria-pressed={draft.cron.trim() === x.cron} onClick={() => set({ cron: x.cron })}>
                {x.label}
              </Button>
            ))}
          </div>
          <Select label="Does" value={draft.kind} onValueChange={(v) => set({ kind: v as Draft['kind'] })} options={[{ value: 'workflow', label: 'Run a workflow' }, { value: 'goal', label: 'Work on a recurring ticket' }]} />
          {draft.kind === 'workflow' ? (
            <>
              <Select label="Workspace" value={draft.workspace} onValueChange={(v) => set({ workspace: v })} options={p.workspaces.map((w) => ({ value: w.id, label: `${w.name || w.id}${w.exists ? '' : ' (folder missing)'}` }))} />
              <Input label="Workflow" required list="sc-workflows" value={draft.workflow} spellCheck={false} onChange={(e) => set({ workflow: e.target.value })} />
              <datalist id="sc-workflows">
                {p.workflows.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
              <Textarea label="Task" rows={3} value={draft.task} placeholder="What the run should do each time" onChange={(e) => set({ task: e.target.value })} />
            </>
          ) : openGoals.length ? (
            <Select label="Ticket" value={draft.goalId} onValueChange={(v) => set({ goalId: v })} options={openGoals.map((g) => ({ value: g.id, label: g.title }))} />
          ) : (
            <p className="tg-note">No open recurring ticket yet (one with an auto-checked criterion).</p>
          )}
          <div className="tg-actions">
            <Button variant="primary" type="submit" disabled={!ready || busy}>
              Save
            </Button>
            <Button variant="secondary" type="button" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
