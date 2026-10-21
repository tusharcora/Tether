import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api, ago } from './api';

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

export function Triggers() {
  // a keyed store: the 5s poll updates changed fields in place instead of rebuilding rows (keeps focus)
  const [rowStore, setRowStore] = createStore<{ list: Trigger[] }>({ list: [] });
  const rows = () => rowStore.list;
  const setRows = (t: Trigger[]) => setRowStore('list', reconcile(t, { key: 'id' }));
  const [workspaces, setWorkspaces] = createSignal<Workspace[]>([]);
  const [agents, setAgents] = createSignal<Record<string, { ok: boolean; models: string[] }>>({});
  const [workflows, setWorkflows] = createSignal<string[]>([]);
  const [log, setLog] = createSignal<Delivery[]>([]);
  const [logFor, setLogFor] = createSignal<string>('');
  const [setup, setSetup] = createSignal<Setup | null>(null);
  const [secret, setSecret] = createSignal('');
  const [confirmRegen, setConfirmRegen] = createSignal(false);
  const [form, setForm] = createSignal<Form | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [confirmDel, setConfirmDel] = createSignal('');
  const [msg, setMsgRaw] = createSignal('');
  let msgTimer: ReturnType<typeof setTimeout> | undefined;
  const setMsg = (m: string) => {
    clearTimeout(msgTimer);
    setMsgRaw(m);
    if (m) msgTimer = setTimeout(() => setMsgRaw(''), 5000);
  };
  const [loading, setLoading] = createSignal(true);
  const [testId, setTestId] = createSignal('');
  const [testPr, setTestPr] = createSignal('');
  const [testing, setTesting] = createSignal(false);
  const [result, setResult] = createSignal<TestResult | null>(null);
  const [testErr, setTestErr] = createSignal('');
  const [fireAsk, setFireAsk] = createSignal(false);

  const fail = (e: unknown) => setMsg((e as Error).message);
  async function loadLog() {
    try {
      const q = logFor() ? `?trigger=${encodeURIComponent(logFor())}&limit=50` : '?limit=50';
      const next = await api<Delivery[]>('GET', `/api/triggers/deliveries${q}`);
      if (JSON.stringify(next) !== JSON.stringify(log())) setLog(next);
    } catch (e) {
      fail(e);
    }
  }
  async function load() {
    try {
      const t = await api<Trigger[]>('GET', '/api/triggers');
      setRows(t);
      if (!testId() || !t.some((x) => x.id === testId())) setTestId(t[0]?.id ?? '');
      setSetup(await api<Setup>('GET', '/api/triggers/setup'));
      await loadLog();
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }
  onMount(() => {
    void load();
    void api<Workspace[]>('GET', '/api/workspaces').then(setWorkspaces).catch(() => undefined);
    void api<{ name: string }[]>('GET', '/api/pipelines').then((p) => setWorkflows(p.map((x) => x.name))).catch(() => undefined);
    void api<{ agents: Record<string, { ok: boolean; models: string[] }> }>('GET', '/api/bots').then((r) => setAgents(r.agents)).catch(() => undefined);
    const t = setInterval(() => void (async () => { try { setRows(await api<Trigger[]>('GET', '/api/triggers')); await loadLog(); } catch { /* next tick */ } })(), 5000);
    onCleanup(() => (clearInterval(t), clearTimeout(msgTimer)));
  });

  const patch = (p: Partial<Form>) => setForm({ ...form()!, ...p });
  const openForm = (t?: Trigger) => {
    setForm(t ? fromTrigger(t) : blank());
    setEditing(!!t);
    setTimeout(() => document.querySelector('.trigger-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  async function save() {
    const f = form()!;
    try {
      const body = { ...f, events: f.events.split(',').map((x) => x.trim()).filter(Boolean), labels: f.labels.split(',').map((x) => x.trim()).filter(Boolean) };
      const t = await api<Trigger>('POST', '/api/triggers', body);
      setForm(null);
      setMsg(`${t.id} saved${t.warnings?.length ? '. ' + t.warnings.join(' ') : ''}`);
      await load();
    } catch (e) {
      fail(e);
    }
  }
  async function toggle(t: Trigger) {
    try {
      await api('PATCH', `/api/triggers/${encodeURIComponent(t.id)}`, { enabled: t.enabled === false });
      await load();
    } catch (e) {
      fail(e);
    }
  }
  async function remove(id: string) {
    try {
      await api('DELETE', `/api/triggers/${encodeURIComponent(id)}`);
      setConfirmDel('');
      if (logFor() === id) setLogFor('');
      setMsg(`${id} deleted`);
      await load();
    } catch (e) {
      fail(e);
    }
  }
  async function runTest(fire: boolean) {
    setTesting(true);
    setTestErr('');
    setResult(null);
    setFireAsk(false);
    try {
      setResult(await api<TestResult>('POST', `/api/triggers/${encodeURIComponent(testId())}/test`, { pr: testPr().trim(), fire }));
      if (fire) await load();
    } catch (e) {
      setTestErr((e as Error).message);
      if (fire) await load();
    } finally {
      setTesting(false);
    }
  }
  async function regenerate() {
    try {
      const r = await api<{ secret: string }>('POST', '/api/triggers/setup/secret');
      setSecret(r.secret);
      setConfirmRegen(false);
      setSetup(await api<Setup>('GET', '/api/triggers/setup'));
    } catch (e) {
      fail(e);
      setConfirmRegen(false);
    }
  }
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => setMsg('copied'), () => setMsg('could not copy; select the text instead'));
  const who = (t: Trigger) => (t.agent ? `${t.agent}${t.model ? ' · ' + t.model : ''}` : t.model ? `default · ${t.model}` : 'crew defaults');
  const agentModels = () => agents()[form()?.agent ?? '']?.models ?? [];
  const payloadUrl = () => `https://<your tunnel>${setup()?.payloadPath ?? '/api/webhooks/github'}`;

  return (
    <div class="triggers-page">
      <div class="crew-head">
        <h2>Triggers</h2>
        <p class="muted">A trigger starts a workflow when a GitHub pull request arrives. Pause one to keep it without acting on PRs. Deliveries (including ignored ones) are logged below.</p>
        <button class="primary" onClick={() => openForm()}>+ New trigger</button>
        <Show when={msg()}><span class="chip" role="status">{msg()}</span></Show>
      </div>

      <Show when={!loading()} fallback={<p class="muted">Loading triggers…</p>}>
        <Show when={rows().length} fallback={<p class="muted">No triggers yet. Add one, then set up the webhook below (or run <code>aorch pr watch</code> to poll instead).</p>}>
          <div class="trig-scroll">
            <table class="trig-table">
              <thead>
                <tr><th /><th>Trigger</th><th>Repo → workflow</th><th>Workspace</th><th>Agent / model</th><th>Events</th><th>Last delivery</th><th>On</th><th /></tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(t) => (
                    <tr classList={{ paused: t.enabled === false }}>
                      <td><span class={`dot ${t.status}`} title={statusTip[t.status]} role="img" aria-label={t.status} /></td>
                      <td><b>{t.id}</b><div class="muted small">{t.status}</div></td>
                      <td>{t.repo} <span class="muted">→</span> <code>{t.workflow}</code>{t.comment ? <span class="chip" title="posts the result on the PR"> comments</span> : null}</td>
                      <td class="muted">{t.workspace ?? 'none'}</td>
                      <td class="muted">{who(t)}</td>
                      <td class="muted small">{(t.events ?? ['opened', 'synchronize', 'reopened', 'ready_for_review']).join(', ')}</td>
                      <td>
                        <Show when={t.last} fallback={<span class="muted small">no deliveries</span>}>
                          <span class={`dlv ${t.last!.outcome}`}>{t.last!.outcome}</span> <span class="muted small">{t.last!.pr ? `#${t.last!.pr} · ` : ''}{ago(Date.parse(t.last!.at))}</span>
                        </Show>
                      </td>
                      <td>
                        <button class="switch" role="switch" aria-checked={t.enabled !== false} aria-label={`${t.enabled === false ? 'Enable' : 'Pause'} ${t.id}`} classList={{ on: t.enabled !== false }} onClick={() => void toggle(t)}><i /></button>
                      </td>
                      <td>
                        <div class="row trig-actions">
                          <Show when={confirmDel() !== t.id} fallback={
                            <>
                              <span class="small">Delete {t.id}?</span>
                              <button class="danger" onClick={() => void remove(t.id)}>Delete</button>
                              <button onClick={() => setConfirmDel('')}>Cancel</button>
                            </>
                          }>
                            <button onClick={() => { setTestId(t.id); document.querySelector('.trigger-test')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Test</button>
                            <button onClick={() => { setLogFor(t.id); void loadLog(); }}>Log</button>
                            <button onClick={() => openForm(t)}>Edit</button>
                            <button class="danger" onClick={() => setConfirmDel(t.id)}>Delete</button>
                          </Show>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={form()}>
          <form class="trigger-form" aria-label={editing() ? 'Edit trigger' : 'New trigger'} onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <h3>{editing() ? `Edit ${form()!.id}` : 'New trigger'}</h3>
            <div class="trig-grid">
              <label>Repo<input required value={form()!.repo} placeholder="owner/repo, or * for any mapped repo" spellcheck={false} onInput={(e) => patch({ repo: e.currentTarget.value })} /></label>
              <label>Workflow
                <input required list="trig-workflows" value={form()!.workflow} spellcheck={false} onInput={(e) => patch({ workflow: e.currentTarget.value })} />
                <datalist id="trig-workflows"><For each={workflows()}>{(w) => <option value={w} />}</For></datalist>
              </label>
              <label>Workspace
                <Show when={workspaces().length} fallback={<input value={form()!.workspace} placeholder="workspace id (optional)" onInput={(e) => patch({ workspace: e.currentTarget.value })} />}>
                  <select value={form()!.workspace} onChange={(e) => patch({ workspace: e.currentTarget.value })}>
                    <option value="">none</option>
                    <Show when={form()!.workspace && !workspaces().some((w) => w.id === form()!.workspace)}><option value={form()!.workspace}>{form()!.workspace} (not found)</option></Show>
                    <For each={workspaces()}>{(w) => <option value={w.id}>{w.name || w.id}{w.isDefault ? ' (default)' : ''}{w.exists ? '' : ' (folder missing)'}</option>}</For>
                  </select>
                </Show>
              </label>
              <label>Agent
                <select value={form()!.agent} onChange={(e) => patch({ agent: e.currentTarget.value, model: '' })}>
                  <option value="">crew defaults</option>
                  <Show when={form()!.agent && !(form()!.agent in agents())}><option value={form()!.agent}>{form()!.agent} (unknown)</option></Show>
                  <For each={Object.keys(agents())}>{(a) => <option value={a}>{a}{agents()[a]!.ok ? '' : ' (not available)'}</option>}</For>
                </select>
              </label>
              <label>Model
                <input list="trig-models" value={form()!.model} placeholder="adapter default" spellcheck={false} onInput={(e) => patch({ model: e.currentTarget.value })} />
                <datalist id="trig-models"><For each={agentModels()}>{(m) => <option value={m} />}</For></datalist>
              </label>
              <label>Events
                <input list="trig-events" value={form()!.events} placeholder="default: opened, synchronize, reopened, ready_for_review" spellcheck={false} onInput={(e) => patch({ events: e.currentTarget.value })} />
                <datalist id="trig-events"><For each={EVENTS}>{(m) => <option value={m} />}</For></datalist>
              </label>
              <label>Only with labels<input value={form()!.labels} placeholder="comma separated; empty = any PR" spellcheck={false} onInput={(e) => patch({ labels: e.currentTarget.value })} /></label>
              <label>Id<input value={form()!.id} disabled={editing()} placeholder="auto: repo-workflow" spellcheck={false} onInput={(e) => patch({ id: e.currentTarget.value })} /></label>
            </div>
            <div class="row trig-checks">
              <label class="check"><input type="checkbox" checked={form()!.comment} onChange={(e) => patch({ comment: e.currentTarget.checked })} /> post the result as a PR comment</label>
              <label class="check"><input type="checkbox" checked={form()!.drafts} onChange={(e) => patch({ drafts: e.currentTarget.checked })} /> include drafts</label>
              <label class="check"><input type="checkbox" checked={form()!.forks} onChange={(e) => patch({ forks: e.currentTarget.checked })} /> include forks</label>
            </div>
            <div class="row">
              <button class="primary" type="submit" disabled={!form()!.repo.trim() || !form()!.workflow.trim()}>Save</button>
              <button type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </Show>

        <div class="trig-panels">
          <section class="trig-panel trigger-test" aria-label="Test a trigger">
            <h3>Test a trigger</h3>
            <p class="muted small">Paste a PR link (or a number for a single-repo trigger). A dry run only reports what would happen. Event filters are not checked, since GitHub supplies the action on real events.</p>
            <Show when={rows().length} fallback={<p class="muted small">Add a trigger first.</p>}>
              <div class="row wrap">
                <select aria-label="Trigger to test" value={testId()} onChange={(e) => setTestId(e.currentTarget.value)}>
                  <For each={rows()}>{(t) => <option value={t.id}>{t.id}</option>}</For>
                </select>
                <input class="grow" aria-label="Pull request" placeholder="https://github.com/owner/repo/pull/12" value={testPr()} spellcheck={false} onInput={(e) => { setTestPr(e.currentTarget.value); setFireAsk(false); }} />
              </div>
              <div class="row wrap">
                <button class="primary" disabled={testing() || !testPr().trim() || !testId()} onClick={() => void runTest(false)}>Dry run</button>
                <Show when={!fireAsk()} fallback={
                  <>
                    <span class="small">Start a real run on this PR?</span>
                    <button class="danger" disabled={testing()} onClick={() => void runTest(true)}>Yes, fire</button>
                    <button onClick={() => setFireAsk(false)}>Cancel</button>
                  </>
                }>
                  <button disabled={testing() || !testPr().trim() || !testId()} onClick={() => setFireAsk(true)}>Fire for real…</button>
                </Show>
                <Show when={testing()}><span class="muted small">asking GitHub…</span></Show>
              </div>
              <Show when={testErr()}><p class="trig-result bad" role="alert">{testErr()}</p></Show>
              <Show when={result()}>
                <p class="trig-result" classList={{ good: result()!.matches, bad: !result()!.matches }} role="status">
                  <b>{result()!.pr.repo}#{result()!.pr.number}</b> <span class="muted">"{result()!.pr.title.slice(0, 70)}"</span><br />
                  {result()!.fired ? `Started run ${result()!.runId}. ` : result()!.matches ? 'Would start a run. Nothing was started (dry run). ' : 'Would be ignored: '}
                  {result()!.matches ? '' : result()!.why}
                  <Show when={result()!.runId}> <a href={`#/runs/${result()!.runId}`}>Open the run</a></Show>
                </p>
              </Show>
            </Show>
          </section>

          <section class="trig-panel" aria-label="Webhook setup">
            <h3>Webhook setup</h3>
            <p class="muted small">GitHub → repo → Settings → Webhooks → Add webhook. This server only listens on this machine, so expose just the webhook path with a tunnel (<code>cloudflared tunnel --url http://127.0.0.1:4177</code>, ngrok or tailscale funnel). No tunnel? <code>aorch pr watch</code> polls instead.</p>
            <dl class="trig-setup">
              <dt>Payload URL</dt>
              <dd><code>{payloadUrl()}</code> <button onClick={() => copy(payloadUrl())}>Copy</button></dd>
              <dt>Content type</dt><dd><code>{setup()?.contentType ?? 'application/json'}</code></dd>
              <dt>Events</dt><dd>Let me select individual events → <b>{(setup()?.eventsToSelect ?? ['Pull requests']).join(', ')}</b></dd>
              <dt>Secret</dt>
              <dd>
                <Show when={secret()} fallback={
                  <Show when={setup()?.hasSecret} fallback={<span class="muted">none yet</span>}>
                    <code>{setup()!.secretHint ? `••••••••${setup()!.secretHint}` : '••••••••'}</code> <span class="muted small">{setup()!.secretSource === 'env' ? 'from AORCH_WEBHOOK_SECRET' : 'stored; shown only when generated'}</span>
                  </Show>
                }>
                  <code class="secret">{secret()}</code> <button onClick={() => copy(secret())}>Copy</button>
                  <p class="small trig-warn">Copy this into GitHub now. It will not be shown again.</p>
                </Show>
              </dd>
            </dl>
            <div class="row wrap">
              <Show when={setup()?.secretSource !== 'env'}>
                <Show when={!confirmRegen()} fallback={
                  <>
                    <span class="small">{setup()?.hasSecret ? 'Existing webhooks stop working until you paste the new secret.' : 'Create a secret?'}</span>
                    <button class="danger" onClick={() => void regenerate()}>{setup()?.hasSecret ? 'Regenerate' : 'Generate'}</button>
                    <button onClick={() => setConfirmRegen(false)}>Cancel</button>
                  </>
                }>
                  <button onClick={() => (setup()?.hasSecret ? setConfirmRegen(true) : void regenerate())}>{setup()?.hasSecret ? 'Regenerate secret' : 'Generate secret'}</button>
                </Show>
              </Show>
              <Show when={secret()}><button onClick={() => setSecret('')}>Hide</button></Show>
            </div>
          </section>
        </div>

        <section class="trig-panel trig-log" aria-label="Delivery log">
          <div class="row wrap">
            <h3>Deliveries</h3>
            <select aria-label="Filter deliveries" value={logFor()} onChange={(e) => { setLogFor(e.currentTarget.value); void loadLog(); }}>
              <option value="">all triggers</option>
              <For each={rows()}>{(t) => <option value={t.id}>{t.id}</option>}</For>
            </select>
            <button onClick={() => void loadLog()}>Refresh</button>
          </div>
          <Show when={log().length} fallback={<p class="muted small">Nothing has arrived yet. Webhooks, polling and tests record every PR they see, including the ones they ignore.</p>}>
            <div class="trig-scroll">
              <table class="trig-table">
                <thead><tr><th>When</th><th>Outcome</th><th>Source</th><th>Trigger</th><th>PR</th><th>Detail</th></tr></thead>
                <tbody>
                  <For each={log()}>
                    {(d) => (
                      <tr>
                        <td class="muted small" title={d.at}>{ago(Date.parse(d.at))}</td>
                        <td><span class={`dlv ${d.outcome}`}>{d.outcome}</span></td>
                        <td class="muted small">{d.source}</td>
                        <td class="muted small">{d.trigger ?? '-'}</td>
                        <td>{d.repo}{d.pr ? `#${d.pr}` : ''}</td>
                        <td class="small">{d.runId ? <a href={`#/runs/${d.runId}`}>{d.runId}</a> : <span class="muted">{d.reason ?? ''}</span>}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      </Show>
    </div>
  );
}
