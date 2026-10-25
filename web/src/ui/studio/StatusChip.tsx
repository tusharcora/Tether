import { cn } from '../cn';
import './parts.css';

export type Tone = 'live' | 'needs' | 'done' | 'failed' | 'neutral';

/** Colour carries meaning only: blue live/working, amber needs you, green done, red failed. */
export function toneFor(status?: string): Tone {
  switch (status) {
    case 'running':
      return 'live';
    case 'paused':
    case 'awaiting':
      return 'needs';
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    default:
      return 'neutral';
  }
}

/** Label + dot on a tinted fill with the status colour as text. `pulse` only for live states; the text label always stays. */
export function StatusChip(props: { tone: Tone; label: string; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('sl-chip', `t-${props.tone}`, props.className)}>
      <span className={cn('sl-dot', { pulse: !!props.pulse })} aria-hidden="true" />
      {props.label}
    </span>
  );
}
