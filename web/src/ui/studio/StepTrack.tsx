import { Fragment } from 'react';
import { cn } from '../cn';
import { segmentsFor, trackLabel, type SegState, type StepLike } from './steps';
import './parts.css';

const GLYPH: Partial<Record<SegState, string>> = { done: '✓', failed: '✕', gate: '◆' };
const WORD: Record<SegState, string> = { done: 'done', working: 'working', waiting: 'needs you', queued: 'queued', gate: 'asks first', failed: 'failed', skipped: 'skipped', planning: 'planning' };

/** One step's dot, alone (the plan card's rows); `label` names its state for screen readers. */
export const StepDot = ({ state, label }: { state: SegState; label?: boolean }) => (
  <span className={cn('sl-seg', `s-${state}`)} {...(label ? { role: 'img', 'aria-label': WORD[state] } : {})}>
    {GLYPH[state]}
  </span>
);

/** A run's steps as dots joined by lines: done, working (a ring), waiting (pulse), an approval ahead (◆), queued; skipped steps are small. */
export function StepTrack(props: { steps: StepLike[]; planning?: boolean; className?: string }) {
  const segs = segmentsFor(props.steps, { planning: props.planning });
  if (!segs.length) return null;
  return (
    <div className={cn('sl-steptrack', props.className)} role="img" aria-label={trackLabel(segs)}>
      {segs.map((s, i) => (
        <Fragment key={s.id}>
          {i ? <span className={cn('sl-link', segs[i - 1]!.state === 'done' && 'done')} /> : null}
          <span className={cn('sl-seg', `s-${s.state}`)} title={s.label}>
            {GLYPH[s.state]}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
