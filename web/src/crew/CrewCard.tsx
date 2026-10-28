import { useId } from 'react';
import type { BotDef } from '../crewStore';
import { Face } from '../Face';
import { cn } from '../ui/cn';
import { StatusChip } from '../ui/studio/StatusChip';
import { isEcc, type Row } from './types';

/** One bot in the grid. A click opens it in the editor; the chips say what it is and what waits for you. */
export function CrewCard(p: { row: Row; def?: BotDef; evo?: { version: number; open: number }; agentMissing: boolean; selected: boolean; onPick: () => void }) {
  const d = p.def;
  const desc = useId();
  const when = d?.whenToUse || d?.persona || (p.row.kind === 'approval' ? 'A person signs off here.' : '');
  return (
    <button type="button" className={cn('cw-card', { on: p.selected })} aria-label={`Edit ${p.row.name}`} aria-describedby={desc} aria-pressed={p.selected} onClick={p.onPick}>
      <span className="cw-card-head">
        <Face id={p.row.role} size={48} animate="hover" />
        <span className="cw-card-names">
          <span className="cw-card-name">{p.row.name}</span>
          <span className="cw-card-title">{p.row.title}</span>
        </span>
      </span>
      <span className="cw-card-when" id={desc}>
        {when}
      </span>
      <span className="cw-chips">
        <span className="cw-chip mono">{p.row.kind}</span>
        <span className="cw-chip mono" title={d?.source}>
          {isEcc(d) ? 'ECC' : d?.builtin ? 'built-in' : 'yours'}
        </span>
        {d?.readOnly ? <span className="cw-chip ghost">read-only</span> : null}
        {p.row.kind !== 'approval' && p.evo ? (
          <span className="cw-chip mono" title="Harness version: persona, guidance and skills">
            v{p.evo.version}
          </span>
        ) : null}
        {p.row.kind !== 'approval' && p.evo?.open ? <StatusChip tone="needs" label="proposal" /> : null}
        {p.agentMissing ? <StatusChip tone="needs" label="agent not available" /> : null}
      </span>
    </button>
  );
}
