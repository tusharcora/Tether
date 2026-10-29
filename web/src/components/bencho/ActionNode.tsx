/**
 * From bencho.dev "Action node" (ActionNode.tsx / ActionNode.css). MIT License, Copyright (c) 2026 Lorenzo Cabra; the full
 * notice is in ./LICENSE. Adapted for Tether: the card's content and its actions come from the caller (bencho's four buttons
 * were fixed and wired to nothing), and the fan is real buttons: they open on hover and on keyboard focus, each one has a
 * name, and they run what the caller gives them. It keeps bencho's idea: the controls fold into the card's top-right corner
 * and fan out along the card's own outline, offset by a constant gap (straight along the top edge, round the corner on a
 * concentric arc, straight down the right edge), small at the corner and full size at rest, a beat apart. The geometry is
 * bencho's `ride` and `hideAt`; the motion is CSS transitions (150 to 280 ms) instead of five requestAnimationFrame
 * springs, so it follows reduced motion with the rest of the app. Studio tokens, opaque fills, no shadow.
 */
import { type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../beui/lib/utils';
import './ActionNode.css';

export interface NodeAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Reads red on hover: the action cannot be taken back. */
  danger?: boolean;
}

/** The button. Everything else with a size is measured off it; `lg` (goal nodes) uses LG_DOT. */
export const DOT = 28;
export const LG_DOT = 40;
/** Centre to centre along the outline is a button plus this: a real distance, so the air between buttons is the same round any corner. */
const AIR = 8;
/** Air between the card and the buttons' edges. */
const GAP = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A point on the card's outline pushed out by `off`, `s` pixels along it from where the corner arc meets the top edge, and
 * the direction out of the card there. Coordinates are from the card's top-right corner (x right, y down).
 */
export function ride(s: number, corner: number, off: number) {
  const arc = Math.max(0.001, corner + off);
  const len = (arc * Math.PI) / 2;
  if (s <= 0) return { x: -corner + s, y: -off, nx: 0, ny: -1 };
  if (s >= len) return { x: off, y: corner + (s - len), nx: 1, ny: 0 };
  const th = Math.PI / 2 - s / arc;
  return { x: -corner + arc * Math.cos(th), y: corner - arc * Math.sin(th), nx: Math.cos(th), ny: -Math.sin(th) };
}

/** Where a folded button (half size `r`) hides: far enough inside the card, on its diagonal, that none of it shows past the corner. */
const hideAt = (corner: number, r: number) => (corner >= r + 2 ? corner * Math.SQRT2 : Math.max(r * Math.SQRT2 + 2, corner * Math.SQRT2 + corner + 2));

/** The open position of each of `n` buttons, centred on the corner's midpoint so the fan is symmetrical about the diagonal. */
export function fanSpots(n: number, corner: number, dot = DOT) {
  const c = clamp(corner, 0, 32);
  const off = GAP + dot / 2;
  const mid = ((c + off) * Math.PI) / 4;
  return Array.from({ length: n }, (_, i) => ride(mid + (i - (n - 1) / 2) * (dot + AIR), c, off));
}

/**
 * The fan itself, for any card that carries the `nod-host` class (position: absolute or relative). It opens while the host is
 * hovered or holds focus, or while the host has `data-fan-open`. `tabbable` puts the buttons in the Tab order (the selected
 * card's), so a keyboard user reaches them without a tab stop on every card.
 */
