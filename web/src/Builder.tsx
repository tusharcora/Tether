import { useEffect, useRef, useState } from 'react';
import type { Edge, Pipeline, PipelineNode } from '../../src/types';
import { api, type Issue } from './api';
import { Canvas } from './Canvas';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Input } from './components/arc/input/input';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Select } from './components/arc/select/select';
import { Textarea } from './components/arc/textarea/textarea';
import { crewFor, useCrew } from './crewStore';
import { ModeToggle } from './Team';
import { NONE, fromNone } from './ui/cn';
import { useNotify } from './ui/notify';

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

type Adapters = Record<string, { ok: boolean; version?: string; detail?: string }>;

export function Builder(props: { pipeline?: string; onStarted: (runId: string) => void }) {
  const notify = useNotify();
  const { crew } = useCrew();
  const [pl, setPl] = useState<Pipeline>(() => structuredClone(BLANK));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(BLANK));
  const [names, setNames] = useState<{ name: string; nodes: number }[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [adapters, setAdapters] = useState<Adapters>({});
  const [runOpen, setRunOpen] = useState(false);
  const [repo, setRepo] = useState('');
  const [task, setTask] = useState('');
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teamRun, setTeamRun] = useState(false);
  const [teamMode, setTeamMode] = useState<'live' | 'autonomous'>('live');
  const [pending, setPending] = useState<null | (() => void)>(null);

  const dirty = JSON.stringify(pl) !== savedJson;
  const errors = issues.filter((i) => i.level === 'error');
  const issueNodes = new Set(issues.filter((i) => i.level === 'error' && i.node).map((i) => i.node!));
  const sel = pl.nodes.find((n) => n.id === selected);

  /** Run `fn` now, or after the person agrees to drop their unsaved edits. */
  const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());

  function mut(fn: (p: Pipeline) => void) {
    setPl((cur) => {
      const p = structuredClone(cur);
      fn(p);
      return p;
    });
  }
  const patch = (id: string, v: Partial<PipelineNode>) =>
    mut((p) => {
      const n = p.nodes.find((x) => x.id === id);
      if (!n) return;
      for (const [k, val] of Object.entries(v)) (val === undefined || val === '' ? delete (n as any)[k] : ((n as any)[k] = val));
    });

  async function refreshList(): Promise<{ name: string; nodes: number }[]> {
    try {
      const list = await api<{ name: string; nodes: number }[]>('GET', '/api/pipelines');
      setNames(list);
      return list;
    } catch (e) {
      notify.fail(e);
      return [];
    }
  }
  async function load(name: string) {
    try {
      const r = await api<{ pipeline: Pipeline }>('GET', `/api/pipelines/${encodeURIComponent(name)}`);
      setPl(r.pipeline);
      setSavedJson(JSON.stringify(r.pipeline));
      setSelected(undefined);
    } catch (e) {
      notify.fail(e);
    }
  }
  const pick = (name: string) => guard(() => void load(name));
  const fresh = () =>
    guard(() => {
      const p = structuredClone(BLANK);
      setPl(p);
      setSavedJson(JSON.stringify(p));
      setSelected(undefined);
    });

  useEffect(() => {
    try {
      setRepo(localStorage.getItem('aorch.repo') ?? '');
    } catch {
      /* storage unavailable */
    }
    api<Adapters>('GET', '/api/doctor').then(setAdapters).catch(() => {});
    void (async () => {
      const list = await refreshList();
      const first = props.pipeline ?? (list.find((n) => n.name === 'plan-code-review') ?? list[0])?.name;
      if (first) await load(first);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a new workflow from the shell (e.g. #/builder/<id>) replaces the open one, asking first if it has edits
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (props.pipeline) guard(() => void load(props.pipeline!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pipeline]);

  // live preflight: validates once edits settle, and flags the offending nodes on the canvas
  useEffect(() => {
    const h = setTimeout(async () => {
      try {
        setIssues((await api<{ issues: Issue[] }>('POST', '/api/preflight', pl)).issues);
      } catch (e) {
        setIssues([{ level: 'error', message: (e as Error).message }]);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [pl]);

  function addNode(make: () => Partial<PipelineNode>) {
    const base = make();
    let id = idBase(base);
    for (let i = 2; pl.nodes.some((n) => n.id === id); i++) id = `${idBase(base)}${i}`;
    mut((p) => {
      const right = p.nodes.length ? Math.max(...p.nodes.map((n) => n.x)) + 260 : 60;
      const y = p.nodes.length ? p.nodes.find((n) => n.x === right - 260)!.y : 140;
      p.nodes.push({ id, kind: 'agent', x: right, y, ...base } as PipelineNode);
      // chain onto the previous step by default: the common case, and easy to rewire
      const prev = p.nodes.length > 1 ? p.nodes[p.nodes.length - 2] : undefined;
      if (prev && p.mode === 'pipeline') p.edges.push({ from: prev.id, to: id });
    });
    setSelected(id);
  }

  function connect(from: string, to: string) {
    if (from === to) return;
    if (pl.edges.some((e) => e.from === from && e.to === to)) return notify.info('Already connected.');
    if (wouldCycle(pl.edges, from, to)) return notify.info('That would create a cycle.');
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
      const r = await api<{ pipeline: Pipeline }>('PUT', `/api/pipelines/${encodeURIComponent(pl.name)}`, pl);
      setPl(r.pipeline);
      setSavedJson(JSON.stringify(r.pipeline));
      await refreshList();
      notify.ok(`Saved "${r.pipeline.name}".`);
    } catch (e) {
      notify.fail(e);
    }
  }

  async function start() {
    setBusy(true);
    try {
      try {
        localStorage.setItem('aorch.repo', repo);
      } catch {
        /* ignore */
      }
      const r = await api<{ id: string }>('POST', '/api/runs', teamRun ? { kind: 'team', mode: teamMode, task, repo } : { pipeline: pl, task, repo, autoApprove: auto });
      setRunOpen(false);
      props.onStarted(r.id);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const agentIds = Object.keys(adapters);
  const fixCandidates = pl.nodes.filter((n) => n.kind === 'agent' && n.id !== selected);
  const saved = names.some((n) => n.name === pl.name);

  const settingsForm = (
    <div className="form">
      <h4>Pipeline settings</h4>
      <Select
        label="Mode"
        options={[
          { value: 'pipeline', label: 'pipeline' },
          { value: 'swarm', label: 'swarm (not built yet)', disabled: true },
          { value: 'orchestration', label: 'orchestration (not built yet)', disabled: true },
        ]}
        value={pl.mode}
        onValueChange={(v) => mut((p) => (p.mode = v as Pipeline['mode']))}
      />
      <Input label="Parallel read-only steps" type="number" min="1" max="16" value={pl.settings.parallel} onChange={(e) => mut((p) => (p.settings.parallel = Number(e.target.value) || 1))} />
      <Input label="Step timeout (minutes)" type="number" min="1" value={Math.round(pl.settings.nodeTimeoutMs / 60000)} onChange={(e) => mut((p) => (p.settings.nodeTimeoutMs = (Number(e.target.value) || 1) * 60000))} />
      <Input
        label="Spend cap (USD, optional)"
        type="number"
        min="0"
        step="0.5"
        value={pl.settings.maxCostUsd ?? ''}
        onChange={(e) => mut((p) => (p.settings.maxCostUsd = e.target.value ? Number(e.target.value) : undefined))}
      />
      <Select
        label="Upstream output"
        options={[
          { value: 'ancestors', label: 'all ancestors' },
          { value: 'direct', label: 'direct parents only' },
        ]}
        value={pl.settings.pipeMode}
        onValueChange={(v) => mut((p) => (p.settings.pipeMode = v as 'ancestors' | 'direct'))}
      />
      <Input
        label="Setup command (runs once in the worktree)"
        value={pl.settings.setup ?? ''}
        placeholder="npm ci"
        spellCheck={false}
        onChange={(e) => mut((p) => (p.settings.setup = e.target.value || undefined))}
      />
      <p className="muted small">Click a step to edit it. Drag from a right-hand port to a left-hand port to connect. Select an edge or step and press Delete to remove it.</p>
    </div>
  );

  const nodeForm = (n: PipelineNode) => {
    const agentOptions = agentIds.includes(n.agent ?? '') || !n.agent ? agentIds : [...agentIds, n.agent];
    return (
      <div className="form">
        <h4>
          {n.title ?? n.role ?? n.kind} <code>{n.id}</code>
        </h4>
        <Input label="Label" value={n.title ?? ''} onChange={(e) => patch(n.id, { title: e.target.value })} />
        {n.kind === 'agent' ? (
          <>
            <Input label="Role" list="roles" value={n.role ?? ''} onChange={(e) => patch(n.id, { role: e.target.value })} />
            <datalist id="roles">
              {ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <Select
              label="Agent"
              options={[
                { value: NONE, label: `follow ${crew[crewFor(n, crew)]?.name ?? 'its bot'} (set in Crew)` },
                ...agentOptions.map((a) => ({ value: a, label: a + (adapters[a] && !adapters[a].ok ? ' (not installed)' : '') })),
              ]}
              value={n.agent ?? NONE}
              onValueChange={(v) => patch(n.id, { agent: fromNone(v) || undefined })}
            />
            <Input label="Model (optional)" value={n.model ?? ''} placeholder="adapter default" spellCheck={false} onChange={(e) => patch(n.id, { model: e.target.value })} />
            <Textarea label="Instructions (blank = default for the role)" rows={6} value={n.prompt ?? ''} onChange={(e) => patch(n.id, { prompt: e.target.value })} />
            <Checkbox label="Read-only (changes are reverted and fail the step)" checked={!!n.readOnly} onCheckedChange={(c) => patch(n.id, { readOnly: c === true || undefined })} />
            <Checkbox label="Include the current diff in its prompt" checked={!!n.includeDiff} onCheckedChange={(c) => patch(n.id, { includeDiff: c === true || undefined })} />
            <Checkbox label="Must end with VERDICT: PASS / FAIL" checked={!!n.verdict} onCheckedChange={(c) => patch(n.id, { verdict: c === true || undefined })} />
            <Checkbox label="Use knowledge-graph context" checked={n.vault !== false} onCheckedChange={(c) => patch(n.id, { vault: c === true ? undefined : false })} />
          </>
        ) : null}
        {n.kind === 'gate' ? <Input label="Command (exit 0 = pass)" value={n.command ?? ''} spellCheck={false} onChange={(e) => patch(n.id, { command: e.target.value })} /> : null}
        {n.kind !== 'approval' && (n.kind === 'gate' || n.verdict) ? (
          <>
            <Select
              label="On failure, send the output back to"
              options={[{ value: NONE, label: '— nobody (fail the run) —' }, ...fixCandidates.map((c) => ({ value: c.id, label: `${c.title ?? c.role ?? c.id} (${c.id})` }))]}
              value={n.fixNode ?? NONE}
              onValueChange={(v) => patch(n.id, { fixNode: fromNone(v) })}
            />
            {n.fixNode ? (
              <Input label="Max fix loops" type="number" min="1" max="10" value={n.maxLoops ?? 2} onChange={(e) => patch(n.id, { maxLoops: Number(e.target.value) || 1 })} />
            ) : null}
          </>
        ) : null}
        <Button variant="danger" onClick={() => removeNode(n.id)}>
          Delete step
        </Button>
      </div>
    );
  };

  return (
    <div className="builder">
      <div className="toolbar">
        <Select
          label="Workflow"
          options={[{ value: NONE, label: '— unsaved —' }, ...names.map((n) => ({ value: n.name, label: n.name }))]}
          value={saved ? pl.name : NONE}
          onValueChange={(v) => v !== NONE && pick(v)}
        />
        <Button variant="secondary" onClick={fresh}>
          New
        </Button>
        <Input className="name" label="Pipeline name" value={pl.name} spellCheck={false} onChange={(e) => mut((p) => (p.name = e.target.value.trim()))} />
        <span className="spacer" />
        <Button variant="ghost" size="sm" aria-expanded={showIssues} title="Show or hide the issue list" onClick={() => setShowIssues(!showIssues)}>
          <Badge tone={errors.length ? 'danger' : issues.length ? 'warning' : 'success'}>
            {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : issues.length ? `${issues.length} warning${issues.length > 1 ? 's' : ''}` : 'valid'}
          </Badge>
        </Button>
        <Button variant="secondary" onClick={save} disabled={!dirty || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pl.name)}>
          {dirty ? 'Save' : 'Saved'}
        </Button>
        <Button variant="primary" disabled={errors.length > 0 || pl.nodes.length === 0} onClick={() => setRunOpen(true)}>
          Run ▸
        </Button>
      </div>

      {showIssues && issues.length ? (
        <ul className="issues">
          {issues.map((i, k) => (
            <li key={k} className={i.level}>
              <b>{i.level}</b> {i.node ? <code>{i.node}</code> : null} {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="builder-body">
        <aside className="palette">
          <h4>Steps</h4>
          {PALETTE.map((p) => (
            <button key={p.label} className="palette-item" title={p.hint} onClick={() => addNode(p.make)}>
              <span>{p.label}</span>
              <small>{p.hint}</small>
            </button>
          ))}
        </aside>

        <Canvas
          editable
          nodes={pl.nodes}
          edges={pl.edges}
          selected={selected}
          issueNodes={issueNodes}
          onSelect={setSelected}
          onMove={(id, x, y) => patch(id, { x, y })}
          onConnect={connect}
          onDeleteEdge={(f, t) => mut((p) => (p.edges = p.edges.filter((e) => !(e.from === f && e.to === t))))}
          onDeleteNode={removeNode}
        />

        <aside className="inspector">{sel ? nodeForm(sel) : settingsForm}</aside>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent title="Discard unsaved changes?" description="Your edits to this workflow are not saved.">
          <div className="row end">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const f = pending;
                setPending(null);
                f?.();
              }}
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent title={teamRun ? 'Start a team run' : `Run “${pl.name}”`}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <SegmentedControl
              label="Run type"
              options={[
                { value: 'workflow', label: 'Workflow' },
                { value: 'team', label: 'Team' },
              ]}
              value={teamRun ? 'team' : 'workflow'}
              onValueChange={(v) => setTeamRun(v === 'team')}
            />
            {teamRun ? (
              <>
                <p className="muted small">A team of bots asks you what it needs to know, proposes a plan for your approval, then works. No pipeline needed.</p>
                <ModeToggle mode={teamMode} onPick={setTeamMode} />
              </>
            ) : null}
            <Input
              label="Git repository (absolute path on this machine)"
              required
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="/home/you/code/my-app"
              spellCheck={false}
            />
            <Textarea label="Task" required rows={5} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add rate limiting to POST /orders" />
            {!teamRun ? <Checkbox label="Auto-approve approval steps (skips the human sign-off)" checked={auto} onCheckedChange={(c) => setAuto(c === true)} /> : null}
            <p className="muted small">Runs in an isolated git worktree on its own branch; your checkout is never touched. Agents run with this machine's permissions.</p>
            <div className="row end">
              <Button type="button" variant="secondary" onClick={() => setRunOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={busy} disabled={!repo || !task.trim()}>
                Start run
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
