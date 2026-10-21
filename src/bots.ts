/**
 * The aorch crew registry (names, colours, looks) and the pixel look the web dashboard draws.
 * The terminal draws no crew characters; the only one is the header face (face.ts). The bot editor previews a look with half-block
 * characters (two pixel rows per text row).
 */
import { hslToRgb, parseHex, rgbToHsl, toHex } from './color.js';
import { BUILTIN_BOTS, loadCrew, type BotDef, type Look } from './crew.js';
import { MARK_STYLES } from './marks.js';
import { bgCode, caps, fgCode, pal, type RGB } from './ui.js';

export type Mood = 'idle' | 'working' | 'happy' | 'sad' | 'waiting' | 'asleep';

export interface BotInfo {
  name: string;
  title: string;
  color: () => RGB;
  accent: () => RGB;
  /** What the bot is and how it looks. Present on every registered bot. */
  def?: BotDef;
}

export const CREW: Record<string, BotInfo> = {
  orchestrator: { name: 'Maestro', title: 'orchestrator', color: () => pal.violet, accent: () => pal.pink },
  planner: { name: 'Scout', title: 'planner', color: () => pal.blue, accent: () => pal.cyan },
  architect: { name: 'Brick', title: 'architect', color: () => pal.cyan, accent: () => pal.amber },
  coder: { name: 'Bolt', title: 'coder', color: () => pal.green, accent: () => pal.cyan },
  tester: { name: 'Probe', title: 'tester', color: () => pal.amber, accent: () => pal.red },
  reviewer: { name: 'Lens', title: 'reviewer', color: () => pal.pink, accent: () => pal.violet },
  manager: { name: 'Boss', title: 'manager', color: () => pal.amber, accent: () => pal.pink },
  approval: { name: 'Gate', title: 'approver', color: () => pal.text, accent: () => pal.amber },
};

const BASE: Record<string, BotInfo> = { ...CREW };

const guardRgb = (c: RGB): RGB => {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb([h, Math.max(0.35, Math.min(0.82, s)), Math.max(0.5, Math.min(0.68, l))]);
};
const bodyRgb = (l: Look): RGB => {
  const c = parseHex(l.color) ?? [154, 166, 184];
  return l.guard === false ? c : guardRgb(c);
};
const accentRgb = (l: Look): RGB => {
  if (l.accent !== 'auto') return parseHex(l.accent) ?? [255, 255, 255];
  const [h] = rgbToHsl(bodyRgb(l));
  return hslToRgb([h + 28, 0.9, 0.84]);
};

/** Make the crew registry match these definitions. Unedited built-ins keep their theme-aware colours. */
export function registerCrew(defs: BotDef[]): void {
  for (const k of Object.keys(CREW)) delete CREW[k];
  for (const d of defs) {
    const base = d.builtin && !d.edited ? BASE[d.id] : undefined;
    CREW[d.id] = base ? { ...base, def: d } : { name: d.name, title: d.title, color: () => bodyRgb(d.look), accent: () => accentRgb(d.look), def: d };
  }
  if (!CREW.coder) for (const [k, v] of Object.entries(BASE)) CREW[k] ??= v;
}

/** Map a pipeline node to one of the crew. A step whose role names a bot runs as that bot. */
export function crewFor(node: { kind: string; role?: string }): string {
  const named = (node.role ?? '').toLowerCase();
  if (named in CREW && named !== 'orchestrator') return named;
  if (node.kind === 'gate') return 'tester';
  if (node.kind === 'approval') return 'approval';
  const r = named;
  if (r in CREW) return r;
  if (/test|qa/.test(r)) return 'tester';
  if (/review|audit/.test(r)) return 'reviewer';
  if (/arch|design/.test(r)) return 'architect';
  if (/plan|research|spec/.test(r)) return 'planner';
  return 'coder';
}

export type CrewStyle = 'classic' | 'pebble' | 'sigil' | 'ticker' | 'orbit';
export const CREW_STYLES: Record<CrewStyle, string> = {
  classic: 'visor bots with antennae and faces (built-in crew only)',
  pebble: 'the family: one pebble base, swappable parts',
  ...MARK_STYLES,
};

