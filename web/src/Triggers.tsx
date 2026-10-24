import { useEffect, useState } from 'react';
import { api, ago } from './api';
import { Button } from './components/arc/button/button';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { CopyButton } from './components/arc/copy-button/copy-button';
import { Input } from './components/arc/input/input';
import { Select } from './components/arc/select/select';
import { SortableDataTable, type DataColumn } from './components/arc/sortable-data-table/sortable-data-table';
import { Switch } from './components/arc/switch/switch';
import { usePoll } from './hooks';
import { ConfirmButton } from './ui/ConfirmButton';
import { NONE, cn, fromNone } from './ui/cn';
import { useNotify } from './ui/notify';

interface Delivery { at: string; trigger?: string; source: 'webhook' | 'poll' | 'test'; repo: string; pr?: number; outcome: 'started' | 'ignored' | 'skipped' | 'error'; reason?: string; runId?: string }
type Status = 'paused' | 'error' | 'idle' | 'active';
interface Trigger {
  id: string; repo: string; workflow: string; workspace?: string; agent?: string; model?: string; events?: string[]; labels?: string[];
  comment?: boolean; drafts?: boolean; forks?: boolean; enabled?: boolean; status: Status; last: Delivery | null; warnings?: string[];
}
interface Workspace { id: string; name: string; path: string; isDefault: boolean; exists: boolean; repos: string[] }
interface Setup { payloadPath: string; hasSecret: boolean; secretHint: string | null; secretSource: 'env' | 'file' | null; eventsToSelect: string[]; contentType: string }
interface Form { id: string; repo: string; workflow: string; workspace: string; agent: string; model: string; events: string; labels: string; comment: boolean; drafts: boolean; forks: boolean }
interface TestResult { matches: boolean; why: string; fired: boolean; runId?: string; pr: { repo: string; number: number; title: string; url: string }; note?: string }

const EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'labeled'];
const blank = (): Form => ({ id: '', repo: '', workflow: 'full-review', workspace: '', agent: '', model: '', events: '', labels: '', comment: false, drafts: false, forks: false });
const fromTrigger = (t: Trigger): Form => ({ id: t.id, repo: t.repo, workflow: t.workflow, workspace: t.workspace ?? '', agent: t.agent ?? '', model: t.model ?? '', events: (t.events ?? []).join(', '), labels: (t.labels ?? []).join(', '), comment: !!t.comment, drafts: !!t.drafts, forks: !!t.forks });
const statusTip: Record<Status, string> = { paused: 'paused: PRs are ignored until you enable it', error: 'the last delivery failed', idle: 'waiting for a pull request', active: 'started a run in the last 24 hours' };

