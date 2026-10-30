import { X } from 'lucide-react';
import { useState } from 'react';
import { LIMITS, type LimitKey } from '../../../src/goals/types.js';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import './goals.css';

/** A limit as typed: the field's text, absent when the limit is not set. */
export type LimitDraft = Partial<Record<LimitKey, string>>;

const KEYS = Object.keys(LIMITS) as LimitKey[];
const LOOK: Record<LimitKey, { chip: string; label: string }> = {
  budgetUsd: { chip: '$ cap', label: 'Spend cap ($)' },
  maxRuns: { chip: 'max tries', label: 'Max tries' },
  maxMinutes: { chip: 'time limit', label: 'Time limit (minutes)' },
};

/** A goal's (or a draft's) limits, as the field shows them. */
export const draftOf = (g: Partial<Record<LimitKey, number>> | undefined): LimitDraft => Object.fromEntries(KEYS.flatMap((k) => (g?.[k] !== undefined ? [[k, String(g[k])]] : [])));

/** The limits to send: the ones set, as numbers; with `clear`, the ones not set as null (a PATCH clears them). */
export const limitsBody = (d: LimitDraft, clear = false): Partial<Record<LimitKey, number | null>> =>
  Object.fromEntries(KEYS.flatMap((k): [LimitKey, number | null][] => (d[k] !== undefined && d[k] !== '' ? [[k, Number(d[k])]] : clear ? [[k, null]] : [])));

/** "No limits", or what is set: "$3 cap · 4 tries · 60 min". */
export function limitsLine(g: Partial<Record<LimitKey, number>>): string {
  const parts = [g.budgetUsd !== undefined && `$${g.budgetUsd} cap`, g.maxRuns !== undefined && `${g.maxRuns} ${g.maxRuns === 1 ? 'try' : 'tries'}`, g.maxMinutes !== undefined && `${g.maxMinutes} min`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No limits';
}

/**
 * Limits, all optional (board 1): "No limits" until "+ Add limits" offers the three as dashed chips; a chip adds its field,
 * × takes it away. With approval `ask` the line says nothing ships without the person, which still holds with no limits.
 */
export function LimitsField(p: { value: LimitDraft; onChange: (v: LimitDraft) => void; approval?: 'ask' | 'auto' }) {
  const [adding, setAdding] = useState(false);
  const set = KEYS.filter((k) => p.value[k] !== undefined);
  const free = KEYS.filter((k) => p.value[k] === undefined);
  return (
    <div className="gd-limits" role="group" aria-label="Limits (optional)">
      <span className="gd-limits-head">
        <span>{set.length ? 'Limits' : 'No limits'}</span>
        {p.approval === 'ask' ? <span className="mut">· nothing ships without you</span> : null}
        {free.length ? (
          <Button type="button" variant="ghost" size="sm" className="gd-limits-add" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            + Add limits
          </Button>
        ) : null}
      </span>
      {adding && free.length ? (
        <span className="gd-limits-chips">
          {free.map((k) => (
            <button key={k} type="button" className="gd-chip" onClick={() => p.onChange({ ...p.value, [k]: '' })}>
              {LOOK[k].chip}
            </button>
          ))}
        </span>
      ) : null}
      {set.map((k) => {
        const [lo, hi, whole] = LIMITS[k];
        return (
          <span key={k} className="gd-limit">
            <Input label={LOOK[k].label} type="number" min={lo} max={hi} step={whole ? 1 : 'any'} value={p.value[k]} autoFocus={p.value[k] === ''} onChange={(e) => p.onChange({ ...p.value, [k]: e.target.value })} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${LOOK[k].label.toLowerCase()}`}
              onClick={() => {
                const next = { ...p.value };
                delete next[k];
                p.onChange(next);
              }}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </span>
        );
      })}
    </div>
  );
}
