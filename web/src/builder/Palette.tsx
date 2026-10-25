import { useState } from 'react';
import type { PipelineNode } from '../../../src/types';
import { SearchField } from '../components/arc/search-field/search-field';
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

/** Steps and ECC skills to add. A click adds the step and chains it onto the last one. */
export function Palette(props: { onAdd: (make: () => Partial<PipelineNode>) => void; skills: EccSkill[]; onSkill: (s: EccSkill) => void }) {
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
