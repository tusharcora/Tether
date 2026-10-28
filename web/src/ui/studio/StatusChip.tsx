import { AnimatedBadge } from '../../components/beui/motion/animated-badge';
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

const TONE_CLASS: Record<Tone, string> = {
  live: 'border-transparent bg-[var(--accBg)] text-[var(--accInk)]',
  needs: 'border-transparent bg-warning-bg text-warning',
  done: 'border-transparent bg-success-bg text-success',
  failed: 'border-transparent bg-danger-bg text-destructive',
  neutral: 'border-transparent bg-muted text-muted-foreground',
};

/** Label + dot on a tinted fill with the status colour as text (beui's animated badge: a changed status rolls its label). `pulse` only for live states; the text label always stays. */
export function StatusChip(props: { tone: Tone; label: string; pulse?: boolean; className?: string }) {
  return (
    <AnimatedBadge
      status="neutral"
      size="sm"
      icon={<span className={cn('sl-dot', { pulse: !!props.pulse })} aria-hidden="true" />}
      className={cn('sl-chip h-[20px] gap-1.5 rounded-md px-2 text-[11px]', `t-${props.tone}`, TONE_CLASS[props.tone], props.className)}
    >
      {props.label}
    </AnimatedBadge>
  );
}
