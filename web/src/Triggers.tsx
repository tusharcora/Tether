import { useEffect, useState } from 'react';
import { useCreateIntent } from './ui/useCreateIntent';
import { api } from './api';
import { Button } from './components/beui/kit/Button';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { Deliveries } from './triggers/Deliveries';
import { TriggerForm } from './triggers/TriggerForm';
import { TriggerCard } from './triggers/TriggerCard';
import { TriggerFlow } from './triggers/TriggerFlow';
import { TriggerTest } from './triggers/TriggerTest';
import { Schedules } from './triggers/Schedules';
import { blank, fromTrigger, split, type Delivery, type Form, type Trigger, type Workspace } from './triggers/types';
import { WebhookSetup } from './triggers/WebhookSetup';
import { cn } from './ui/cn';
import { ConfirmButton } from './ui/ConfirmButton';
import { useNotify } from './ui/notify';
import { InlineError } from './ui/studio/InlineError';
import { QuietLine } from './ui/studio/Section';
import { Dock, FloatBar, ToolScreen } from './ui/studio/ToolFrame';
import './triggers/triggers.css';

const NO_TRIGGERS: Trigger[] = [];

export function Triggers(props: { /** The Create menu asked for a new trigger (a counter). */ create?: number }) {
  const notify = useNotify();
  const [logFor, setLogFor] = useState('');
  // rows are keyed by id, so a 5 s poll updates them in place and a focused control keeps focus
  const list = usePoll<Trigger[]>('/api/triggers', 5000);
  const rows = list.data ?? NO_TRIGGERS;
  const log = usePoll<Delivery[]>(`/api/triggers/deliveries?${logFor ? `trigger=${encodeURIComponent(logFor)}&` : ''}limit=50`, 5000);
  const loading = list.data === undefined && !list.error;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<Record<string, { ok: boolean; models: string[] }>>({});
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [testId, setTestId] = useState('');
  /** The dock: an open trigger's form (form), else Setup & test. */
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    void api<Workspace[]>('GET', '/api/workspaces').then(setWorkspaces).catch(() => undefined);
    void api<{ name: string }[]>('GET', '/api/pipelines').then((p) => setWorkflows(p.map((x) => x.name))).catch(() => undefined);
    void api<{ agents: Record<string, { ok: boolean; models: string[] }> }>('GET', '/api/bots').then((r) => setAgents(r.agents)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!testId || !rows.some((t) => t.id === testId)) setTestId(rows[0]?.id ?? '');
  }, [rows, testId]);

  /** The trigger whose flow is drawn: the one picked for its log or test, else the first. */
  const selected = rows.find((t) => t.id === (logFor || testId)) ?? rows[0];
  async function reload() {
    await list.refresh();
    await log.refresh();
  }
  const openForm = (t?: Trigger) => {
    setForm(t ? fromTrigger(t) : blank());
    setEditing(!!t);
    setSetupOpen(false);
  };
  useCreateIntent(props.create, true, () => openForm());
  async function save() {
    const f = form!;
    try {
      const t = await api<Trigger>('POST', '/api/triggers', { ...f, events: split(f.events), labels: split(f.labels) });
      setForm(null);
      notify.ok(`${t.id} saved${t.warnings?.length ? '. ' + t.warnings.join(' ') : ''}`);
      await reload();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function toggle(t: Trigger) {
    try {
      await api('PATCH', `/api/triggers/${encodeURIComponent(t.id)}`, { enabled: t.enabled === false });
      await reload();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function remove(id: string) {
    try {
      await api('DELETE', `/api/triggers/${encodeURIComponent(id)}`);
      if (logFor === id) setLogFor('');
      notify.ok(`${id} deleted`);
      await reload();
    } catch (e) {
      notify.fail(e);
    }
  }
  /** Setup & test in the dock (with `id` picked for the dry run), its PR field focused once it is there. */
  const toTest = (id?: string) => {
    if (id) setTestId(id);
    setForm(null);
    setSetupOpen(true);
    setTimeout(() => document.getElementById('tg-pr')?.focus());
  };

  const on = rows.filter((t) => t.enabled !== false).length;
  const actions = (
    <>
      <Button size="sm" variant="secondary" onClick={() => toTest()}>
        Setup &amp; test
      </Button>
      <Button size="sm" variant="primary" onClick={() => openForm()}>
        + New trigger
      </Button>
    </>
  );
  return (
    <ToolScreen className={cn('tg-screen', { docked: !!form || setupOpen })}>
      <Loading className="tg-load" loading={loading} lines={6} label="Loading triggers">
        <section className="tg-cards" aria-label="Triggers">
          {list.error && !list.data ? (
            <InlineError message={list.error} onRetry={() => void list.refresh()} />
          ) : rows.length ? (
            <>
              <ul className="tg-list">
                {rows.map((t) => (
                  <TriggerCard key={t.id} t={t} selected={editing && form?.id === t.id} onOpen={() => openForm(t)} onToggle={() => void toggle(t)} />
                ))}
              </ul>
              {/* main's Event → Filter → Workflow flow for the selected trigger, under the cards */}
              {selected ? (
                <TriggerFlow
                  t={selected}
                  workspace={workspaces.find((w) => w.id === selected.workspace)}
                  onTestFire={() => toTest(selected.id)}
                  onToggle={() => void toggle(selected)}
                  onSettings={() => openForm(selected)}
                  onOpenWorkflow={() => (location.hash = `#/builder/${encodeURIComponent(selected.workflow)}`)}
                  onStarted={(id) => (location.hash = `#/runs/${id}`)}
                />
              ) : null}
            </>
          ) : (
            <div className="tg-empty">
              <QuietLine>
                No triggers yet. Add one, then set up the webhook (or run <code>tether pr watch</code> to poll instead).
              </QuietLine>
              <div className="tg-actions">{actions}</div>
            </div>
          )}
          <Schedules workspaces={workspaces} workflows={workflows} />
        </section>
      </Loading>
      <FloatBar at="left">
        <h1 className="tg-title">Triggers</h1>
        <span className="tg-fact">{`${on} on`}</span>
      </FloatBar>
      <FloatBar at="right">{actions}</FloatBar>
      {loading ? null : (
        <FloatBar at="bottom" className="tf-wide tg-logbar">
          <Deliveries triggers={rows} logFor={logFor} onLogFor={setLogFor} log={log} />
        </FloatBar>
      )}
      {form ? (
        <Dock label="Trigger" head={<h2 className="tg-title">{editing ? form.id : 'New trigger'}</h2>} onClose={() => setForm(null)}>
          <TriggerForm
            form={form}
            editing={editing}
            workspaces={workspaces}
            agents={agents}
            workflows={workflows}
            onChange={(p) => setForm((f) => (f ? { ...f, ...p } : f))}
            onSave={() => void save()}
            onClose={() => setForm(null)}
          />
          {editing ? (
            <div className="tg-actions tg-row-actions">
              {form.on === 'pr' ? (
                <Button variant="ghost" size="sm" onClick={() => toTest(form.id)}>
                  Test
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setLogFor(form.id)}>
                Log
              </Button>
              <ConfirmButton label="Delete" prompt={`Delete ${form.id}?`} confirmLabel="Yes, delete" onConfirm={() => (setForm(null), remove(form.id))} />
            </div>
          ) : null}
        </Dock>
      ) : setupOpen ? (
        <Dock label="Setup & test" head={<h2 className="tg-title">Setup &amp; test</h2>} onClose={() => setSetupOpen(false)}>
          <WebhookSetup />
          <TriggerTest triggers={rows} testId={testId} onTestId={setTestId} onFired={reload} />
        </Dock>
      ) : null}
    </ToolScreen>
  );
}
