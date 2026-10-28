import { AnimatedBadge, type AnimatedBadgeStatus } from '../../components/beui/motion/animated-badge';
import { cn } from '../cn';
import { RunGlyph } from './RunGlyph';
import { badgeFor, glyphFor, type StatusDesc } from './status';
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

const TONE_STATE: Record<Tone, AnimatedBadgeStatus> = { live: 'loading', needs: 'warning', done: 'success', failed: 'danger', neutral: 'neutral' };

export type StatusBadgeProps = { desc: StatusDesc; className?: string } | { tone: Tone; label: string; pulse?: boolean; className?: string };

/**
 * The one status badge (beui's animated badge: a changed status rolls its label). A descriptor picks the state and the
 * live verb and shows the state icon; a tone is a plain label (pulses only when asked).
 */
export function StatusBadge(p: StatusBadgeProps) {
  const { state, label } = 'desc' in p ? badgeFor(p.desc) : { state: TONE_STATE[p.tone], label: p.label };
  return (
    <AnimatedBadge
      status={state}
      size="sm"
      data-status={state}
      showIcon={'desc' in p}
      pulse={'desc' in p ? undefined : !!p.pulse}
      className={cn('sl-badge', p.className)}
    >
      {label}
    </AnimatedBadge>
  );
}

/** The run glyph that goes with a badge, so an icon never contradicts its status. */
export function StatusGlyph(p: { desc: StatusDesc }) {
  return <RunGlyph state={glyphFor(badgeFor(p.desc).state)} />;
}
