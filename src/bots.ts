/**
 * The aorch crew: small original pixel-art bots, one per role, drawn in the terminal with half-block characters.
 * Each pixel is a colour; two pixel rows share one terminal row (▀ foreground = top pixel, background = bottom pixel).
 */
import { hslToRgb, parseHex, rgbToHsl, toHex } from './color.js';
import { BUILTIN_BOTS, loadCrew, type BotDef, type Look } from './crew.js';
import { MARK_STYLES, isMarkStyle, miniMark, renderMark, type MarkBot } from './marks.js';
import { bgCode, caps, fgCode, mix, pal, paint, vlen, type RGB } from './ui.js';

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

/** A bot as the mark renderers see it. */
const markBot = (role: string): MarkBot => {
  const info = CREW[role] ?? CREW.coder!;
  return { id: CREW[role] ? role : 'coder', name: info.name, color: info.color() };
};
export let crewStyle: CrewStyle = 'pebble';
export function setCrewStyle(s: string): boolean {
  if (!(s in CREW_STYLES)) return false;
  crewStyle = s as CrewStyle;
  return true;
}

// ---------- the family: one pebble base, a few swappable parts ----------
const BODY: Record<string, string[]> = {
  pebble: ['..####..', '.######.', '.######.', '.######.', '..####..', '..#..#..'],
  wide: ['.######.', '########', '########', '########', '.######.', '.##..##.'],
  tall: ['..####..', '..####..', '..####..', '..####..', '..####..', '..#..#..'],
  square: ['########', '########', '########', '########', '########', '.##..##.'],
  blob: ['..####..', '.######.', '########', '########', '.######.', '..####..'],
};

/** The look for a role (unknown roles use the coder's). */
const lookOf = (role: string): Look | undefined => (CREW[role] ?? CREW.coder)?.def?.look;

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

// Legend: . empty · B body · b shade · V visor · E eye · M mouth · A accent
const W = 10;
const HEAD: Record<string, [string, string]> = {
  orchestrator: ['..A.AA.A..', '..AAAAAA..'],
  planner: ['....AA....', '....AA....'],
  architect: ['...AAAA...', '..AAAAAA..'],
  coder: ['....A.....', '....b.....'],
  tester: ['..A....A..', '...b..b...'],
  reviewer: ['.....A....', '.....b....'],
  approval: ['....AA....', '....bb....'],
};

interface Face {
  eyes: [string, string]; // pixel rows 3 and 4 (inside the visor, 6 wide)
  mouth: string; // pixel row 5
}
const FACES: Record<string, Face> = {
  open: { eyes: ['VVVVVV', 'VEVVEV'], mouth: 'VVMMVV' },
  openL: { eyes: ['VVVVVV', 'EVVEVV'], mouth: 'VVMMVV' },
  openR: { eyes: ['VVVVVV', 'VVEVVE'], mouth: 'VVMMVV' },
  blink: { eyes: ['VVVVVV', 'VVVVVV'], mouth: 'VVMMVV' },
  happy: { eyes: ['VEVVEV', 'VVVVVV'], mouth: 'VMVVMV' },
  smile: { eyes: ['VEVVEV', 'VVVVVV'], mouth: 'VVMMVV' },
  sad: { eyes: ['VVVVVV', 'VEVVEV'], mouth: 'VMMMMV' },
  waiting: { eyes: ['VEVVEV', 'VEVVEV'], mouth: 'VVVMVV' },
  asleep: { eyes: ['VVVVVV', 'VEEVEE'], mouth: 'VVVVVV' },
};

