import { useState } from 'react';
import type { BotDef } from '../crewStore';
import { Face } from '../Face';
import { cn } from '../ui/cn';
import { StatusBadge } from '../ui/studio/StatusBadge';
import type { Row } from './types';

/** While a library bot is dragged, each role either takes it (`ok`) or dims and refuses it (`no`). */
export type DragFit = 'none' | 'ok' | 'no';

/**
 * One built-in role in the lineup (mockup .slot): who plays it, what it does, what it runs on, and whether it is working.
 * It is a drop target for library bots of its kind; Swap… is the keyboard way to the same thing (Gate has none).
 */
export function Slot(p: { def: BotDef; row?: Row; busy: boolean; proposals: number; agentMissing: boolean; selected: boolean; fit: DragFit; onPick: () => void; onSwap?: () => void; onDrop: () => void }) {
  const d = p.def;
  const person = d.kind === 'approval';
  const b = p.row?.binding;
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn('cw-slot', { on: p.selected, ok: p.fit === 'ok', dim: p.fit === 'no', over: over && p.fit === 'ok' })}
      onDragOver={(e) => {
        if (p.fit !== 'ok') return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (p.fit === 'ok') p.onDrop();
      }}
    >
      <button type="button" className="cw-slot-main" aria-label={`Edit ${d.name}`} aria-pressed={p.selected} onClick={p.onPick}>
        <span className="cw-slot-role">{d.title || d.id}</span>
        <span className="cw-slot-who">
          <Face id={d.id} size={40} animate="hover" />
          <span className="cw-slot-names">
            <b>{d.name}</b>
            <span className="cw-slot-job">{d.whenToUse || d.persona}</span>
          </span>
        </span>
      </button>
      <span className="cw-slot-ft">
        <span className="cw-chip mono">{person ? 'a person' : b ? [b.agent, b.model].filter(Boolean).join(' · ') : 'claude'}</span>
        {p.proposals ? <StatusBadge tone="needs" label="proposal" /> : null}
        {p.agentMissing ? <StatusBadge tone="needs" label="agent not available" /> : null}
        <span className="cw-slot-state">{person ? 'you' : p.busy ? <StatusBadge tone="live" label="working" /> : 'idle'}</span>
        {p.onSwap ? (
          <button type="button" className="cw-slot-swap" aria-label={`Swap ${d.name}…`} onClick={p.onSwap}>
            Swap…
          </button>
        ) : null}
      </span>
    </div>
  );
}
