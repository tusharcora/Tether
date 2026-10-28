import { ChevronDown, Copy, Pencil, Play, Trash2 } from 'lucide-react';
import { useCreateIntent } from './ui/useCreateIntent';
import { useEffect, useRef, useState } from 'react';
import type { Edge, Pipeline, PipelineNode } from '../../src/types';
import { api, type Issue } from './api';
import { Canvas, NODE_H } from './Canvas';
import type { NodeAction } from './components/bencho/ActionNode';
import { Button } from './components/beui/kit/Button';
import { Checkbox, Input } from './components/beui/kit/fields';
import { Dialog, DialogContent } from './components/beui/kit/overlays';
import { SegmentedControl } from './components/beui/kit/controls';
import { Textarea } from './components/kept/textarea/textarea';
import { ModeToggle } from './Team';
import { useNotify } from './ui/notify';
import { AddStepBar, AddStepMenu, type EccSkill } from './builder/Palette';
import { SettingsForm, StepForm, StepHead, type Adapters } from './builder/Inspector';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import { StatusBadge } from './ui/studio/StatusBadge';
import { Dock, FloatBar, MenuButton, ToolScreen, type MenuItem } from './ui/studio/ToolFrame';
import './builder/builder.css';

const BLANK: Pipeline = {
  name: 'untitled',
  version: 1,
  mode: 'pipeline',
  nodes: [],
  edges: [],
  settings: { parallel: 4, nodeTimeoutMs: 30 * 60_000, pipeMode: 'ancestors' },
};

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

/**
 * `gate`: a saved request handed over from the API tab ("Use as gate in a workflow"); once the first workflow has
 * loaded it is appended as a request gate chained after the last step, and `onGateUsed` is called so the shell can clear it.
 */