/** The sprite for one frame: 8 rows of 10 pixel codes. */
export function sprite(role: string, mood: Mood, tick: number): string[] {
  const lk = lookOf(role);
  if ((crewStyle === 'pebble' || !(role in HEAD)) && lk) return lookSprite(lk, mood, tick);
  const key = role in HEAD ? role : 'coder';
  const [h0, h1] = HEAD[key]!;
  let face: Face;
  switch (mood) {
    case 'working':
      face = [FACES.openL!, FACES.open!, FACES.openR!, FACES.open!][Math.floor(tick / 3) % 4]!;
      break;
    case 'happy':
      face = tick % 12 < 6 ? FACES.happy! : FACES.smile!;
      break;
    case 'sad':
      face = FACES.sad!;
      break;
    case 'waiting':
      face = FACES.waiting!;
      break;
    case 'asleep':
      face = FACES.asleep!;
      break;
    default:
      face = tick % 40 > 37 ? FACES.blink! : FACES.open!;
  }
  // antenna tip blinks while working; feet step; happy bots bounce (handled by caller as a row shift)
  const tip = mood === 'working' && tick % 4 < 2 ? h0.replace(/A/g, 'E') : h0;
  const foot = mood === 'working' ? (tick % 6 < 3 ? '..b....b..' : '...b..b...') : '..b....b..';
  const side = key === 'coder' ? 'A' : 'B'; // coders wear headphones
  const row = (inner: string, edge = 'B') => `${edge}${inner}${edge}`;
  const rows = [
    tip,
    h1,
    '..BBBBBB..',
    row(face.eyes[0], side),
    row(face.eyes[1], side),
    row(face.mouth),
    '..BBBBBB..',
    foot,
  ];
  if (key === 'reviewer' && mood !== 'asleep') {
    // monocle ring around the right eye
    rows[3] = rows[3]!.slice(0, 5) + 'AAA' + rows[3]!.slice(8);
  }
  return rows.map((r) => r.padEnd(W, '.').slice(0, W));
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const shade = (c: RGB, k: number): RGB => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];

function palette(role: string, mood: Mood): Record<string, RGB | undefined> {
  const lk = lookOf(role);
  if ((crewStyle === 'pebble' || !(role in HEAD)) && lk) return lookPalette(lk);
  const info = CREW[role] ?? CREW.coder!;
  let body = info.color();
  if (mood === 'asleep') body = mix([body, pal.slate], 0.55);
  if (mood === 'sad') body = mix([body, pal.red], 0.25);
  return {
    B: body,
    b: shade(body, 0.62),
    V: shade(body, 0.3),
    E: mood === 'sad' ? pal.red : mood === 'happy' ? pal.green : [240, 249, 255],
    M: mood === 'sad' ? pal.red : [240, 249, 255],
    A: info.accent(),
  };
}

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

/** Render a bot to 4 terminal rows (10 columns wide). */
export function renderBot(role: string, mood: Mood = 'idle', tick = 0): string[] {
  if (isMarkStyle(crewStyle)) return renderMark(crewStyle, markBot(role), mood, tick);
  const px = sprite(role, mood, tick);
  const looks = (crewStyle === 'pebble' || !(role in HEAD)) && !!lookOf(role);
  // a classic bot that is happy hops: shift up by one pixel row on alternate beats (look-based bots hop inside their sprite)
  const hop = !looks && mood === 'happy' && tick % 12 < 6;
  return paintGrid(hop ? [...px.slice(1), '..........'] : px, palette(role, mood));
}

/** Render a look that is not (yet) in the crew, e.g. while editing. */
/** A bot's look as plain pixels for other renderers (the web dashboard): 8 rows of 10 pixel codes plus a hex colour per code. */
export function lookPixels(look: Look, mood: Mood = 'idle', tick = 0): { grid: string[]; colors: Record<string, string> } {
  const hex = (c: RGB) => '#' + c.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
  return { grid: lookSprite(look, mood, tick), colors: Object.fromEntries(Object.entries(lookPalette(look)).map(([k, c]) => [k, hex(c)])) };
}

export function renderLook(look: Look, mood: Mood = 'idle', tick = 0): string[] {
  return paintGrid(lookSprite(look, mood, tick), lookPalette(look));
}