export function NodeActions({ actions, corner = 12, tabbable = false, label = 'Step actions', inset = false, size = 'md' }: { actions: NodeAction[]; corner?: number; tabbable?: boolean; label?: string; /** Fold the buttons into the card's right edge instead of fanning round its corner: for a card inside a scrolling list, where nothing may hang outside it. */ inset?: boolean; /** `lg`: 40 px buttons with an 8 px invisible hit ring (goal nodes). */ size?: 'md' | 'lg' }) {
  const n = actions.length;
  if (!n) return null;
  const c = clamp(corner, 0, 32);
  const dot = size === 'lg' ? LG_DOT : DOT;
  const R = dot / 2;
  // inset: one row along the card's right edge, centred on it, the first button leftmost; the anchor is that edge's middle
  const spots = inset ? actions.map((_, i) => ({ x: -R - (n - 1 - i) * (dot + 6), y: 0, nx: 1, ny: 0 })) : fanSpots(n, c, dot);
  const deep = inset ? -8 : hideAt(c, R) / Math.SQRT2;
  // the hit pad covers the air between the card and its buttons, so the fan does not fold from under a hand reaching for it
  const BLEED = 6;
  const box = spots.reduce((b, s) => ({ l: Math.min(b.l, s.x - R - BLEED), r: Math.max(b.r, s.x + R + BLEED), t: Math.min(b.t, s.y - R - BLEED), d: Math.max(b.d, s.y + R + BLEED) }), { l: 0, r: 0, t: 0, d: 0 });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    all[(at + step + all.length) % all.length]?.focus();
  };
  return (
    <div className={cn('nod-fan', inset && 'inset', size === 'lg' && 'lg')} role="toolbar" aria-label={label} onKeyDown={onKey} style={{ '--n': n } as CSSProperties}>
      <span className="nod-pad" aria-hidden="true" style={{ left: box.l, top: box.t, width: box.r - box.l, height: box.d - box.t }} />
      {actions.map((a, i) => (
        <button
          key={a.id}
          type="button"
          className={cn('nod-act', a.danger && 'danger')}
          aria-label={a.label}
          title={a.label}
          disabled={a.disabled}
          tabIndex={tabbable ? 0 : -1}
          data-node-action
          style={{ '--i': i, '--x': `${spots[i]!.x - R}px`, '--y': `${spots[i]!.y - R}px`, '--hx': `${(inset ? -deep : -deep) - R}px`, '--hy': `${(inset ? 0 : deep) - R}px` } as CSSProperties}
          onClick={(e) => {
            e.stopPropagation();
            a.onSelect();
          }}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

/** Where a node stands: colour carries meaning only (blue live, amber needs you, green done or met, red failed). */
export type NodeTone = 'live' | 'needs' | 'done' | 'failed' | 'idle';

interface NodeProps {
  actions: NodeAction[];
  children?: ReactNode;
  className?: string;
  corner?: number;
  tabbable?: boolean;
  label?: string;
  inset?: boolean;
  size?: 'md' | 'lg';
  /** The compact card (300 px wide, 16 px corner) with a mark, a title and a line, and a status dot on the mark. */
  compact?: boolean;
  mark?: ReactNode;
  title?: ReactNode;
  line?: ReactNode;
  tone?: NodeTone;
  /** The dot's name for assistive tech (the colour is never the only signal). */
  toneLabel?: string;
}

/** A card with its actions folded into the corner: content from the caller, or with `compact` a mark, a title and a line. */
export function ActionNode({ actions, children, className, corner, tabbable, label, inset, size, compact, mark, title, line, tone = 'idle', toneLabel }: NodeProps) {
  const r = corner ?? (compact ? 16 : 12);
  return (
    <div className={cn('nod-host nod-card', compact && 'nod-compact', className)} style={{ borderRadius: r }}>
      {compact ? (
        <div className="nod-head">
          <span className="nod-mark">
            {mark}
            <span className={cn('nod-dot', `t-${tone}`)} role="img" aria-label={toneLabel ?? tone} />
          </span>
          <span className="nod-text">
            <span className="nod-title">{title}</span>
            {line ? <span className="nod-line">{line}</span> : null}
          </span>
        </div>
      ) : null}
      {children}
      <NodeActions actions={actions} corner={r} tabbable={tabbable} label={label} inset={inset} size={size} />
    </div>
  );
}
