import { cn } from '../ui/cn';

const R = 8;
const C = 2 * Math.PI * R;

/** Steps done out of all steps, as a ring (decorative: the row's status chip carries the text). */
export function ProgressRing(props: { done: number; total: number; live?: boolean }) {
  const frac = props.total ? props.done / props.total : 0;
  return (
    <svg className={cn('prog-ring', { live: !!props.live })} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" data-progress={`${props.done}/${props.total}`}>
      <circle className="ring-track" cx="10" cy="10" r={R} />
      <circle className="ring-fill" cx="10" cy="10" r={R} strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 10 10)" />
    </svg>
  );
}
