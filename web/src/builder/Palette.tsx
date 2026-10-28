import { CornerDownRight, GitPullRequest, Globe, Plus, Webhook } from 'lucide-react';
import { useState } from 'react';
import type { PipelineNode } from '../../../src/types';
import { ActionNode } from '../components/bencho/ActionNode';
import { SearchField } from '../components/beui/kit/fields';
import { SectionHeading } from '../ui/studio/SectionHeading';

export type EccSkill = { name: string; description: string; source: string; kind?: string };

/** The six built-in step kinds. The glyph tile is neutral: colour carries meaning only, and a palette entry has no status. */
export const PALETTE: { label: string; glyph: string; hint: string; make: () => Partial<PipelineNode> }[] = [
  { label: 'Planner', glyph: 'P', hint: 'read-only: plans the change', make: () => ({ kind: 'agent', role: 'planner', readOnly: true }) },
  { label: 'Architect', glyph: 'A', hint: 'read-only: reviews the plan', make: () => ({ kind: 'agent', role: 'architect', readOnly: true }) },
  { label: 'Coder', glyph: 'C', hint: 'edits files; each attempt is committed', make: () => ({ kind: 'agent', role: 'coder' }) },
  { label: 'Reviewer', glyph: 'R', hint: 'sees the diff; ends with VERDICT', make: () => ({ kind: 'agent', role: 'reviewer', readOnly: true, verdict: true, includeDiff: true }) },
  { label: 'Gate', glyph: 'G', hint: 'a command or saved request that must pass', make: () => ({ kind: 'gate', title: 'tests', command: 'npm test', maxLoops: 2 }) },
  { label: 'Approval', glyph: '✓', hint: 'pauses until a person signs off', make: () => ({ kind: 'approval', title: 'approve' }) },
];

/**
 * Ready-made steps that reach outside the run, each a step the engine already runs: GitHub is an agent that works through
 * Code Mode's github connector, an HTTP request is a gate that sends one of the workspace's saved requests, and a webhook is a
 * gate that posts to a Slack-style incoming webhook (the URL comes from the WEBHOOK_URL environment variable of the run).
 */
export const INTEGRATIONS: { label: string; hint: string; icon: typeof GitPullRequest; make: () => Partial<PipelineNode> }[] = [
  {
    label: 'GitHub',
    hint: 'an agent that reads or comments on issues and PRs',
    icon: GitPullRequest,
    make: () => ({ kind: 'agent', role: 'coder', title: 'GitHub', readOnly: true, prompt: 'Use run_code with the github.* connector to look up what this task needs (issues, pull requests, review comments), then report what you found. Do not change anything on GitHub unless the task says so.' }),
  },
  { label: 'HTTP request', hint: 'a saved API request that must succeed', icon: Globe, make: () => ({ kind: 'gate', title: 'request', http: { run: '' }, maxLoops: 2 }) },
  {
    label: 'Webhook',
    hint: 'posts a message to a Slack-style webhook',
    icon: Webhook,
    make: () => ({ kind: 'gate', title: 'notify', command: 'curl -fsS -X POST -H "Content-Type: application/json" -d \'{"text":"Workflow step finished"}\' "$WEBHOOK_URL"', maxLoops: 1 }),
  },
];

/** Steps, integrations and ECC skills to add. A click adds the step and chains it onto the last one (an integration card can also follow the selected step). */
export function Palette(props: { onAdd: (make: () => Partial<PipelineNode>, after?: string) => void; selected?: string; skills: EccSkill[]; onSkill: (s: EccSkill) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = props.skills.filter((s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle)).slice(0, 30);
  return (
    <aside className="bl-palette" aria-label="Steps palette">
      <section>
        <SectionHeading title="Steps" />
        {PALETTE.map((p) => (
          <button key={p.label} type="button" className="bl-item" title={p.hint} onClick={() => props.onAdd(p.make)}>
            <span className="bl-glyph" aria-hidden="true">
              {p.glyph}
            </span>
            <span className="bl-item-text">
              <span className="bl-item-name">{p.label}</span>
              <span className="bl-item-hint">{p.hint}</span>
            </span>
          </button>
        ))}
      </section>
      <section aria-label="Integrations">
        <SectionHeading title="Integrations" />
        {INTEGRATIONS.map((x) => (
          <ActionNode
            key={x.label}
            className="bl-integration"
            inset
            corner={10}
            label={`${x.label} options`}
            actions={[
              { id: 'end', label: `Add ${x.label} to the end`, icon: <Plus size={14} aria-hidden="true" />, onSelect: () => props.onAdd(x.make) },
              { id: 'after', label: props.selected ? `Add ${x.label} after ${props.selected}` : `Add ${x.label} after the selected step`, icon: <CornerDownRight size={14} aria-hidden="true" />, disabled: !props.selected, onSelect: () => props.onAdd(x.make, props.selected) },
            ]}
          >
            <button type="button" className="bl-item bl-item-main" title={x.hint} onClick={() => props.onAdd(x.make)}>
              <span className="bl-glyph" aria-hidden="true">
                <x.icon size={15} />
              </span>
              <span className="bl-item-text">
                <span className="bl-item-name">{x.label}</span>
                <span className="bl-item-hint">{x.hint}</span>
              </span>
            </button>
          </ActionNode>
        ))}
      </section>
      {props.skills.length ? (
        <section>
          <SectionHeading title="Skills" count={props.skills.length} />
          <SearchField label="Find a skill" value={q} onValueChange={setQ} placeholder="ECC skills and commands" />
          {shown.map((s) => (
            <button key={s.name} type="button" className="bl-item bl-skill" title={s.description} onClick={() => props.onSkill(s)}>
              <span className="bl-item-text">
                <span className="bl-item-name">{s.name}</span>
                <span className="bl-item-hint">
                  {s.kind === 'command' ? 'ECC command' : 'ECC skill'} · {s.description}
                </span>
              </span>
            </button>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