// ---------- the family: one pebble base, a few swappable parts ----------
const BODY: Record<string, string[]> = {
  pebble: ['..####..', '.######.', '.######.', '.######.', '..####..', '..#..#..'],
  wide: ['.######.', '########', '########', '########', '.######.', '.##..##.'],
  tall: ['..####..', '..####..', '..####..', '..####..', '..####..', '..#..#..'],
  square: ['########', '########', '########', '########', '########', '.##..##.'],
  blob: ['..####..', '.######.', '########', '########', '.######.', '..####..'],
};

/**
 * One frame of a bot built from its parts: 8 rows × 10 columns of pixel codes
 * (B body · b shade · h shine · E dark · A accent · G gold · Q/q leaf · P blush · Z light).
 * Layers, bottom to top: body, marking, sides, top, mouth, eyes.
 */
export function lookSprite(look: Look, mood: Mood, tick: number): string[] {
  const rows = BODY[look.body] ?? BODY.pebble!;
  const per = rows.map((r) => (r.indexOf('#') < 0 ? null : ([r.indexOf('#'), r.lastIndexOf('#')] as [number, number])));
  const gl = Math.min(...per.map((p) => p?.[0] ?? 99));
  const gr = Math.max(...per.map((p) => p?.[1] ?? -1));
  const cx1 = Math.floor((gl + gr) / 2), cx2 = cx1 + 1;
  const [tL, tR] = per[0]!;
  const g = Array.from({ length: 9 }, () => new Array<string>(10).fill('.'));
  const hop = 0; // a 1px hop re-pairs every half-block cell and reads as jitter in a terminal
  const oy = 2 + hop;
  const put = (x: number, y: number, k: string) => {
    const cx = x + 1, cy = y + oy;
    if (cx >= 0 && cx < 10 && cy >= 0 && cy < 9) g[cy]![cx] = k;
  };
  const inBody = (x: number, y: number) => rows[y]?.[x] === '#';
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && put(x, y, y >= rows.length - 2 ? 'b' : 'B')));
  put(tL, 0, 'h');
  const pat = look.pattern;
  if (pat === 'blush') { put(per[2]![0], 2, 'P'); put(per[2]![1], 2, 'P'); }
  else if (pat === 'band') for (let x = per[0]![0]; x <= per[0]![1]; x++) put(x, 0, 'A');
  else if (pat === 'belly') { put(cx1, 4, 'h'); put(cx2, 4, 'h'); }
  else if (pat === 'badge') put(per[2]![1] - 1, 2, 'A'); // a pin on the chest, not a stray corner pixel
  else if (pat === 'spots') { put(per[2]![0] + 1, 2, 'b'); put(per[4]![1], 4, 'b'); put(per[3]![0], 3, 'h'); }
  const side = (ys: number[], k: string) => ys.forEach((y) => { const p = per[y]; if (p) { put(p[0] - 1, y, k); put(p[1] + 1, y, k); } });
  if (look.side === 'arms') side([3, 4], 'b');
  else if (look.side === 'ears') side([1], 'A');
  else if (look.side === 'cans') side([1, 2, 3], 'A');
  else if (look.side === 'wings') { side([2, 3], 'A'); put(per[3]![0] - 2, 3, 'A'); put(per[3]![1] + 2, 3, 'A'); }
  const flick = mood === 'working' && tick % 16 < 8; // only the little lights blink; crowns and horns stay put
  const A = 'A', Z = flick ? 'Z' : 'A';
  switch (look.top) {
    case 'antenna': put(cx1, -1, Z); put(cx2, -1, Z); break;
    case 'horns': put(tL, -1, A); put(tR, -1, A); break;
    case 'crest': for (let x = cx1 - 1; x <= cx2 + 1; x++) put(x, -1, Z); break;
    case 'cap':
      for (let x = tL; x <= tR; x++) put(x, -1, 'A');
      for (let x = gl; x <= gr; x++) if (inBody(x, 0)) put(x, 0, 'A');
      break;
    case 'crown':
      for (let x = tL; x <= tR; x += 2) put(x, -1, 'G');
      for (let x = tL; x <= tR; x++) put(x, 0, 'G');
      break;
    case 'sprout': put(cx1, -1, 'q'); put(cx2, -1, 'Q'); put(cx2 + 1, -1, flick ? 'Z' : 'Q'); break;
  }
  // dark pixels (eyes, mouth) never sit on the outline: that punches notches in the silhouette
  const putDark = (x: number, y: number) => { if (inBody(x - 1, y) && inBody(x + 1, y)) put(x, y, 'E'); };
  let mouth = look.mouth;
  if (mood === 'happy' && mouth === 'none') mouth = 'smile';
  if (mood === 'sad' && mouth === 'smile') mouth = 'frown';
  if (mood === 'asleep' && mouth === 'smile') mouth = 'flat';
  // life comes from the mouth and the blink, not from eyes jumping around the face
  if (mouth !== 'none' && mood === 'working' && Math.floor(tick / 7) % 2 === 1) mouth = 'open';
  if (mouth !== 'none' && mood === 'waiting') mouth = 'open';
  // two-row eyes leave no room above the mouth, so the mouth drops to the bottom row and loses its corners (they would fuse with the eyes)
  const eyesLow = look.eyes === 'tall' || look.eyes === 'cyclops' || look.eyes === 'sleepy';
  if (mouth !== 'none' && eyesLow) { putDark(cx1, 4); putDark(cx2, 4); }
  else if (mouth === 'flat') { putDark(cx1, 3); putDark(cx2, 3); }
  else if (mouth === 'smile') { putDark(cx1 - 1, 3); putDark(cx1, 4); putDark(cx2, 4); putDark(cx2 + 1, 3); }
  else if (mouth === 'frown') { putDark(cx1 - 1, 4); putDark(cx1, 3); putDark(cx2, 3); putDark(cx2 + 1, 4); }
  else if (mouth === 'open') { putDark(cx1, 3); putDark(cx2, 3); putDark(cx1, 4); putDark(cx2, 4); }
  let dx = 0, dy = 0, closed = false;
  if (mood === 'working') dx = [-1, 0, 1, 0][Math.floor(tick / 7) % 4]!; // a slow glance left, centre, right, centre
  else if (mood === 'waiting') dx = tick % 50 < 25 ? -1 : 1;
  else if (mood === 'asleep' || (mood === 'idle' && tick % 40 > 37)) closed = true;
  const eyes: [number, number, string, boolean][] = [];
  const e = (x: number, y: number, k: string, mv: boolean) => eyes.push([x, y, k, mv]);
  // Eyes follow the body: they sit just inside the widest part of the face row, so every shape gets a face that fits it.
  const face = per[1] ?? per[0]!;
  const iL = face[0] + 1, iR = face[1] - 1; // interior columns of the face row
  const xl = Math.max(iL, Math.min(cx1 - 1, iR)), xr = Math.min(iR, Math.max(cx2 + 1, iL));
  const roomy = iR - iL >= 5; // wide and square bodies
  switch (look.eyes) {
    case 'tall': e(xl, 1, 'E', true); e(xl, 2, 'E', true); e(xr, 1, 'E', true); e(xr, 2, 'E', true); break;
    case 'wide':
      if (roomy) { e(xl, 1, 'E', true); e(xl + 1, 1, 'E', true); e(xr - 1, 1, 'E', true); e(xr, 1, 'E', true); }
      else { e(xl, 1, 'E', true); e(xr, 1, 'E', true); }
      break;
    case 'visor': for (let x = iL; x <= iR; x++) e(x, 1, 'E', false); e(xl, 1, 'Z', true); e(xr, 1, 'Z', true); break;
    case 'cyclops': e(cx1, 1, 'E', true); e(cx2, 1, 'E', true); e(cx1, 2, 'E', true); e(cx2, 2, 'E', true); break;
    case 'sleepy': e(xl, 2, 'E', true); e(xr, 2, 'E', true); e(xl, 1, 'b', false); e(xr, 1, 'b', false); break;
    case 'wink': e(xl, 1, 'E', true); e(xr, 1, 'E', true); if (xr - 1 > xl + 1) e(xr - 1, 1, 'E', true); break; // the open eye and the winking dash move together
    case 'glasses':
      e(face[0], 1, 'A', false); e(face[1], 1, 'A', false);
      for (let x = xl + 1; x <= xr - 1; x++) e(x, 1, 'A', false);
      if (xl - 1 > face[0]) e(xl - 1, 1, 'A', false);
      if (xr + 1 < face[1]) e(xr + 1, 1, 'A', false);
      e(xl, 1, 'E', false); e(xr, 1, 'E', false);
      break; // pupils stay inside the lenses
    default: e(xl, 1, 'E', true); e(xr, 1, 'E', true);
  }
  // The eyes move as one piece and never onto the outline (that punches notches in the silhouette) or into the mouth rows.
  // Try the wanted shift, then each axis alone, then stay put.
  const solid = (x: number, y: number) => inBody(x - 1, y) && inBody(x + 1, y) && inBody(x, y - 1) && inBody(x, y + 1);
  const fits = (ox: number, oy: number) => (ox === 0 && oy === 0) || eyes.every(([x, y, , mv]) => !mv || !inBody(x, y) || (solid(x + ox, y + oy) && y + oy <= 2));
  const wanted: [number, number][] = [];
  const restOk = eyes.every(([x, y, , mv]) => !mv || solid(x, y)); // an eye that already hugs the edge stays where it is
  if (restOk && (dx !== 0 || dy !== 0)) for (const c of [[dx, dy], [dx, 0], [0, dy]] as [number, number][]) if (c[0] !== 0 || c[1] !== 0) wanted.push(c);
  wanted.push([0, 0]);
  const [ox, oy2] = wanted.find(([a, b]) => fits(a, b)) ?? [0, 0];
  for (const [x0, y0, k0, mv] of eyes) {
    const x = mv ? x0 + ox : x0, y = mv ? y0 + oy2 : y0;
    const k = closed && mv ? 'b' : k0;
    if (k === 'E' ? inBody(x - 1, y) && inBody(x + 1, y) && inBody(x, y) : inBody(x, y)) put(x, y, k);
  }
  if (mood === 'asleep') {
    const zt = Math.floor(tick / 10) % 3;
    put(8, -1 + (zt % 2), 'Z');
    if (zt > 0) put(9, -2 + zt, 'Z');
  }
  return g.slice(0, 8).map((r) => r.join(''));
}

