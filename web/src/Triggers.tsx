import { useEffect, useState } from 'react';
import { api } from './api';
import { Button } from './components/arc/button/button';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { Deliveries } from './triggers/Deliveries';
import { TriggerForm } from './triggers/TriggerForm';
import { TriggerRow } from './triggers/TriggerRow';
import { TriggerTest } from './triggers/TriggerTest';
import { blank, fromTrigger, split, type Delivery, type Form, type Trigger, type Workspace } from './triggers/types';
import { WebhookSetup } from './triggers/WebhookSetup';
import { useNotify } from './ui/notify';
import { InlineError } from './ui/studio/InlineError';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import './triggers/triggers.css';

const NO_TRIGGERS: Trigger[] = [];

export function Triggers() {
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

  useEffect(() => {
    void api<Workspace[]>('GET', '/api/workspaces').then(setWorkspaces).catch(() => undefined);
    void api<{ name: string }[]>('GET', '/api/pipelines').then((p) => setWorkflows(p.map((x) => x.name))).catch(() => undefined);
    void api<{ agents: Record<string, { ok: boolean; models: string[] }> }>('GET', '/api/bots').then((r) => setAgents(r.agents)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!testId || !rows.some((t) => t.id === testId)) setTestId(rows[0]?.id ?? '');
  }, [rows, testId]);

  async function reload() {
    await list.refresh();
    await log.refresh();
  }
  const openForm = (t?: Trigger) => {
    setForm(t ? fromTrigger(t) : blank());
    setEditing(!!t);
  };
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
  const toTest = (id?: string) => {
    if (id) setTestId(id);
    const field = document.getElementById('tg-pr');
    field?.scrollIntoView?.({ block: 'center' });
    field?.focus();
  };

  return (
    <div className="tg-page">
      <div className="tg-wrap">
        <ScreenHeader
          meta={`GitHub webhooks · POST /api/webhooks/github · ${rows.length} trigger${rows.length === 1 ? '' : 's'}`}
          title="Triggers"
          summary="Start a run when a pull request opens or changes. Pause one to keep it without acting on PRs."
          actions={
            <>
              <Button variant="secondary" onClick={() => toTest()}>
                Test a trigger
              </Button>
              <Button variant="primary" onClick={() => openForm()}>
                New trigger
              </Button>
            </>
          }
        />
        <Loading loading={loading} lines={6} label="Loading triggers">
          <div className="tg-body">
            <div className="tg-main-col">
              <section aria-label="Triggers">
                {list.error && !list.data ? (
                  <InlineError message={list.error} onRetry={() => void list.refresh()} />
                ) : rows.length ? (
                  <ul className="tg-list">
                    {rows.map((t) => (
                      <TriggerRow key={t.id} t={t} onToggle={() => void toggle(t)} onTest={() => toTest(t.id)} onLog={() => setLogFor(t.id)} onEdit={() => openForm(t)} onDelete={() => remove(t.id)} />
                    ))}
                  </ul>
                ) : (
                  <p className="sl-meta">
                    No triggers yet. Add one, then set up the webhook below (or run <code>tether pr watch</code> to poll instead).
                  </p>
                )}
              </section>
              <TriggerTest triggers={rows} testId={testId} onTestId={setTestId} onFired={reload} />
              <WebhookSetup />
            </div>
            <aside className="tg-side">
              <Deliveries triggers={rows} logFor={logFor} onLogFor={setLogFor} log={log} />
            </aside>
          </div>
        </Loading>
      </div>
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
    </div>
  );
}
