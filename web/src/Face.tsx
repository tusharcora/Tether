import { blobatar, type BlobatarOptions } from 'blobatar';
import * as X from 'blobatar/expression';
import { _parts } from 'blobatar/internal';
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

/**
 * A bot's face, generated on this machine from its id (blobatar is bundled; blobatar.dev is never called).
 *
 * Static faces come from `blobatar()`. That string API ignores `animate` by design, so an animated face is
 * assembled from `_parts` exactly as the library's own React adapter does: the backdrop, then a root `<g>`
 * carrying the `mo-root` classes that `blobatar/motion.css` targets, with the seeded timings on the `<svg>`.
 */
export function faceSvg(id: string, o: { mood?: Mood; face?: FaceLook; size?: number; animate?: Animate } = {}): string {
  const size = o.size ?? 48;
  const opts: BlobatarOptions = {
    size,
    normalize: false,
    background: 'squircle',
    expression: EXPR[o.mood ?? 'idle'],
    ...(o.face?.hue !== undefined ? { hue: o.face.hue } : {}),
    ...(o.face?.tone !== undefined ? { tone: o.face.tone } : {}),
    ...(o.face?.traits ? { traits: o.face.traits } : {}),
  };
  if (!o.animate) return blobatar(id, opts);
  const p = _parts(id, { ...opts, animate: o.animate });
  const style = Object.entries(p.vars ?? {})
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const bg = p.bg ? `<path d="${p.bg.d}" fill="${p.bg.fill}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" style="${style}">${bg}<g class="${p.cls ?? ''}">${p.inner}</g></svg>`;
}
/** Static faces only: an <img> cannot animate (CSS cannot reach inside it). */
export const faceUri = (id: string, o?: { mood?: Mood; face?: FaceLook; size?: number }) => `data:image/svg+xml;utf8,${encodeURIComponent(faceSvg(id, o))}`;

export function Face(props: { id: string; mood?: Mood; size?: number; label?: string; face?: FaceLook; animate?: Animate }) {
  const { crew } = useCrew();
  const c = crew[props.id];
  const size = props.size ?? 40;
  const face = props.face ?? c?.face;
  const label = props.label ?? c?.name ?? props.id;
  const mood = props.mood ?? 'idle';
  if (props.animate)
    return (
      <span
        className="face"
        role="img"
        aria-label={label}
        data-mood={mood}
        style={{ width: size, height: size }}
        // generated locally from a bot id by blobatar; no user markup reaches this string
        dangerouslySetInnerHTML={{ __html: faceSvg(props.id, { mood, face, size, animate: props.animate }) }}
      />
    );
  return <img src={faceUri(props.id, { mood, face, size })} width={size} height={size} alt={label} data-mood={mood} className="face" />;
}