function lookPalette(look: Look): Record<string, RGB> {
  const body = bodyRgb(look);
  const sh = (c: RGB, k: number): RGB => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
  const li = (c: RGB, k: number): RGB => [Math.round(c[0] + (255 - c[0]) * k), Math.round(c[1] + (255 - c[1]) * k), Math.round(c[2] + (255 - c[2]) * k)];
  return { B: body, b: sh(body, 0.78), h: li(body, 0.22), E: [16, 20, 28], A: accentRgb(look), G: [242, 193, 78], Q: [63, 185, 124], q: [42, 143, 92], P: [255, 158, 199], Z: li(body, 0.6) };
}

const W = 10;

/** Paint a pixel-code grid as terminal rows (two pixel rows per text row, 10 columns). */
function paintGrid(grid: string[], colors: Record<string, RGB | undefined>): string[] {
  const lines: string[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const top = colors[grid[y]![x]!];
      const bot = colors[grid[y + 1]![x]!];
      if (!caps.level) {
        // no colour: eyes and mouth become holes so the face still reads
        const solid = (c: string) => c !== '.' && c !== 'E' && c !== 'M';
        const t = solid(grid[y]![x]!), b = solid(grid[y + 1]![x]!);
        line += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
      } else if (top && bot) line += `${fgCode(top)}${bgCode(bot)}▀\x1b[0m`;
      else if (top) line += `${fgCode(top)}▀\x1b[0m`;
      else if (bot) line += `${fgCode(bot)}▄\x1b[0m`;
      else line += ' ';
    }
    lines.push(line);
  }
  return lines;
}

