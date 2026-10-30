/**
 * A bot's face as an SVG string: a flat body in one colour and two thick, rounded, tilted eyes up and to the right, the far
 * eye smaller and higher so the face reads as turned. The mood lives in the eyes alone. Ported from our own reference
 * generator (docs/design/avatars/reference-faces.mjs); nothing is painted outside the body, so every face is transparent.
 * Pure: no React, no DOM (the server's tests import the lists below).
 */

export type Mood = 'idle' | 'working' | 'done' | 'failed' | 'waiting' | 'asleep' | 'stopped';

type Circle = [cx: number, cy: number, r: number];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Each body: its shapes (the group around them sets the fill) and the face circle the eyes sit on, in a 100×100 box. */
const BODY = {
  orb: { svg: '<circle cx="50" cy="52" r="38"/>', face: [50, 52, 38] },
  tile: { svg: '<rect x="15" y="17" width="70" height="70" rx="20" transform="rotate(-7 50 52)"/>', face: [50, 52, 36] },
  bean: { svg: '<rect x="24" y="12" width="54" height="80" rx="27" transform="rotate(-16 51 52)"/>', face: [52, 46, 30] },
  drop: { svg: '<path d="M50 10C58 22 86 44 86 62A36 36 0 0 1 14 62C14 44 42 22 50 10Z" transform="rotate(-26 50 60)"/>', face: [54, 58, 34] },
  nub: { svg: '<circle cx="55" cy="48" r="34"/><ellipse cx="25" cy="73" rx="15" ry="11" transform="rotate(-20 25 73)"/>', face: [55, 48, 34] },
  cloud: { svg: [[32, 60, 20], [52, 44, 25], [72, 58, 19], [50, 68, 20]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join(''), face: [52, 54, 30] },
  flower: {
    svg: Array.from({ length: 8 }, (_, i) => (i / 8) * 2 * Math.PI).map((a) => `<circle cx="${r2(50 + 30 * Math.cos(a))}" cy="${r2(52 + 30 * Math.sin(a))}" r="12"/>`).join('') + '<circle cx="50" cy="52" r="27"/>',
    face: [50, 52, 27],
  },
  block: { svg: '<circle cx="27" cy="27" r="11"/><circle cx="73" cy="27" r="11"/><rect x="16" y="24" width="68" height="62" rx="16"/>', face: [50, 56, 32] },
} satisfies Record<string, { svg: string; face: Circle }>;
export type Body = keyof typeof BODY;
export const BODIES = Object.keys(BODY) as Body[];

/** The ten body colours in pick order, with the names the Crew editor reads out. */
export const COLORS = [
  ['#5E7FE6', 'blue'], ['#E8835F', 'orange'], ['#F7D02C', 'yellow'], ['#58B6C4', 'teal'], ['#0B0B0C', 'black'],
  ['#E5935A', 'apricot'], ['#FBC3E6', 'pink'], ['#C9CACD', 'grey'], ['#E35A5A', 'red'], ['#DCE3F5', 'pale blue'],
] as const;
/** The black body: the dark theme gives it a hairline (Face.css) so it does not vanish. */
export const DARK_BODY = '#0B0B0C';
/** Tether's own grey, a Studio token (and the spots that recolour it), so its face only works inline, never as an <img>. */
export const TETHER_GREY = 'var(--tf-slab, var(--s3))';
/** Eye ink: near-black, except where that would not read. */
const INK: Record<string, string> = { [DARK_BODY]: '#FFFFFF', '#FBC3E6': '#3D4A63', [TETHER_GREY]: 'var(--tf-eye, var(--ink))' };
// a var() is not allowed in a presentation attribute, only in style
const paint = (prop: 'fill' | 'stroke', c: string) => (c.startsWith('var(') ? `style="${prop}:${c}"` : `${prop}="${c}"`);

/** The built-in bots' hand-set looks (the approved board); every other bot's comes from its id. */
const BUILTIN: Record<string, [Body, string]> = {
  orchestrator: ['orb', TETHER_GREY], planner: ['orb', '#5E7FE6'], architect: ['block', '#E8835F'], coder: ['orb', DARK_BODY], tester: ['bean', '#58B6C4'],
  reviewer: ['drop', '#F7D02C'], manager: ['tile', '#E35A5A'], approval: ['cloud', '#C9CACD'],
};

/** FNV-1a over the id, then murmur3's final mix so ids a character apart still land far apart. Unsigned 32-bit. */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** What the Crew editor can pin; anything outside the lists is ignored. */
export interface FacePins { body?: string; color?: string }

/** A bot's body and colour: its pins, else its built-in look, else picked from its id. */
export function faceLook(id: string, pins: FacePins = {}): { body: Body; color: string } {
  const h = hash(id);
  // own keys only: an id like "constructor" is a valid bot id
  const [body, color] = Object.hasOwn(BUILTIN, id) ? BUILTIN[id]! : [BODIES[h % BODIES.length]!, COLORS[(h >>> 8) % COLORS.length]![0]];
  const pinned = pins.color?.toUpperCase();
  return {
    body: BODIES.find((b) => b === pins.body) ?? body,
    color: COLORS.find(([hex]) => hex === pinned)?.[0] ?? color,
  };
}

/** The eyes on a face circle, for a mood. Idle: the near eye bigger, the far one smaller and higher (turned up-right). */
function eyes([cx, cy, r]: Circle, mood: Mood, ink: string): string {
  // a pill's ends are fully round; its group lets CSS blink it without losing the tilt
  const pill = (x: number, y: number, w: number, h: number, rot: number) =>
    `<g class="fa-eye"><rect x="${r2(x - w / 2)}" y="${r2(y - h / 2)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(Math.min(w, h) / 2)}" ${paint('fill', ink)} transform="rotate(${rot} ${r2(x)} ${r2(y)})"/></g>`;
  const arc = (x: number, y: number, w: number, up: boolean, rot: number) =>
    `<path d="M${r2(x - w)} ${r2(y)}q${r2(w)} ${r2(up ? -w * 1.1 : w * 0.9)} ${r2(2 * w)} 0" fill="none" ${paint('stroke', ink)} stroke-width="${r2(r * 0.13)}" stroke-linecap="round" transform="rotate(${rot} ${r2(x)} ${r2(y)})"/>`;
  const x1 = cx + 0.2 * r, y1 = cy - 0.36 * r, x2 = cx + 0.6 * r, y2 = cy - 0.47 * r;
  const W = 0.29 * r, H = 0.52 * r;
  switch (mood) {
    case 'working': // looking further up and right
      return pill(x1 + 0.08 * r, y1 - 0.1 * r, W, H * 0.92, -24) + pill(x2 + 0.06 * r, y2 - 0.1 * r, W * 0.78, H * 0.72, -26);
    case 'done':
      return arc(x1 - 0.04 * r, y1 + 0.1 * r, W * 0.55, true, -14) + arc(x2 + 0.02 * r, y2 + 0.04 * r, W * 0.45, true, -16);
    case 'failed': // eyes drop and lean the other way
      return pill(x1 - 0.04 * r, y1 + 0.18 * r, W, H * 0.8, 24) + pill(x2 - 0.02 * r, y2 + 0.16 * r, W * 0.8, H * 0.64, 28);
    case 'asleep':
      return arc(x1 - 0.04 * r, y1 + 0.04 * r, W * 0.55, false, -14) + arc(x2 + 0.02 * r, y2 - 0.02 * r, W * 0.45, false, -16);
    case 'waiting': // idle eyes glancing left, toward the content
      return pill(x1 - 0.5 * r, y1 + 0.06 * r, W, H, -10) + pill(x2 - 0.48 * r, y2 + 0.04 * r, W * 0.8, H * 0.76, -12);
    case 'stopped': // short flat bars, nearly level
      return pill(x1, y1 + 0.08 * r, H * 0.72, W * 0.62, -8) + pill(x2, y2 + 0.06 * r, H * 0.58, W * 0.5, -10);
    default:
      return pill(x1, y1, W, H, -20) + pill(x2, y2, W * 0.8, H * 0.76, -22);
  }
}

/**
 * A bot's face as SVG: the body group first, then the eyes group (`fa-eyes`, each pill a `fa-eye`) that Face.css moves
 * when the face is inline. The same string serves the static <img>, where those classes are inert.
 */
export function faceArt(id: string, o: FacePins & { mood?: Mood; size?: number } = {}): string {
  const { body, color } = faceLook(id, o);
  const b = BODY[body];
  const size = o.size ?? 48;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><g ${paint('fill', color)}>${b.svg}</g><g class="fa-eyes">${eyes(b.face, o.mood ?? 'idle', INK[color] ?? '#17181A')}</g></svg>`;
}