type TriggerRow = Trigger & Record<string, unknown>;
type DeliveryRow = Delivery & Record<string, unknown>;
const NO_TRIGGERS: Trigger[] = [];
const NO_DELIVERIES: Delivery[] = [];
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function Triggers() {
  const notify = useNotify();
  const [logFor, setLogFor] = useState('');
  // Rows are keyed by id, so a 5 s poll updates cells in place and a focused control keeps focus.
  const list = usePoll<Trigger[]>('/api/triggers', 5000);
  const rows = list.data ?? NO_TRIGGERS;
  const log = usePoll<Delivery[]>(`/api/triggers/deliveries?${logFor ? `trigger=${encodeURIComponent(logFor)}&` : ''}limit=50`, 5000);
  const deliveries = log.data ?? NO_DELIVERIES;
  const loading = list.data === undefined && !list.error;

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<Record<string, { ok: boolean; models: string[] }>>({});
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupErr, setSetupErr] = useState('');
  const [secret, setSecret] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [testId, setTestId] = useState('');
  const [testPr, setTestPr] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testErr, setTestErr] = useState('');

  async function loadSetup() {
    try {
      setSetup(await api<Setup>('GET', '/api/triggers/setup'));
      setSetupErr('');
    } catch (e) {
      setSetupErr((e as Error).message);
    }
  }
  useEffect(() => {
    void loadSetup();
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

  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const openForm = (t?: Trigger) => {
    setForm(t ? fromTrigger(t) : blank());
    setEditing(!!t);
    setTimeout(() => document.querySelector('.trigger-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  async function save() {
    const f = form!;
    try {
      const body = { ...f, events: split(f.events), labels: split(f.labels) };
      const t = await api<Trigger>('POST', '/api/triggers', body);
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
  async function runTest(fire: boolean) {
    setTesting(true);
    setTestErr('');
    setResult(null);
    try {
      setResult(await api<TestResult>('POST', `/api/triggers/${encodeURIComponent(testId)}/test`, { pr: testPr.trim(), fire }));
      if (fire) await reload();
    } catch (e) {
      setTestErr((e as Error).message);
      if (fire) await reload();
    } finally {
      setTesting(false);
    }
  }
  async function regenerate() {
    try {
      const r = await api<{ secret: string }>('POST', '/api/triggers/setup/secret');
      setSecret(r.secret);
      await loadSetup();
    } catch (e) {
      notify.fail(e);
    }
  }
  const copied = () => notify.ok('copied');
  const who = (t: Trigger) => (t.agent ? `${t.agent}${t.model ? ' · ' + t.model : ''}` : t.model ? `default · ${t.model}` : 'crew defaults');
  const agentModels = agents[form?.agent ?? '']?.models ?? [];
  const payloadUrl = `https://<your tunnel>${setup?.payloadPath ?? '/api/webhooks/github'}`;

  const triggerColumns: DataColumn<TriggerRow>[] = [
    { key: 'status', label: '', render: (_, t) => <span className={`dot ${t.status}`} title={statusTip[t.status]} role="img" aria-label={t.status} /> },
    { key: 'id', label: 'Trigger', sortable: true, render: (_, t) => <><b>{t.id}</b><div className="muted small">{t.status}</div></> },
    {
      key: 'repo', label: 'Repo → workflow', sortable: true,
      render: (_, t) => <>{t.repo} <span className="muted">→</span> <code>{t.workflow}</code>{t.comment ? <span className="chip" title="posts the result on the PR"> comments</span> : null}</>,
    },
    { key: 'workspace', label: 'Workspace', render: (_, t) => <span className="muted">{t.workspace ?? 'none'}</span> },
    { key: 'agent', label: 'Agent / model', render: (_, t) => <span className="muted">{who(t)}</span> },
    { key: 'events', label: 'Events', render: (_, t) => <span className="muted small">{(t.events ?? ['opened', 'synchronize', 'reopened', 'ready_for_review']).join(', ')}</span> },
    {
      key: 'last', label: 'Last delivery',
      render: (_, t) => t.last
        ? <><span className={`dlv ${t.last.outcome}`}>{t.last.outcome}</span> <span className="muted small">{t.last.pr ? `#${t.last.pr} · ` : ''}{ago(Date.parse(t.last.at))}</span></>
        : <span className="muted small">no deliveries</span>,
    },
    {
      key: 'enabled', label: 'On',
      render: (_, t) => <Switch aria-label={`${t.enabled === false ? 'Enable' : 'Pause'} ${t.id}`} checked={t.enabled !== false} onCheckedChange={() => void toggle(t)} />,
    },
    {
      key: 'actions', label: '',
      render: (_, t) => (
        <div className="row trig-actions">
          <Button variant="ghost" size="sm" onClick={() => { setTestId(t.id); document.querySelector('.trigger-test')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Test</Button>
          <Button variant="ghost" size="sm" onClick={() => setLogFor(t.id)}>Log</Button>
          <Button variant="ghost" size="sm" onClick={() => openForm(t)}>Edit</Button>
          <ConfirmButton label="Delete" prompt={`Delete ${t.id}?`} confirmLabel="Yes, delete" onConfirm={() => remove(t.id)} />
        </div>
      ),
    },
  ];

  const deliveryColumns: DataColumn<DeliveryRow>[] = [
    { key: 'at', label: 'When', sortable: true, render: (_, d) => <span className="muted small" title={d.at}>{ago(Date.parse(d.at))}</span> },
    { key: 'trigger', label: 'Trigger', sortable: true, render: (_, d) => <span className="muted small">{d.trigger ?? '-'}</span> },
    { key: 'source', label: 'Source', render: (_, d) => <span className="muted small">{d.source}</span> },
    { key: 'repo', label: 'PR', render: (_, d) => <>{d.repo}{d.pr ? `#${d.pr}` : ''}</> },
    { key: 'outcome', label: 'Outcome', sortable: true, render: (_, d) => <span className={`dlv ${d.outcome}`}>{d.outcome}</span> },
    { key: 'runId', label: 'Detail', render: (_, d) => <span className="small">{d.runId ? <a href={`#/runs/${d.runId}`}>{d.runId}</a> : <span className="muted">{d.reason ?? ''}</span>}</span> },
  ];

  const triggerOptions = rows.map((t) => ({ value: t.id, label: t.id }));

  return (
    <div className="triggers-page">
      <div className="crew-head">
        <h2>Triggers</h2>
        <p className="muted">A trigger starts a workflow when a GitHub pull request arrives. Pause one to keep it without acting on PRs. Deliveries (including ignored ones) are logged below.</p>
        <Button variant="primary" onClick={() => openForm()}>+ New trigger</Button>
      </div>

      {loading ? (
        <p className="muted">Loading triggers…</p>
      ) : (
        <>
          {list.error && !list.data ? (
            <div className="alert error" role="alert">
              {list.error}{' '}
              <Button variant="secondary" size="sm" onClick={() => void list.refresh()}>Retry</Button>
            </div>
          ) : rows.length ? (
            <div className="trig-scroll">
              <SortableDataTable<TriggerRow> rows={rows as TriggerRow[]} columns={triggerColumns} rowKey="id" caption="Triggers" />
            </div>
          ) : (
            <p className="muted">No triggers yet. Add one, then set up the webhook below (or run <code>aorch pr watch</code> to poll instead).</p>
          )}

          {form ? (
            <form className="trigger-form" aria-label={editing ? 'Edit trigger' : 'New trigger'} onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <h3>{editing ? `Edit ${form.id}` : 'New trigger'}</h3>
              <div className="trig-grid">
                <Input label="Repo" required value={form.repo} placeholder="owner/repo, or * for any mapped repo" spellCheck={false} onChange={(e) => patch({ repo: e.target.value })} />
                <div>
                  <Input label="Workflow" required list="trig-workflows" value={form.workflow} spellCheck={false} onChange={(e) => patch({ workflow: e.target.value })} />
                  <datalist id="trig-workflows">{workflows.map((w) => <option key={w} value={w} />)}</datalist>
                </div>
                {workspaces.length ? (
                  <Select
                    label="Workspace"
                    value={form.workspace || NONE}
                    onValueChange={(v) => patch({ workspace: fromNone(v) })}
                    options={[
                      { value: NONE, label: 'none' },
                      ...(form.workspace && !workspaces.some((w) => w.id === form.workspace) ? [{ value: form.workspace, label: `${form.workspace} (not found)` }] : []),
                      ...workspaces.map((w) => ({ value: w.id, label: `${w.name || w.id}${w.isDefault ? ' (default)' : ''}${w.exists ? '' : ' (folder missing)'}` })),
                    ]}
                  />
                ) : (
                  <Input label="Workspace" value={form.workspace} placeholder="workspace id (optional)" onChange={(e) => patch({ workspace: e.target.value })} />
                )}
                <Select
                  label="Agent"
                  value={form.agent || NONE}
                  onValueChange={(v) => patch({ agent: fromNone(v), model: '' })}
                  options={[
                    { value: NONE, label: 'crew defaults' },
                    ...(form.agent && !(form.agent in agents) ? [{ value: form.agent, label: `${form.agent} (unknown)` }] : []),
                    ...Object.keys(agents).map((a) => ({ value: a, label: `${a}${agents[a]!.ok ? '' : ' (not available)'}` })),
                  ]}
                />
                <div>
                  <Input label="Model" list="trig-models" value={form.model} placeholder="adapter default" spellCheck={false} onChange={(e) => patch({ model: e.target.value })} />
                  <datalist id="trig-models">{agentModels.map((m) => <option key={m} value={m} />)}</datalist>
                </div>
                <div>
                  <Input label="Events" list="trig-events" value={form.events} placeholder="default: opened, synchronize, reopened, ready_for_review" spellCheck={false} onChange={(e) => patch({ events: e.target.value })} />
                  <datalist id="trig-events">{EVENTS.map((m) => <option key={m} value={m} />)}</datalist>
                </div>
                <Input label="Only with labels" value={form.labels} placeholder="comma separated; empty = any PR" spellCheck={false} onChange={(e) => patch({ labels: e.target.value })} />
                <Input label="Id" value={form.id} disabled={editing} placeholder="auto: repo-workflow" spellCheck={false} onChange={(e) => patch({ id: e.target.value })} />
              </div>
              <div className="row trig-checks">
                <Checkbox label="post the result as a PR comment" checked={form.comment} onCheckedChange={(c) => patch({ comment: c === true })} />
                <Checkbox label="include drafts" checked={form.drafts} onCheckedChange={(c) => patch({ drafts: c === true })} />
                <Checkbox label="include forks" checked={form.forks} onCheckedChange={(c) => patch({ forks: c === true })} />
              </div>
              <div className="row">
                <Button variant="primary" type="submit" disabled={!form.repo.trim() || !form.workflow.trim()}>Save</Button>
                <Button variant="secondary" type="button" onClick={() => setForm(null)}>Cancel</Button>
              </div>
            </form>
          ) : null}

          <div className="trig-panels">
            <section className="trig-panel trigger-test" aria-label="Test a trigger">
              <h3>Test a trigger</h3>
              <p className="muted small">Paste a PR link (or a number for a single-repo trigger). A dry run only reports what would happen. Event filters are not checked, since GitHub supplies the action on real events.</p>
              {rows.length ? (
                <>
                  <div className="row wrap">
                    <Select label="Trigger to test" value={testId} onValueChange={setTestId} options={triggerOptions} />
                    <Input className="grow" label="Pull request" placeholder="https://github.com/owner/repo/pull/12" value={testPr} spellCheck={false} onChange={(e) => setTestPr(e.target.value)} />
                  </div>
                  <div className="row wrap">
                    <Button variant="primary" disabled={testing || !testPr.trim() || !testId} onClick={() => void runTest(false)}>Dry run</Button>
                    {/* Keyed on the PR so editing it cancels a pending "fire" question, as in the Solid screen. */}
                    <ConfirmButton key={testPr} variant="secondary" label="Fire for real…" prompt="Start a real run on this PR?" confirmLabel="Yes, fire" disabled={testing || !testPr.trim() || !testId} onConfirm={() => runTest(true)} />
                    {testing ? <span className="muted small">asking GitHub…</span> : null}
                  </div>
                  {testErr ? <p className="trig-result bad" role="alert">{testErr}</p> : null}
                  {result ? (
                    <p className={cn('trig-result', { good: result.matches, bad: !result.matches })} role="status">
                      <b>{result.pr.repo}#{result.pr.number}</b> <span className="muted">"{result.pr.title.slice(0, 70)}"</span><br />
                      {result.fired ? `Started run ${result.runId}. ` : result.matches ? 'Would start a run. Nothing was started (dry run). ' : 'Would be ignored: '}
                      {result.matches ? '' : result.why}
                      {result.runId ? <> <a href={`#/runs/${result.runId}`}>Open the run</a></> : null}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted small">Add a trigger first.</p>
              )}
            </section>

            <section className="trig-panel" aria-label="Webhook setup">
              <h3>Webhook setup</h3>
              <p className="muted small">GitHub → repo → Settings → Webhooks → Add webhook. This server only listens on this machine, so expose just the webhook path with a tunnel (<code>cloudflared tunnel --url http://127.0.0.1:4177</code>, ngrok or tailscale funnel). No tunnel? <code>aorch pr watch</code> polls instead.</p>
              {setupErr ? (
                <div className="alert error" role="alert">
                  {setupErr}{' '}
                  <Button variant="secondary" size="sm" onClick={() => void loadSetup()}>Retry</Button>
                </div>
              ) : null}
              <dl className="trig-setup">
                <dt>Payload URL</dt>
                <dd><code>{payloadUrl}</code> <CopyButton value={payloadUrl} label="Copy" variant="outline" onCopied={copied} /></dd>
                <dt>Content type</dt><dd><code>{setup?.contentType ?? 'application/json'}</code></dd>
                <dt>Events</dt><dd>Let me select individual events → <b>{(setup?.eventsToSelect ?? ['Pull requests']).join(', ')}</b></dd>
                <dt>Secret</dt>
                <dd>
                  {secret ? (
                    <>
                      <code className="secret">{secret}</code> <CopyButton value={secret} label="Copy" variant="outline" onCopied={copied} />
                      <p className="small trig-warn">Copy this into GitHub now. It will not be shown again.</p>
                    </>
                  ) : setup?.hasSecret ? (
                    <>
                      <code>{setup.secretHint ? `••••••••${setup.secretHint}` : '••••••••'}</code> <span className="muted small">{setup.secretSource === 'env' ? 'from AORCH_WEBHOOK_SECRET' : 'stored; shown only when generated'}</span>
                    </>
                  ) : (
                    <span className="muted">none yet</span>
                  )}
                </dd>
              </dl>
              <div className="row wrap">
                {setup?.secretSource !== 'env' ? (
                  setup?.hasSecret ? (
                    <ConfirmButton variant="secondary" label="Regenerate secret" prompt="Existing webhooks stop working until you paste the new secret." confirmLabel="Regenerate" onConfirm={regenerate} />
                  ) : (
                    <Button variant="secondary" onClick={() => void regenerate()}>Generate secret</Button>
                  )
                ) : null}
                {secret ? <Button variant="ghost" onClick={() => setSecret('')}>Hide</Button> : null}
              </div>
            </section>
          </div>

          <section className="trig-panel trig-log" aria-label="Delivery log">
            <div className="row wrap">
              <h3>Deliveries</h3>
              <Select label="Show" value={logFor || NONE} onValueChange={(v) => setLogFor(fromNone(v))} options={[{ value: NONE, label: 'all triggers' }, ...triggerOptions]} />
              <Button variant="secondary" onClick={() => void log.refresh()}>Refresh</Button>
            </div>
            {log.error && !log.data ? (
              <div className="alert error" role="alert">
                {log.error}{' '}
                <Button variant="secondary" size="sm" onClick={() => void log.refresh()}>Retry</Button>
              </div>
            ) : (
              <div className="trig-scroll">
                <SortableDataTable<DeliveryRow>
                  rows={deliveries as DeliveryRow[]}
                  columns={deliveryColumns}
                  rowKey={(d) => `${d.at}-${d.trigger ?? ''}-${d.pr ?? ''}`}
                  caption="Deliveries"
                  emptyMessage="No deliveries yet"
                />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