export function Builder(props: { pipeline?: string; onStarted: (runId: string) => void; gate?: { run: string; env?: string }; onGateUsed?: () => void; /** The Create menu asked for a new workflow (a counter). */ create?: number }) {
  const notify = useNotify();
  const phone = useMediaQuery(PHONE);
  const [pl, setPl] = useState<Pipeline>(() => structuredClone(BLANK));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(BLANK));
  const [names, setNames] = useState<{ name: string; nodes: number }[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  /** The dock shows the selected step, else (when asked) the workflow settings. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [adapters, setAdapters] = useState<Adapters>({});
  const [runOpen, setRunOpen] = useState(false);
  const [repo, setRepo] = useState('');
  const [task, setTask] = useState('');
  const [auto, setAuto] = useState(false);
  const [endpoints, setEndpoints] = useState(true);
  const [busy, setBusy] = useState(false);
  const [teamRun, setTeamRun] = useState(false);
  const [teamMode, setTeamMode] = useState<'live' | 'autonomous'>('live');
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [loaded, setLoaded] = useState(false);
  // "Run from here": the run dialog is for this step and everything after it
  const [fromStep, setFromStep] = useState<string | undefined>();
  // a gate's command while it runs a request instead, so switching back to Command restores it
  const parkedCommands = useRef<Record<string, string>>({});

  const dirty = JSON.stringify(pl) !== savedJson;
  const errors = issues.filter((i) => i.level === 'error');
  const issueNodes = new Set(issues.filter((i) => i.level === 'error' && i.node).map((i) => i.node!));
  const sel = pl.nodes.find((n) => n.id === selected);

  /** Selecting a step (or nothing) puts the step in the dock instead of the workflow settings. */
  const select = (id?: string) => (setSelected(id), setSettingsOpen(false));
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
  // bumped whenever a workflow opens, so the canvas fits it to the view (the last step isn't left off-screen)
  const [opened, setOpened] = useState(0);
  async function load(name: string) {
    try {
      const r = await api<{ pipeline: Pipeline }>('GET', `/api/pipelines/${encodeURIComponent(name)}`);
      setPl(r.pipeline);
      setSavedJson(JSON.stringify(r.pipeline));
      setSelected(undefined);
      setOpened((n) => n + 1);
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
      setOpened((n) => n + 1);
    });

  useCreateIntent(props.create, loaded, fresh);

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
      setLoaded(true);
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

  // ECC skills and commands, offered as ready-made steps (an empty list hides the section)
  const [skills, setSkills] = useState<EccSkill[]>([]);
  useEffect(() => {
    api<EccSkill[]>('GET', '/api/skills?source=ecc')
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);
  async function addSkill(s: EccSkill) {
    try {
      const r = await api<{ name: string; prompt: string }>('GET', `/api/skills/ecc/${encodeURIComponent(s.name)}`);
      addNode(() => ({ kind: 'agent', role: 'coder', title: r.name.slice(0, 24), prompt: r.prompt }));
    } catch (e) {
      notify.fail(e);
    }
  }

  /** `after`: the step to follow (a click on a palette card's "after the selected step"); by default the new step chains onto the last one. */
  function addNode(make: () => Partial<PipelineNode>, after?: string) {
    const base = make();
    let id = idBase(base);
    for (let i = 2; pl.nodes.some((n) => n.id === id); i++) id = `${idBase(base)}${i}`;
    mut((p) => {
      const anchor = after ? p.nodes.find((n) => n.id === after) : undefined;
      const right = anchor ? anchor.x + 260 : p.nodes.length ? Math.max(...p.nodes.map((n) => n.x)) + 260 : 60;
      const y = anchor ? anchor.y : p.nodes.length ? p.nodes.find((n) => n.x === right - 260)!.y : 140;
      p.nodes.push({ id, kind: 'agent', x: right, y, ...base } as PipelineNode);
      // chain onto the chosen step, else the previous one: the common case, and easy to rewire
      const prev = anchor ?? (p.nodes.length > 1 ? p.nodes[p.nodes.length - 2] : undefined);
      if (prev && p.mode === 'pipeline') p.edges.push({ from: prev.id, to: id });
    });
    setSelected(id);
  }

  // "Use as gate in a workflow" from the API tab: append a prefilled request gate once the workflow has loaded
  const gateDone = useRef<unknown>(null);
  useEffect(() => {
    const g = props.gate;
    if (!g || !loaded || gateDone.current === g) return;
    gateDone.current = g;
    addNode(() => ({ kind: 'gate', title: g.run.split('/').at(-1), http: { run: g.run, ...(g.env ? { env: g.env } : {}) }, maxLoops: 2 }));
    props.onGateUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.gate, loaded]);

  /** A gate runs exactly one of a shell command or a saved request. */
  function setGateKind(n: PipelineNode, kind: string) {
    if (kind === 'request') {
      if (n.http) return;
      if (n.command) parkedCommands.current[n.id] = n.command;
      patch(n.id, { command: undefined, http: { run: '' } });
    } else {
      if (!n.http) return;
      patch(n.id, { http: undefined, command: parkedCommands.current[n.id] ?? 'npm test' });
    }
  }

  /** A copy of a step, a little below it, with the same settings and no connections of its own. */
  function duplicate(id: string) {
    const src = pl.nodes.find((n) => n.id === id);
    if (!src) return;
    const stem = src.id.replace(/-copy\d*$/, '');
    let copy = `${stem}-copy`;
    for (let i = 2; pl.nodes.some((n) => n.id === copy); i++) copy = `${stem}-copy${i}`;
    mut((p) => {
      p.nodes.push({ ...structuredClone(src), id: copy, x: src.x + 24, y: src.y + NODE_H + 28 });
    });
    setSelected(copy);
  }

  /** A step and every step that follows it. */
  const fromHere = (id: string): Pipeline => {
    const keep = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of pl.edges) if (keep.has(e.from) && !keep.has(e.to)) (keep.add(e.to), (grew = true));
    }
    const nodes = pl.nodes.filter((n) => keep.has(n.id)).map((n) => (n.fixNode && !keep.has(n.fixNode) ? { ...n, fixNode: undefined } : n));
    return { ...pl, name: `${pl.name}-from-${id}`.slice(0, 64), nodes, edges: pl.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  };
  const stepCount = fromStep ? fromHere(fromStep).nodes.length : 0;

  /** The corner actions of a step's card. */
  const nodeActions = (id: string): NodeAction[] => [
    { id: 'run', label: 'Run from here', icon: <Play size={14} aria-hidden="true" />, disabled: errors.length > 0, onSelect: () => (setFromStep(id), setTeamRun(false), setRunOpen(true)) },
    { id: 'edit', label: 'Edit step', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => select(id) },
    { id: 'duplicate', label: 'Duplicate step', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => duplicate(id) },
    { id: 'delete', label: 'Delete step', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => removeNode(id) },
  ];

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
      const off = endpoints ? {} : { endpoints: false };
      const r = await api<{ id: string }>('POST', '/api/runs', teamRun ? { kind: 'team', mode: teamMode, task, repo, ...off } : { pipeline: fromStep ? fromHere(fromStep) : pl, task, repo, autoApprove: auto, ...off });
      setRunOpen(false);
      props.onStarted(r.id);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const saved = names.some((n) => n.name === pl.name);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const issueTone = errors.length ? 'failed' : issues.length ? 'needs' : 'done';
  const issueLabel = errors.length ? plural(errors.length, 'error') : issues.length ? plural(issues.length, 'warning') : 'valid';
  const validName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pl.name);

  const workflows: (MenuItem | 'rule')[] = [...names.map((n) => ({ label: n.name, current: saved && n.name === pl.name, onSelect: () => pick(n.name) })), ...(phone ? [] : ['rule' as const, { label: 'New workflow', onSelect: fresh }])];

  return (
    <ToolScreen className="bl-screen">
      <h1 className="sl-sr">{pl.name || 'untitled'}</h1>
      <Canvas
        editable={!phone}
        fitKey={opened}
        hint={phone ? 'Drag to pan · use + / − to zoom' : undefined}
        nodes={pl.nodes}
        edges={pl.edges}
        selected={selected}
        issueNodes={issueNodes}
        onSelect={select}
        onMove={(id, x, y) => patch(id, { x, y })}
        onConnect={connect}
        onDeleteEdge={(f, t) => mut((p) => (p.edges = p.edges.filter((e) => !(e.from === f && e.to === t))))}
        onDeleteNode={removeNode}
        nodeActions={phone ? undefined : nodeActions}
      />

      <FloatBar at="left">
        {phone ? <span className="bl-name">{pl.name || 'untitled'}</span> : <input className="bl-name" aria-label="Pipeline name" value={pl.name} spellCheck={false} onChange={(e) => mut((p) => (p.name = e.target.value.trim()))} />}
        <MenuButton title="Workflows" label={<ChevronDown size={14} aria-hidden="true" />} items={workflows} />
        <span className="bl-saved">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <button type="button" className="bl-issues-toggle" aria-expanded={showIssues} title="Show or hide the issue list" onClick={() => setShowIssues(!showIssues)}>
          <StatusBadge tone={issueTone} label={issueLabel} />
        </button>
      </FloatBar>
      {showIssues && issues.length ? (
        <ul className="bl-issues" aria-label="Preflight issues">
          {issues.map((i, k) => (
            <li key={k}>
              <StatusBadge tone={i.level === 'error' ? 'failed' : 'needs'} label={i.level} />
              {i.node && !phone ? (
                <button type="button" className="bl-issue-node" onClick={() => select(i.node)}>
                  {i.node}
                </button>
              ) : null}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <FloatBar at="right">
        {pl.settings.maxCostUsd ? <span className="bl-cap">{`$${pl.settings.maxCostUsd} cap`}</span> : null}
        {phone ? null : (
          <Button variant="secondary" size="sm" aria-pressed={settingsOpen} onClick={() => (setSelected(undefined), setSettingsOpen(!settingsOpen))}>
            Settings
          </Button>
        )}
        {!phone && dirty ? (
          <Button variant="secondary" size="sm" onClick={save} disabled={!validName}>
            Save
          </Button>
        ) : null}
        <Button variant="primary" size="sm" disabled={errors.length > 0 || pl.nodes.length === 0} onClick={() => (setFromStep(undefined), setRunOpen(true))}>
          Run <Play size={12} aria-hidden="true" />
        </Button>
      </FloatBar>

      {phone ? <p className="bl-phone-note">Editing needs a wider screen. You can look around and run this workflow.</p> : <AddStepBar onMenu={() => setAdding(true)} onAdd={addNode} />}
      {phone ? null : sel ? (
        <Dock label="Step editor" head={<StepHead node={sel} />} onClose={() => select(undefined)}>
          <StepForm node={sel} pl={pl} adapters={adapters} patch={patch} onGateKind={setGateKind} onDelete={removeNode} />
        </Dock>
      ) : settingsOpen ? (
        <Dock label="Workflow settings" head={<h2 className="bl-step-title">Workflow settings</h2>} onClose={() => setSettingsOpen(false)}>
          <SettingsForm pl={pl} mut={mut} />
        </Dock>
      ) : null}
      <AddStepMenu open={adding} onOpenChange={setAdding} selected={selected} skills={skills} onAdd={addNode} onSkill={(s) => void addSkill(s)} />

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
        <DialogContent title={teamRun ? 'Start a team run' : fromStep ? `Run “${pl.name}” from ${fromStep}` : `Run “${pl.name}”`}>
          <form
            className="bl-form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            {fromStep && !teamRun ? <p className="muted small">Runs this step and the {stepCount - 1 === 1 ? '1 step' : `${stepCount - 1} steps`} after it. Earlier steps are skipped, so this step starts without their output.</p> : null}
            <SegmentedControl
              label="Run type"
              options={[
                { value: 'workflow', label: 'Workflow' },
                { value: 'team', label: 'Team' },
              ]}
              value={teamRun ? 'team' : 'workflow'}
              onValueChange={(v) => (setTeamRun(v === 'team'), v === 'team' && setFromStep(undefined))}
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
            <Checkbox label="Tell agents about this project's saved API requests" checked={endpoints} onCheckedChange={(c) => setEndpoints(c === true)} />
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
    </ToolScreen>
  );
}
