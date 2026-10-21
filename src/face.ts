/**
 * The one character in the terminal UI: a single-row "face band" in the top-left of the header.
 *
 *   ▐  ●  ●  ▌ ⠋      ▐ and ▌ in the accent colour, the band between them is a background fill with two eyes on it.
 *
 * Mood changes the eyes, the colour and a small glyph after the band. Colours come from the live palette (themes included);
 * the eye ink is chosen against the band colour, so it stays readable on light and dark themes alike.
 */
import { contrast } from './color.js';
import { SPIN, bgCode, caps, fgCode, mix, pal, paint, type RGB } from './ui.js';

export type FaceMood = 'idle' | 'working' | 'waiting' | 'done' | 'failed' | 'asleep';

/** How long after the last key press, with nothing live, before the face falls asleep. */
export const SLEEP_MS = 10 * 60_000;
/** How long the "done" face shows after a run you started finishes cleanly. */
export const DONE_MS = 10_000;

const EYES: Record<FaceMood, string> = { idle: '●', working: '◉', waiting: '◔', done: '^', failed: '╥', asleep: '–' };
const AFTER: Record<FaceMood, string> = { idle: '', working: '', waiting: '?', done: '✓', failed: '!', asleep: 'z' };
const colorOf = (m: FaceMood): RGB => (m === 'waiting' ? pal.amber : m === 'done' ? pal.green : m === 'failed' ? pal.red : m === 'asleep' ? pal.gray : pal.cyan);

/** Blink for a single frame every few seconds (the tick is 100ms). */
export const blinking = (tick: number) => tick % 40 === 39;

/** Eyes in the dark ink or the light ink of the palette, whichever reads better on the band. */
function ink(band: RGB): RGB {
  const dark = mix([band, [0, 0, 0]], 0.88);
  const light = pal.text;
  return contrast(band, dark) >= contrast(band, light) ? dark : light;
}

/** The nine pieces of the 8-cell band for a mood (two eyes, centred). */
export function eyeRow(mood: FaceMood, tick: number, animate = true): string {
  const e = animate && mood === 'idle' && blinking(tick) ? '─' : EYES[mood];
  return `  ${e}  ${e}  `;
}

export interface Face {
  /** The face and its glyph slot, ANSI included. Always `width` cells wide. */
  text: string;
  width: number;
}

/**
 * Draw the face. Under 40 columns the band shrinks to `▐●●▌`. The glyph slot (a space and one cell) is always reserved,
 * so what follows the face never shifts when the mood changes.
 */
export function face(mood: FaceMood, tick: number, cols: number, animate = true): Face {
  const c = colorOf(mood);
  const compact = cols < 40;
  const eyes = compact ? (animate && mood === 'idle' && blinking(tick) ? '─' : EYES[mood]).repeat(2) : eyeRow(mood, tick, animate);
  const band = caps.level ? `${bgCode(c)}${fgCode(ink(c))}${eyes}\x1b[0m` : eyes;
  const glyph = mood === 'working' ? SPIN[tick % SPIN.length]! : AFTER[mood];
  const tail = glyph ? ` ${paint(c, glyph)}` : '  ';
  return { text: `${paint(c, '▐')}${band}${paint(c, '▌')}${tail}`, width: (compact ? 4 : 10) + 2 };
}

/** How long a failure face lasts once you stop touching the keys. */
export const FAIL_MS = 10_000;

/** Everything the face needs, all global: none of it depends on which screen is showing. */
export interface FaceInput {
  /** A run awaits approval, or Maestro asks a plan question / permission in the chat. */
  waiting: boolean;
  /** A run is going, or Maestro is replying. */
  working: boolean;
  /** Something is running or waiting for you (blocks sleep). */
  live: boolean;
  now: number;
  /** When a run you started last failed (0 = none). Cleared by the next start. */
  failedAt: number;
  /** When the "done" face stops showing (0 = never shown). */
  doneUntil: number;
  /** Time of the last key press. */
  lastInput: number;
}

export function faceMoodFor(i: FaceInput): FaceMood {
  if (i.waiting) return 'waiting';
  if (i.working) return 'working';
  if (i.failedAt && i.now - Math.max(i.failedAt, i.lastInput) < FAIL_MS) return 'failed';
  if (i.now < i.doneUntil) return 'done';
  if (!i.live && i.now - i.lastInput >= SLEEP_MS) return 'asleep';
  return 'idle';
}
