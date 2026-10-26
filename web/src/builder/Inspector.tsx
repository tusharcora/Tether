import type { Pipeline, PipelineNode } from '../../../src/types';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Select } from '../components/arc/select/select';
import { Switch } from '../components/arc/switch/switch';
import { Textarea } from '../components/arc/textarea/textarea';
import { crewFor, useCrew } from '../crewStore';
import { Face } from '../Face';
import { RequestGateFields } from '../RequestGateFields';
import { NONE, fromNone } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';

export type Adapters = Record<string, { ok: boolean; version?: string; detail?: string }>;

const ROLES = ['planner', 'architect', 'coder', 'reviewer', 'tester'];
const KIND_LINE: Record<string, string> = {
  agent: 'Agent step',
  gate: 'Gate · must pass before the next step',
  approval: 'Approval · pauses until a person signs off',
};

export const settingsSummary = (p: Pipeline): string =>
  `mode ${p.mode} · ${p.settings.parallel} parallel read-only · ${Math.round(p.settings.nodeTimeoutMs / 60000)} min timeout${p.settings.maxCostUsd ? ` · $${p.settings.maxCostUsd} cap` : ''}`;

export function SettingsForm({ pl, mut }: { pl: Pipeline; mut: (fn: (p: Pipeline) => void) => void }) {
  return (
    <div className="bl-form">
      <SectionHeading title="Pipeline settings" />
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
      <Input label="Setup command (runs once in the worktree)" value={pl.settings.setup ?? ''} placeholder="npm ci" spellCheck={false} onChange={(e) => mut((p) => (p.settings.setup = e.target.value || undefined))} />
      <p className="bl-help">Click a step to edit it. Drag from a right-hand port to a left-hand port to connect. Select an edge or step and press Delete to remove it.</p>
    </div>
  );
}

export function StepForm(props: {
  node: PipelineNode;
  pl: Pipeline;
  adapters: Adapters;
  patch: (id: string, v: Partial<PipelineNode>) => void;
  onGateKind: (n: PipelineNode, kind: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}) {
  const { node: n, pl, adapters, patch } = props;
  const { crew } = useCrew();
  const agentIds = Object.keys(adapters);
  const agentOptions = agentIds.includes(n.agent ?? '') || !n.agent ? agentIds : [...agentIds, n.agent];
  const fixCandidates = pl.nodes.filter((x) => x.kind === 'agent' && x.id !== n.id);
  const flag = (label: string, on: boolean, set: (on: boolean) => void) => (
    <div className="bl-switch">
      <Switch label={label} checked={on} onCheckedChange={set} />
    </div>
  );
  return (
    <div className="bl-form">
      <div className="bl-step-head">
        <Face id={crewFor(n, crew)} size={44} />
        <div>
          <h2 className="bl-step-title">{n.title ?? n.role ?? n.kind}</h2>
          <p className="bl-step-kind">
            <span>{KIND_LINE[n.kind] ?? n.kind}</span> · <code>{n.id}</code>
          </p>
        </div>
      </div>
      <Input label="Label" value={n.title ?? ''} onChange={(e) => patch(n.id, { title: e.target.value })} />
      {n.kind === 'agent' ? (
        <>
          <Input label="Role" list="roles" value={n.role ?? ''} onChange={(e) => patch(n.id, { role: e.target.value })} />
          <datalist id="roles">
            {ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <div className="bl-pair">
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
          </div>
          <Textarea label="Instructions (blank = default for the role)" rows={6} value={n.prompt ?? ''} onChange={(e) => patch(n.id, { prompt: e.target.value })} />
          <SegmentedControl
            label="Tool calls"
            options={[
              { value: 'follow', label: 'Follow bot' },
              { value: 'code', label: 'Code Mode' },
              { value: 'direct', label: 'Direct' },
            ]}
            value={n.toolStyle ?? 'follow'}
            onValueChange={(v) => patch(n.id, { toolStyle: v === 'code' || v === 'direct' ? v : undefined })}
          />
          <p className="sl-meta bl-help">Code Mode: one run_code tool that composes reads, searches and connector calls in a short script (fewer round-trips and tokens). Direct: the agent’s own tools only.</p>
          {flag('Read-only (changes are reverted and fail the step)', !!n.readOnly, (c) => patch(n.id, { readOnly: c || undefined }))}
          {flag('Include the current diff in its prompt', !!n.includeDiff, (c) => patch(n.id, { includeDiff: c || undefined }))}
          {flag('Must end with VERDICT: PASS / FAIL', !!n.verdict, (c) => patch(n.id, { verdict: c || undefined }))}
          {flag('Use knowledge-graph context', n.vault !== false, (c) => patch(n.id, { vault: c ? undefined : false }))}
        </>
      ) : null}
      {n.kind === 'gate' ? (
        <>
          <SegmentedControl
            label="The gate runs"
            options={[
              { value: 'command', label: 'Command' },
              { value: 'request', label: 'Request' },
            ]}
            value={n.http ? 'request' : 'command'}
            onValueChange={(v) => props.onGateKind(n, v)}
          />
          {n.http ? (
            <RequestGateFields key={n.id} http={n.http} onChange={(h) => patch(n.id, { http: h })} />
          ) : (
            <Input label="Command (exit 0 = pass)" value={n.command ?? ''} spellCheck={false} onChange={(e) => patch(n.id, { command: e.target.value })} />
          )}
        </>
      ) : null}
      {n.kind !== 'approval' && (n.kind === 'gate' || n.verdict) ? (
        <>
          <Select
            label="On failure, send the output back to"
            options={[{ value: NONE, label: '— nobody (fail the run) —' }, ...fixCandidates.map((c) => ({ value: c.id, label: `${c.title ?? c.role ?? c.id} (${c.id})` }))]}
            value={n.fixNode ?? NONE}
            onValueChange={(v) => patch(n.id, { fixNode: fromNone(v) })}
          />
          {n.fixNode ? <Input label="Max fix loops" type="number" min="1" max="10" value={n.maxLoops ?? 2} onChange={(e) => patch(n.id, { maxLoops: Number(e.target.value) || 1 })} /> : null}
        </>
      ) : null}
      <Button variant="danger" onClick={() => props.onDelete(n.id)}>
        Delete step
      </Button>
      <button type="button" className="bl-settings-line" onClick={props.onSettings}>
        Pipeline settings: {settingsSummary(pl)}
      </button>
    </div>
  );
}
