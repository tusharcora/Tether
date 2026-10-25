import { cn } from '../cn';
import { segmentsFor, trackLabel, type StepLike } from './steps';
import './parts.css';

/** A run's steps as a segmented bar: done, working (moving stripes), waiting (pulse), queued; skipped steps are hairlines. */
export function StepTrack(props: { steps: StepLike[]; planning?: boolean; className?: string }) {
  const segs = segmentsFor(props.steps, { planning: props.planning });
  if (!segs.length) return null;
  return (
    <div className={cn('sl-steptrack', props.className)} role="img" aria-label={trackLabel(segs)}>
      {segs.map((s) => (
        <span key={s.id} className={cn('sl-seg', `s-${s.state}`)} title={s.label} />
      ))}
    </div>
  );
}
