import { useId } from 'react';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import { Select } from '../components/arc/select/select';
import { NONE, fromNone } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { StatusChip } from '../ui/studio/StatusChip';
import type { AgentInfo, Binding, Row } from './types';

/** Which agent and model a bot runs on. A step with no agent of its own follows its bot. */
export function RunsOn(p: { row: Row; agents: Record<string, AgentInfo>; draft: Binding; dirty: boolean; onChange: (b: Partial<Binding>) => void; onSave: () => void; onUnlink: () => void }) {
  const id = useId();
  if (p.row.kind === 'approval')
    return (
      <section className="cw-runs-on" aria-labelledby={id}>
        <SectionHeading id={id} title="Runs on" />
        <p className="sl-meta">A person signs off here. Nothing to link.</p>
      </section>
    );
  const chosen = p.agents[p.draft.agent];
  return (
    <section className="cw-runs-on" aria-labelledby={id}>
      <SectionHeading id={id} title="Runs on" action={chosen && !chosen.ok ? <StatusChip tone="needs" label="agent not available" /> : undefined} />
      <p className="sl-meta">A step with no agent of its own follows its bot; a step that names one keeps it. Changes apply to the next run you start.</p>
      <div className="cw-pair">
        <Select
          label="Agent"
          options={[{ value: NONE, label: 'default (claude)' }, ...Object.keys(p.agents).map((a) => ({ value: a, label: a + (p.agents[a]!.ok ? '' : ' (not available)') }))]}
          value={p.draft.agent || NONE}
          onValueChange={(v) => p.onChange({ agent: fromNone(v), model: '' })}
        />
        <Input label="Model" list={`models-${p.row.role}`} value={p.draft.model} placeholder="adapter default" spellCheck={false} onChange={(e) => p.onChange({ model: e.target.value })} />
      </div>
      <datalist id={`models-${p.row.role}`}>
        {(chosen?.models ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
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
