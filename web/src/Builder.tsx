import { For, Show, createEffect, createSignal, on, onMount } from 'solid-js';
import type { Edge, Pipeline, PipelineNode } from '../../src/types';
import { api, type Issue } from './api';
import { Canvas } from './Canvas';
import { CREW, crewFor } from './bots';

const PALETTE: { label: string; hint: string; make: () => Partial<PipelineNode> }[] = [
  { label: 'Planner', hint: 'read-only: plans the change', make: () => ({ kind: 'agent', role: 'planner', readOnly: true }) },
  { label: 'Architect', hint: 'read-only: reviews the plan', make: () => ({ kind: 'agent', role: 'architect', readOnly: true }) },
  { label: 'Coder', hint: 'edits files; each attempt is committed', make: () => ({ kind: 'agent', role: 'coder' }) },
  { label: 'Reviewer', hint: 'sees the diff; ends with VERDICT', make: () => ({ kind: 'agent', role: 'reviewer', readOnly: true, verdict: true, includeDiff: true }) },
  { label: 'Gate', hint: 'a shell command that must exit 0', make: () => ({ kind: 'gate', title: 'tests', command: 'npm test', maxLoops: 2 }) },
  { label: 'Approval', hint: 'pauses the run until a human signs off', make: () => ({ kind: 'approval', title: 'approve' }) },
];

const BLANK: Pipeline = {
  name: 'untitled',
  version: 1,
  mode: 'pipeline',
  nodes: [],
  edges: [],
  settings: { parallel: 4, nodeTimeoutMs: 30 * 60_000, pipeMode: 'ancestors' },
};

const ROLES = ['planner', 'architect', 'coder', 'reviewer', 'tester'];

function wouldCycle(edges: Edge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const e of edges) if (e.from === n) stack.push(e.to);
  }
  return false;
}

const idBase = (n: Partial<PipelineNode>) => (n.kind === 'gate' ? 'gate' : n.kind === 'approval' ? 'approve' : (n.role ?? 'step').slice(0, 6));

