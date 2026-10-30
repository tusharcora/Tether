import { useMemo } from 'react';
import { useCrew, type FaceLook } from './crewStore';
import { DARK_BODY, faceArt, faceLook, type Mood } from './faceArt';
import './Face.css';

export type { Mood } from './faceArt';
export const MOOD_EXPRESSION: Record<Mood, string> = { idle: 'idle', working: 'thinking', done: 'happy', failed: 'sad', waiting: 'unsure', asleep: 'sleepy', stopped: 'mad' };

export function moodFor(status?: string): Mood {
  switch (status) {
    case 'running':
      return 'working';
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    case 'awaiting':
    case 'paused':
      return 'waiting';
    case 'stopped':
      return 'stopped';
    default:
      return 'idle';
  }
}

export type Animate = 'hover' | 'always';

/** Tether, the orchestrator bot: a grey orb in its theme's tokens, so always drawn inline. */
export const TETHER_ID = 'orchestrator';

/**
 * A bot's face, drawn on this machine from its id and pins (faceArt). Static faces are an <img>, cheap in lists; animated
 * ones, and Tether's (its colours are CSS tokens), are inline SVG so Face.css can bob, blink and glance them. Transparent
 * either way. An empty label marks the face as decoration: the name sits next to it.
 */
export function Face(props: { id: string; mood?: Mood; size?: number; label?: string; face?: FaceLook; animate?: Animate }) {
  const { crew } = useCrew();
  const c = crew[props.id];
  const size = props.size ?? 40;
  const face = props.face ?? c?.face;
  const label = props.label ?? c?.name ?? props.id;
  const mood = props.mood ?? 'idle';
  const { body, color } = faceLook(props.id, face);
  // building the SVG is the costly part; skip it when nothing changed
  const svg = useMemo(() => faceArt(props.id, { mood, body, color, size }), [props.id, mood, body, color, size]);
  // a black body gets a hairline on the dark theme (Face.css)
  const dark = color === DARK_BODY || undefined;
  if (props.animate || props.id === TETHER_ID)
    return (
      <span
        className="face"
        role={label ? 'img' : undefined}
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
        data-mood={mood}
        data-animate={props.animate}
        data-dark-body={dark}
        style={{ width: size, height: size }}
        // faceArt's own markup: pins outside its lists are dropped, so no saved string reaches the HTML
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={size} height={size} alt={label} data-mood={mood} data-dark-body={dark} className="face" />;
}
