import type { CSSProperties } from 'react';
import { Face } from '../../Face';
import './parts.css';

/** Overlapping faces of a run's bots; the working bot breathes, the rest are still. */
export function FaceStack(props: { bots: string[]; working?: string; size?: number; max?: number }) {
  const max = props.max ?? 4;
  const size = props.size ?? 24;
  if (!props.bots.length) return null;
  const shown = props.bots.slice(0, max);
  const more = props.bots.length - shown.length;
  return (
    <span className="sl-facestack" style={{ '--face': `${size}px` } as CSSProperties}>
      {shown.map((b) =>
        b === props.working ? <Face key={b} id={b} size={size} mood="working" animate="always" /> : <Face key={b} id={b} size={size} mood="idle" />,
      )}
      {more > 0 ? (
        <span className="sl-facestack-more" aria-label={`and ${more} more`}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}