/** One-line emoticon version for table rows. */
/** One-line face for lists: built from the bot's own look so it matches its pixel sprite. Always 5 columns wide. */
export function miniBot(role: string, mood: Mood = 'idle', tick = 0): string {
  if (isMarkStyle(crewStyle)) return miniMark(crewStyle, markBot(role), mood, tick);
  const info = CREW[role] ?? CREW.coder!;
  const look = info.def?.look;
  const eyeFor = (side: 'l' | 'r'): string => {
    switch (look?.eyes) {
      case 'tall': return '|';
      case 'wide': return '—';
      case 'visor': return '▬';
      case 'sleepy': return '-';
      case 'wink': return side === 'l' ? '•' : '-';
      case 'glasses': return 'ʘ';
      default: return '•';
    }
  };
  const mouth = look?.mouth === 'open' ? 'o' : look?.mouth === 'smile' ? '‿' : look?.mouth === 'flat' ? '_' : '‿';
  const blink = mood === 'idle' && tick % 40 > 37;
  let l = eyeFor('l'), r = eyeFor('r'), m = mouth;
  if (look?.eyes === 'cyclops') {
    l = ' ';
    r = ' ';
    m = '◉';
  }
  const set: Partial<Record<Mood, [string, string, string][]>> = {
    working: [['◔', '_', '◔'], ['◕', '_', '◔'], ['◔', '_', '◕'], ['◕', '_', '◕']],
    happy: [['^', '‿', '^'], ['^', '▿', '^']],
    sad: [['×', '_', '×'], ['×', '︵', '×']],
    waiting: [['°', 'o', '°'], ['°', 'O', '°']],
    asleep: [['-', '_', '-']],
  };
  const f = set[mood];
  const face = f ? f[Math.floor(tick / (mood === 'working' ? 3 : 8)) % f.length]! : blink ? ['-', m, '-'] : [l, m, r];
  const [bl, br] = look?.body === 'square' ? ['[', ']'] : look?.body === 'wide' ? ['{', '}'] : ['(', ')'];
  return paint(info.color(), `${bl}${face.join('')}${br}`);
}

export function moodFor(status: string): Mood {
  return (
    { running: 'working', done: 'happy', error: 'sad', awaiting: 'waiting', paused: 'waiting', skipped: 'asleep', queued: 'asleep', stopped: 'sad' } as Record<string, Mood>
  )[status] ?? 'idle';
}

/** A bot with a speech bubble beside it. Returns the lines to print (4 or more rows). */
export function botSays(role: string, text: string, mood: Mood = 'idle', tick = 0, width = 60): string[] {
  const bot = renderBot(role, mood, tick);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (vlen(cur + ' ' + w) > width - 6) (lines.push(cur), (cur = w));
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  const inner = Math.max(...lines.map((l) => vlen(l)), 4);
  const info = CREW[role] ?? CREW.coder!;
  const c = (s: string) => paint(info.color(), s);
  const bubble = [c('╭' + '─'.repeat(inner + 2) + '╮'), ...lines.map((l) => `${c('│')} ${l}${' '.repeat(inner - vlen(l))} ${c('│')}`), c('╰' + '─'.repeat(inner + 2) + '╯')];
  const out: string[] = [];
  const rows = Math.max(bot.length, bubble.length);
  for (let i = 0; i < rows; i++) {
    const b = bot[i] ?? ' '.repeat(W);
    const bb = bubble[i - Math.max(0, Math.floor((bot.length - bubble.length) / 2))] ?? '';
    out.push(`${b}  ${i === Math.floor(bot.length / 2) && bubble.length <= bot.length ? c('◂') : ' '}${bb}`);
  }
  return out;
}

registerCrew(BUILTIN_BOTS.map((b) => ({ ...b, builtin: true })));

/** Re-read <home>/crew and make the registry match. Call at start-up and after any edit. */
export function refreshCrew(home: string): BotDef[] {
  const defs = loadCrew(home);
  registerCrew(defs);
  return defs;
}
