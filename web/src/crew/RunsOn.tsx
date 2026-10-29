import { useId } from 'react';
import { Button } from '../components/beui/kit/Button';
import { Input, Switch } from '../components/beui/kit/fields';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Picker } from '../components/bencho/Picker';
import { NONE, fromNone } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { StatusBadge } from '../ui/studio/StatusBadge';
import { ModelPicker } from './ModelPicker';
import type { AgentInfo, Binding, Row } from './types';

/** Which agent and model a bot runs on. A step with no agent of its own follows its bot. On OpenRouter the model comes from its tagged list. */
export function RunsOn(p: { row: Row; agents: Record<string, AgentInfo>; draft: Binding; dirty: boolean; onChange: (b: Partial<Binding>) => void; onSave: () => void; onUnlink: () => void; /** The bot never edits files (a chat-only model is fine for it). */ readOnly?: boolean }) {
  const id = useId();
  if (p.row.kind === 'approval')
    return (
      <section className="cw-runs-on" aria-labelledby={id}>
        <SectionHeading id={id} title="Runs on" />
        <p className="sl-meta">A person signs off here. Nothing to link.</p>
      </section>
    );
  const chosen = p.agents[p.draft.agent];
  const runsOn = p.draft.agent || 'claude';
  const route = p.agents[runsOn]?.codeMode;
  return (
    <section className="cw-runs-on" aria-labelledby={id}>
      <SectionHeading id={id} title="Runs on" action={chosen && !chosen.ok ? <StatusBadge tone="needs" label="agent not available" /> : undefined} />
      <p className="sl-meta">A step with no agent of its own follows its bot; a step that names one keeps it. Changes apply to the next run you start.</p>
      <div className="cw-pair">
        <Picker
          label="Agent"
          options={[{ id: NONE, name: 'default (claude)' }, ...Object.keys(p.agents).map((a) => ({ id: a, name: a, hint: p.agents[a]!.ok ? undefined : 'not available' }))]}
          value={[p.draft.agent || NONE]}
          onChange={([v]) => p.onChange({ agent: fromNone(v ?? NONE), model: '' })}
        />
        {p.draft.agent === 'openrouter' ? (
          <ModelPicker value={p.draft.model} agents={p.agents} writes={!p.readOnly} onPick={(b) => p.onChange(b)} />
        ) : (
          <Input label="Model" list={`models-${p.row.role}`} value={p.draft.model} placeholder="adapter default" spellCheck={false} onChange={(e) => p.onChange({ model: e.target.value })} />
        )}
      </div>
      <p className="sl-meta">Local models (Ollama, LM Studio, llama.cpp) appear in Agent when their server is running.</p>
      <datalist id={`models-${p.row.role}`}>
        {(chosen?.models ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <SegmentedControl
        label="Tool calls"
        options={[
          { value: 'code', label: 'Code Mode' },
          { value: 'direct', label: 'Direct' },
        ]}
        value={p.draft.toolStyle}
        onValueChange={(v) => p.onChange({ toolStyle: v === 'direct' ? 'direct' : 'code', ...(v === 'direct' ? { codeReads: false } : {}) })}
      />
      {p.draft.toolStyle === 'code' ? (
        route === null ? (
          <p className="sl-meta cw-fallback">{runsOn} has no per-run route for Code Mode, so this bot’s steps run direct (its own tools only).</p>
        ) : (
          <>
            <p className="sl-meta">One run_code tool: the agent composes reads, searches and connector calls (GitHub, saved requests, your MCP servers) in a short script.</p>
            {route === 'native' ? <p className="sl-meta cw-hint">Small models may do better with Direct tool calls.</p> : null}
            {runsOn === 'claude' ? <Switch label="Code Mode only for reading (Claude Code loses Grep and Glob, so it explores through run_code)" checked={p.draft.codeReads} onCheckedChange={(c) => p.onChange({ codeReads: c === true })} /> : null}
          </>
        )
      ) : null}
      <div className="cw-actions">
        <Button variant="secondary" size="sm" disabled={!p.dirty} onClick={p.onSave}>
          Save agent
        </Button>
        {p.row.binding ? (
          <Button variant="ghost" size="sm" onClick={p.onUnlink}>
            Unlink
          </Button>
        ) : null}
      </div>
    </section>
  );
}