/** A bot's look as plain pixels for other renderers (the web dashboard): 8 rows of 10 pixel codes plus a hex colour per code. */
export function lookPixels(look: Look, mood: Mood = 'idle', tick = 0): { grid: string[]; colors: Record<string, string> } {
  const hex = (c: RGB) => '#' + c.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
  return { grid: lookSprite(look, mood, tick), colors: Object.fromEntries(Object.entries(lookPalette(look)).map(([k, c]) => [k, hex(c)])) };
}

/** Render a look as 4 terminal rows (10 columns wide): the bot editor's preview. */
export function renderLook(look: Look, mood: Mood = 'idle', tick = 0): string[] {
  return paintGrid(lookSprite(look, mood, tick), lookPalette(look));
}

export function moodFor(status: string): Mood {
  return (
    { running: 'working', done: 'happy', error: 'sad', awaiting: 'waiting', paused: 'waiting', skipped: 'asleep', queued: 'asleep', stopped: 'sad' } as Record<string, Mood>
  )[status] ?? 'idle';
}

registerCrew(BUILTIN_BOTS.map((b) => ({ ...b, builtin: true })));

/** Re-read <home>/crew and make the registry match. Call at start-up and after any edit. */
export function refreshCrew(home: string): BotDef[] {
  const defs = loadCrew(home);
  registerCrew(defs);
  return defs;
}
