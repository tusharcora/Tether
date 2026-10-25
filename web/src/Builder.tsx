import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Edge, Pipeline, PipelineNode } from '../../src/types';
import { api, type Issue } from './api';
import { Canvas } from './Canvas';
import { Button } from './components/arc/button/button';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Input } from './components/arc/input/input';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Select } from './components/arc/select/select';
import { Textarea } from './components/arc/textarea/textarea';
import { ModeToggle } from './Team';
import { NONE } from './ui/cn';
import { useNotify } from './ui/notify';
import { Palette, type EccSkill } from './builder/Palette';
import { SettingsForm, StepForm, type Adapters } from './builder/Inspector';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import { StatusChip } from './ui/studio/StatusChip';
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
export function Builder(props: { pipeline?: string; onStarted: (runId: string) => void; gate?: { run: string; env?: string }; onGateUsed?: () => void }) {
  const notify = useNotify();
  const phone = useMediaQuery(PHONE);
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
  const [endpoints, setEndpoints] = useState(true);
  const [busy, setBusy] = useState(false);
  const [teamRun, setTeamRun] = useState(false);
  const [teamMode, setTeamMode] = useState<'live' | 'autonomous'>('live');
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [loaded, setLoaded] = useState(false);
  // a gate's command while it runs a request instead, so switching back to Command restores it
  const parkedCommands = useRef<Record<string, string>>({});

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
      const r = await api<{ id: string }>('POST', '/api/runs', teamRun ? { kind: 'team', mode: teamMode, task, repo, ...off } : { pipeline: pl, task, repo, autoApprove: auto, ...off });
      setRunOpen(false);
      props.onStarted(r.id);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const saved = names.some((n) => n.name === pl.name);
  const loops = pl.nodes.filter((n) => n.fixNode).length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const issueTone = errors.length ? 'failed' : issues.length ? 'needs' : 'done';
  const issueLabel = errors.length ? plural(errors.length, 'error') : issues.length ? plural(issues.length, 'warning') : 'valid';
  const validName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pl.name);

  return (
    <div className="bl-page">
      <ScreenHeader
        meta={`workflows / ${pl.name || 'untitled'} · ${plural(pl.nodes.length, 'step')} · ${plural(loops, 'fix loop')}`}
        title={pl.name || 'untitled'}
        actions={
          <>
            <Select
              label="Workflow"
              options={[{ value: NONE, label: '— unsaved —' }, ...names.map((n) => ({ value: n.name, label: n.name }))]}
              value={saved ? pl.name : NONE}
              onValueChange={(v) => v !== NONE && pick(v)}
            />
            {phone ? null : <Input className="bl-name" label="Pipeline name" value={pl.name} spellCheck={false} onChange={(e) => mut((p) => (p.name = e.target.value.trim()))} />}
            <button type="button" className="bl-issues-toggle" aria-expanded={showIssues} title="Show or hide the issue list" onClick={() => setShowIssues(!showIssues)}>
              <StatusChip tone={issueTone} label={issueLabel} />
            </button>
            {phone ? null : (
              <>
                <span className="bl-saved">{dirty ? 'Unsaved changes' : 'Saved'}</span>
                <Button variant="secondary" onClick={fresh}>
                  New
                </Button>
                <Button variant="secondary" onClick={save} disabled={!dirty || !validName}>
                  Save
                </Button>
              </>
            )}
            <Button variant="primary" disabled={errors.length > 0 || pl.nodes.length === 0} onClick={() => setRunOpen(true)}>
              Run <Play size={12} aria-hidden="true" />
            </Button>
          </>
        }
      />

      {showIssues && issues.length ? (
        <ul className="bl-issues" aria-label="Preflight issues">
          {issues.map((i, k) => (
            <li key={k}>
              <StatusChip tone={i.level === 'error' ? 'failed' : 'needs'} label={i.level} />
              {i.node && !phone ? (
                <button type="button" className="bl-issue-node" onClick={() => setSelected(i.node)}>
                  {i.node}
                </button>
              ) : null}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {phone ? <p className="bl-phone-note">Editing needs a wider screen. You can look around and run this workflow.</p> : null}
      <div className="bl-body">
        {phone ? null : <Palette onAdd={addNode} skills={skills} onSkill={(s) => void addSkill(s)} />}

        <Canvas
          editable={!phone}
          fitKey={opened}
          hint={phone ? 'Drag to pan · use + / − to zoom' : 'Click a palette step to add it · drag a right port to a left port to connect · Delete removes'}
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

        {phone ? null : (
          <aside className="bl-inspector" aria-label="Step inspector">
            {sel ? (
              <StepForm node={sel} pl={pl} adapters={adapters} patch={patch} onGateKind={setGateKind} onDelete={removeNode} onSettings={() => setSelected(undefined)} />
            ) : (
              <SettingsForm pl={pl} mut={mut} />
            )}
          </aside>
        )}
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
            className="bl-form"
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
    </div>
  );
}