export function Builder(props: { onStarted: (runId: string) => void }) {
  const [pl, setPl] = createSignal<Pipeline>(structuredClone(BLANK));
  const [savedJson, setSavedJson] = createSignal(JSON.stringify(BLANK));
  const [names, setNames] = createSignal<{ name: string; nodes: number }[]>([]);
  const [selected, setSelected] = createSignal<string | undefined>();
  const [issues, setIssues] = createSignal<Issue[]>([]);
  const [showIssues, setShowIssues] = createSignal(false);
  const [adapters, setAdapters] = createSignal<Record<string, { ok: boolean; version?: string; detail?: string }>>({});
  const [toast, setToast] = createSignal<string | undefined>();
  const [runOpen, setRunOpen] = createSignal(false);
  const [repo, setRepo] = createSignal('');
  const [task, setTask] = createSignal('');
  const [auto, setAuto] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const dirty = () => JSON.stringify(pl()) !== savedJson();
  const errors = () => issues().filter((i) => i.level === 'error');
  const issueNodes = () => new Set(issues().filter((i) => i.level === 'error' && i.node).map((i) => i.node!));
  const sel = () => pl().nodes.find((n) => n.id === selected());

  let toastTimer: number | undefined;
  const say = (m: string) => {
    setToast(m);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(undefined), 3500);
  };

  function mut(fn: (p: Pipeline) => void) {
    const p = structuredClone(pl());
    fn(p);
    setPl(p);
  }
  const patch = (id: string, v: Partial<PipelineNode>) =>
    mut((p) => {
      const n = p.nodes.find((x) => x.id === id);
      if (!n) return;
      for (const [k, val] of Object.entries(v)) (val === undefined || val === '' ? delete (n as any)[k] : ((n as any)[k] = val));
    });

  async function refreshList() {
    try {
      setNames(await api('GET', '/api/pipelines'));
    } catch (e) {
      say((e as Error).message);
    }
  }
  async function load(name: string) {
    try {
      const r = await api<{ pipeline: Pipeline }>('GET', `/api/pipelines/${encodeURIComponent(name)}`);
      setPl(r.pipeline);
      setSavedJson(JSON.stringify(r.pipeline));
      setSelected(undefined);
    } catch (e) {
      say((e as Error).message);
    }
  }
  function pick(name: string) {
    if (dirty() && !confirm('Discard unsaved changes?')) return;
    void load(name);
  }
  function fresh() {
    if (dirty() && !confirm('Discard unsaved changes?')) return;
    const p = structuredClone(BLANK);
    setPl(p);
    setSavedJson(JSON.stringify(p));
    setSelected(undefined);
  }

  onMount(async () => {
    try {
      setRepo(localStorage.getItem('aorch.repo') ?? '');
    } catch {
      /* storage unavailable */
    }
    api('GET', '/api/doctor').then(setAdapters).catch(() => {});
    await refreshList();
    const first = names().find((n) => n.name === 'plan-code-review') ?? names()[0];
    if (first) await load(first.name);
  });

  // live preflight: validates as you edit, and flags the offending nodes on the canvas
  createEffect(
    on(pl, (p) => {
      const h = window.setTimeout(async () => {
        try {
          setIssues((await api<{ issues: Issue[] }>('POST', '/api/preflight', p)).issues);
        } catch (e) {
          setIssues([{ level: 'error', message: (e as Error).message }]);
        }
      }, 300);
      return () => clearTimeout(h);
    }),
  );

  function addNode(make: () => Partial<PipelineNode>) {
    const base = make();
    mut((p) => {
      let id = idBase(base);
      for (let i = 2; p.nodes.some((n) => n.id === id); i++) id = `${idBase(base)}${i}`;
      const right = p.nodes.length ? Math.max(...p.nodes.map((n) => n.x)) + 260 : 60;
      const y = p.nodes.length ? p.nodes.find((n) => n.x === right - 260)!.y : 140;
      p.nodes.push({ id, kind: 'agent', x: right, y, ...base } as PipelineNode);
      // chain onto the previous step by default: the common case, and easy to rewire
      const prev = p.nodes.length > 1 ? p.nodes[p.nodes.length - 2] : undefined;
      if (prev && p.mode === 'pipeline') p.edges.push({ from: prev.id, to: id });
      setSelected(id);
    });
  }

  function connect(from: string, to: string) {
    if (from === to) return;
    if (pl().edges.some((e) => e.from === from && e.to === to)) return say('Already connected.');
    if (wouldCycle(pl().edges, from, to)) return say('That would create a cycle.');
    mut((p) => p.edges.push({ from, to }));
  }

  function removeNode(id: string) {
    mut((p) => {
      p.nodes = p.nodes.filter((n) => n.id !== id);
      p.edges = p.edges.filter((e) => e.from !== id && e.to !== id);
      for (const n of p.nodes) if (n.fixNode === id) delete n.fixNode;
    });
    setSelected(undefined);
  }

  async function save() {
    try {
      const r = await api<{ pipeline: Pipeline }>('PUT', `/api/pipelines/${encodeURIComponent(pl().name)}`, pl());
      setPl(r.pipeline);
      setSavedJson(JSON.stringify(r.pipeline));
      await refreshList();
      say(`Saved "${r.pipeline.name}".`);
    } catch (e) {
      say((e as Error).message);
    }
  }

  async function start() {
    setBusy(true);
    try {
      try {
        localStorage.setItem('aorch.repo', repo());
      } catch {
        /* ignore */
      }
      const r = await api<{ id: string }>('POST', '/api/runs', { pipeline: pl(), task: task(), repo: repo(), autoApprove: auto() });
      setRunOpen(false);
      props.onStarted(r.id);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const agentIds = () => Object.keys(adapters());
  const fixCandidates = () => pl().nodes.filter((n) => n.kind === 'agent' && n.id !== selected());

  return (
    <div class="builder">
      <div class="toolbar">
        <select value={names().some((n) => n.name === pl().name) ? pl().name : ''} onChange={(e) => e.currentTarget.value && pick(e.currentTarget.value)} aria-label="Saved pipelines">
          <option value="">{names().some((n) => n.name === pl().name) ? '' : '— unsaved —'}</option>
          <For each={names()}>{(n) => <option value={n.name}>{n.name}</option>}</For>
        </select>
        <button onClick={fresh}>New</button>
        <input
          class="name"
          value={pl().name}
          onInput={(e) => mut((p) => (p.name = e.currentTarget.value.trim()))}
          aria-label="Pipeline name"
          spellcheck={false}
        />
        <span class="spacer" />
        <button class="pill" classList={{ bad: errors().length > 0, warn: errors().length === 0 && issues().length > 0 }} onClick={() => setShowIssues(!showIssues())}>
          {errors().length ? `${errors().length} error${errors().length > 1 ? 's' : ''}` : issues().length ? `${issues().length} warning${issues().length > 1 ? 's' : ''}` : 'valid'}
        </button>
        <button onClick={save} disabled={!dirty() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pl().name)}>
          {dirty() ? 'Save' : 'Saved'}
        </button>
        <button class="primary" disabled={errors().length > 0 || pl().nodes.length === 0} onClick={() => setRunOpen(true)}>
          Run ▸
        </button>
      </div>

      <Show when={showIssues() && issues().length}>
        <ul class="issues">
          <For each={issues()}>
            {(i) => (
              <li class={i.level}>
                <b>{i.level}</b> {i.node ? <code>{i.node}</code> : null} {i.message}
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="builder-body">
        <aside class="palette">
          <h4>Steps</h4>
          <For each={PALETTE}>
            {(p) => (
              <button class="palette-item" title={p.hint} onClick={() => addNode(p.make)}>
                <span>{p.label}</span>
                <small>{p.hint}</small>
              </button>
            )}
          </For>
        </aside>

        <Canvas
          editable
          nodes={pl().nodes}
          edges={pl().edges}
          selected={selected()}
          issueNodes={issueNodes()}
          onSelect={setSelected}
          onMove={(id, x, y) => patch(id, { x, y })}
          onConnect={connect}
          onDeleteEdge={(f, t) => mut((p) => (p.edges = p.edges.filter((e) => !(e.from === f && e.to === t))))}
          onDeleteNode={removeNode}
        />

        <aside class="inspector">
          <Show
            when={sel()}
            fallback={
              <div class="form">
                <h4>Pipeline settings</h4>
                <label>
                  Mode
                  <select value={pl().mode} onChange={(e) => mut((p) => (p.mode = e.currentTarget.value as Pipeline['mode']))}>
                    <option value="pipeline">pipeline</option>
                    <option value="swarm" disabled title="No scheduler in this build">swarm (not built yet)</option>
                    <option value="orchestration" disabled title="No scheduler in this build">orchestration (not built yet)</option>
                  </select>
                </label>
                <label>
                  Parallel read-only steps
                  <input type="number" min="1" max="16" value={pl().settings.parallel} onInput={(e) => mut((p) => (p.settings.parallel = Number(e.currentTarget.value) || 1))} />
                </label>
                <label>
                  Step timeout (minutes)
                  <input type="number" min="1" value={Math.round(pl().settings.nodeTimeoutMs / 60000)} onInput={(e) => mut((p) => (p.settings.nodeTimeoutMs = (Number(e.currentTarget.value) || 1) * 60000))} />
                </label>
                <label>
                  Spend cap (USD, optional)
                  <input type="number" min="0" step="0.5" value={pl().settings.maxCostUsd ?? ''} onInput={(e) => mut((p) => (p.settings.maxCostUsd = e.currentTarget.value ? Number(e.currentTarget.value) : undefined))} />
                </label>
                <label>
                  Upstream output
                  <select value={pl().settings.pipeMode} onChange={(e) => mut((p) => (p.settings.pipeMode = e.currentTarget.value as 'ancestors' | 'direct'))}>
                    <option value="ancestors">all ancestors</option>
                    <option value="direct">direct parents only</option>
                  </select>
                </label>
                <label>
                  Setup command (runs once in the worktree)
                  <input value={pl().settings.setup ?? ''} placeholder="npm ci" spellcheck={false} onInput={(e) => mut((p) => (p.settings.setup = e.currentTarget.value || undefined))} />
                </label>
                <p class="muted small">Click a step to edit it. Drag from a right-hand port to a left-hand port to connect. Select an edge or step and press Delete to remove it.</p>
              </div>
            }
          >
            {(n) => (
              <div class="form">
                <h4>
                  {n().title ?? n().role ?? n().kind} <code>{n().id}</code>
                </h4>
                <label>
                  Label
                  <input value={n().title ?? ''} onInput={(e) => patch(n().id, { title: e.currentTarget.value })} />
                </label>
                <Show when={n().kind === 'agent'}>
                  <label>
                    Role
                    <input list="roles" value={n().role ?? ''} onInput={(e) => patch(n().id, { role: e.currentTarget.value })} />
                    <datalist id="roles">
                      <For each={ROLES}>{(r) => <option value={r} />}</For>
                    </datalist>
                  </label>
                  <label>
                    Agent
                    <select value={n().agent ?? ''} onChange={(e) => patch(n().id, { agent: e.currentTarget.value || undefined })}>
                      <option value="">follow {CREW[crewFor(n())]?.name ?? 'its bot'} (set in Crew)</option>
                      <For each={agentIds().includes(n().agent ?? '') || !n().agent ? agentIds() : [...agentIds(), n().agent!]}>
                        {(a) => (
                          <option value={a}>
                            {a}
                            {adapters()[a] && !adapters()[a]!.ok ? ' (not installed)' : ''}
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                  <label>
                    Model (optional)
                    <input value={n().model ?? ''} placeholder="adapter default" spellcheck={false} onInput={(e) => patch(n().id, { model: e.currentTarget.value })} />
                  </label>
                  <label>
                    Instructions (blank = default for the role)
                    <textarea rows="6" value={n().prompt ?? ''} onInput={(e) => patch(n().id, { prompt: e.currentTarget.value })} />
                  </label>
                  <label class="check">
                    <input type="checkbox" checked={!!n().readOnly} onChange={(e) => patch(n().id, { readOnly: e.currentTarget.checked || undefined })} />
                    Read-only (changes are reverted and fail the step)
                  </label>
                  <label class="check">
                    <input type="checkbox" checked={!!n().includeDiff} onChange={(e) => patch(n().id, { includeDiff: e.currentTarget.checked || undefined })} />
                    Include the current diff in its prompt
                  </label>
                  <label class="check">
                    <input type="checkbox" checked={!!n().verdict} onChange={(e) => patch(n().id, { verdict: e.currentTarget.checked || undefined })} />
                    Must end with VERDICT: PASS / FAIL
                  </label>
                  <label class="check">
                    <input type="checkbox" checked={n().vault !== false} onChange={(e) => patch(n().id, { vault: e.currentTarget.checked ? undefined : false })} />
                    Use knowledge-graph context
                  </label>
                </Show>
                <Show when={n().kind === 'gate'}>
                  <label>
                    Command (exit 0 = pass)
                    <input value={n().command ?? ''} spellcheck={false} onInput={(e) => patch(n().id, { command: e.currentTarget.value })} />
                  </label>
                </Show>
                <Show when={n().kind !== 'approval'}>
                  <Show when={n().kind === 'gate' || n().verdict}>
                    <label>
                      On failure, send the output back to
                      <select value={n().fixNode ?? ''} onChange={(e) => patch(n().id, { fixNode: e.currentTarget.value })}>
                        <option value="">— nobody (fail the run) —</option>
                        <For each={fixCandidates()}>{(c) => <option value={c.id}>{c.title ?? c.role ?? c.id} ({c.id})</option>}</For>
                      </select>
                    </label>
                    <Show when={n().fixNode}>
                      <label>
                        Max fix loops
                        <input type="number" min="1" max="10" value={n().maxLoops ?? 2} onInput={(e) => patch(n().id, { maxLoops: Number(e.currentTarget.value) || 1 })} />
                      </label>
                    </Show>
                  </Show>
                </Show>
                <button class="danger" onClick={() => removeNode(n().id)}>
                  Delete step
                </button>
              </div>
            )}
          </Show>
        </aside>
      </div>

      <Show when={toast()}>
        <div class="toast" role="status">{toast()}</div>
      </Show>

      <Show when={runOpen()}>
        <div class="modal-bg" onClick={() => setRunOpen(false)}>
          <form
            class="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <h3>Run “{pl().name}”</h3>
            <label>
              Git repository (absolute path on this machine)
              <input required value={repo()} onInput={(e) => setRepo(e.currentTarget.value)} placeholder="/home/you/code/my-app" spellcheck={false} />
            </label>
            <label>
              Task
              <textarea required rows="5" value={task()} onInput={(e) => setTask(e.currentTarget.value)} placeholder="Add rate limiting to POST /orders" />
            </label>
            <label class="check">
              <input type="checkbox" checked={auto()} onChange={(e) => setAuto(e.currentTarget.checked)} />
              Auto-approve approval steps (skips the human sign-off)
            </label>
            <p class="muted small">
              Runs in an isolated git worktree on its own branch; your checkout is never touched. Agents run with this machine's permissions.
            </p>
            <div class="row end">
              <button type="button" onClick={() => setRunOpen(false)}>Cancel</button>
              <button class="primary" type="submit" disabled={busy() || !repo() || !task().trim()}>
                {busy() ? 'Starting…' : 'Start run'}
              </button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  );
}
