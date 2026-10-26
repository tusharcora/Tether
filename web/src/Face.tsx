import { useMemo } from 'react';
import { blobatar, type BlobatarOptions } from 'blobatar';
import * as X from 'blobatar/expression';
import { Blobatar } from '@blobatar/react';
import { TetherFace } from './components/faces/TetherFace';
import { useCrew, type FaceLook } from './crewStore';

export type Mood = 'idle' | 'working' | 'done' | 'failed' | 'waiting' | 'asleep' | 'stopped';
const EXPR = { idle: X.idle, working: X.thinking, done: X.happy, failed: X.sad, waiting: X.unsure, asleep: X.sleepy, stopped: X.mad } as const;
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

/** The blobatar options for a bot: seed = its id, never normalised, mood as the expression, face pins on top. */
const faceOptions = (o: { mood?: Mood; face?: FaceLook; size?: number }): BlobatarOptions => ({
  size: o.size ?? 48,
  normalize: false,
  background: 'squircle',
  expression: EXPR[o.mood ?? 'idle'],
  ...(o.face?.hue !== undefined ? { hue: o.face.hue } : {}),
  ...(o.face?.tone !== undefined ? { tone: o.face.tone } : {}),
  ...(o.face?.traits ? { traits: o.face.traits } : {}),
});

/**
 * A bot's static face, generated on this machine from its id (blobatar is bundled; blobatar.dev is never called).
 * Animated faces are rendered by the official `@blobatar/react` adapter in `Face` (the string API is static by design).
 */
export function faceSvg(id: string, o: { mood?: Mood; face?: FaceLook; size?: number } = {}): string {
  return blobatar(id, faceOptions(o));
}
/** Static faces only: an <img> cannot animate (CSS cannot reach inside it). */
export const faceUri = (id: string, o?: { mood?: Mood; face?: FaceLook; size?: number }) => `data:image/svg+xml;utf8,${encodeURIComponent(faceSvg(id, o))}`;

/** Tether (the orchestrator bot) has the eye-tracker for a face, not a blob (spec §4). */
export const TETHER_ID = 'orchestrator';

export function Face(props: { id: string; mood?: Mood; size?: number; label?: string; face?: FaceLook; animate?: Animate }) {
  const { crew } = useCrew();
  const c = crew[props.id];
  const size = props.size ?? 40;
  const face = props.face ?? c?.face;
  const label = props.label ?? c?.name ?? props.id;
  const mood = props.mood ?? 'idle';
  const faceKey = JSON.stringify(face ?? null);
  const tether = props.id === TETHER_ID;
  // building the SVG is the costly part; skip it for animated faces, for Tether's, and when nothing changed
  const uri = useMemo(() => (props.animate || tether ? '' : faceUri(props.id, { mood, face, size })), [props.animate, tether, props.id, mood, size, faceKey]);
  // still where faces are static, following the pointer where they come alive
  if (tether) return <TetherFace size={size} idle={props.animate !== 'always'} label={label} className="face" />;
  if (props.animate)
    return (
      <span
        className="face"
        role="img"
        aria-label={label}
        data-mood={mood}
        style={{ width: size, height: size }}
      >
        <Blobatar name={props.id} {...faceOptions({ mood, face, size })} animate={props.animate} />
      </span>
    );
  return <img src={uri} width={size} height={size} alt={label} data-mood={mood} className="face" />;
}
