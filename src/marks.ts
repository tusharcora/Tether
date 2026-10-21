/**
 * Crew styles that are not characters: three ways to show a bot as a mark.
 *
 *   sigil   a bold geometric glyph (hollow when idle, solid when working) for dense terminals
 *   tile    a coloured square holding the glyph, with a status light in the corner (like an app icon)
 *   ticker  a three-letter symbol chip, a stance arrow and a sparkline, like a watchlist
 *   orbit   two initials inside a ring that spins while the bot works
 *
 * Every renderer returns 4 rows × 10 columns (the same footprint as a sprite) or, for `mini*`, exactly 5 columns,
 * so no layout needs to know which style is active. They are pure: id, name, colour, mood and tick in, text out.
 */
import { bgCode, caps, fgCode, mix, pal, paint, SPIN, type RGB } from './ui.js';

export type MarkMood = 'idle' | 'working' | 'happy' | 'sad' | 'waiting' | 'asleep';
export type MarkStyle = 'sigil' | 'tile' | 'ticker' | 'orbit';
export const MARK_STYLES: Record<MarkStyle, string> = {
  sigil: 'a bold glyph per bot: hollow when idle, solid when working (for engineers)',
  tile: 'a coloured square with the bot\'s glyph and a status light, like an app icon',
  ticker: 'a symbol chip, stance arrow and sparkline, like a watchlist (for traders)',
  orbit: 'initials in a ring that spins while the bot works (for dashboards)',
};
export const isMarkStyle = (s: string): s is MarkStyle => s in MARK_STYLES;

export interface MarkBot {
  id: string;
  name: string;
  color: RGB;
}

const W = 10;
const DARK: RGB = [16, 20, 28];
const LIGHT: RGB = [226, 232, 240];

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const lum = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;
const inkOn = (bg: RGB): RGB => (lum(bg) > 140 ? DARK : LIGHT);

/** The colour a bot shows in a mood: its own while working, signal colours when something needs attention. */
export function moodColor(base: RGB, mood: MarkMood): RGB {
  switch (mood) {
    case 'happy': return pal.green;
    case 'sad': return pal.red;
    case 'waiting': return pal.amber;
    case 'asleep': return mix([base, pal.slate], 0.6);
    case 'idle': return mix([base, pal.slate], 0.25);
    default: return base;
  }
}

// ---------- shared drawing ----------
/** One terminal row from two pixel rows. `colors` maps a code to a colour; '.' is empty. */
function paintRows(grid: string[], colors: Record<string, RGB | undefined>, letters?: Record<string, { ch: string; bg: RGB; fg: RGB }>): string[] {
  const out: string[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const over = letters?.[`${y / 2},${x}`];
      if (over) {
        line += caps.level ? `${bgCode(over.bg)}${fgCode(over.fg)}\x1b[1m${over.ch}\x1b[0m` : over.ch;
        continue;
      }
      const tc = grid[y]![x]!, bc = grid[y + 1]![x]!;
      const top = colors[tc], bot = colors[bc];
      if (!caps.level) line += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
      else if (top && bot) line += `${fgCode(top)}${bgCode(bot)}▀\x1b[0m`;
      else if (top) line += `${fgCode(top)}▀\x1b[0m`;
      else if (bot) line += `${fgCode(bot)}▄\x1b[0m`;
      else line += ' ';
    }
    out.push(line);
  }
  return out;
}

const blank = () => ' '.repeat(W);
const centre = (visible: string, width: number, total = W) => {
  const left = Math.max(0, Math.floor((total - width) / 2));
  return ' '.repeat(left) + visible + ' '.repeat(Math.max(0, total - left - width));
};

// ---------- sigil ----------
/** Seven solid shapes on a 10×8 pixel grid. */
export const SHAPES: Record<string, string[]> = {
  diamond: ['....##....', '...####...', '..######..', '.########.', '.########.', '..######..', '...####...', '....##....'],
  triangle: ['....##....', '....##....', '...####...', '...####...', '..######..', '..######..', '.########.', '.########.'],
  square: ['..........', '..######..', '..######..', '..######..', '..######..', '..######..', '..######..', '..........'],
  circle: ['...####...', '..######..', '.########.', '.########.', '.########.', '.########.', '..######..', '...####...'],
  hex: ['..######..', '.########.', '##########', '##########', '##########', '##########', '.########.', '..######..'],
  plus: ['...####...', '...####...', '##########', '##########', '##########', '##########', '...####...', '...####...'],
  arrow: ['..##......', '..####....', '..######..', '..########', '..########', '..######..', '..####....', '..##......'],
};
const SHAPE_ORDER = Object.keys(SHAPES);
/** Built-in bots keep a fixed shape; everyone else gets one from a hash of their id, so it never changes. */
const BUILTIN_SHAPE: Record<string, string> = { orchestrator: 'plus', planner: 'diamond', architect: 'hex', coder: 'triangle', tester: 'square', reviewer: 'circle', approval: 'arrow' };
export const shapeOf = (id: string): string => BUILTIN_SHAPE[id] ?? SHAPE_ORDER[hash(id) % SHAPE_ORDER.length]!;

const SOLID_CHAR: Record<string, string> = { diamond: '◆', triangle: '▲', square: '■', circle: '●', hex: '◉', plus: '✚', arrow: '▶' };
const HOLLOW_CHAR: Record<string, string> = { diamond: '◇', triangle: '△', square: '□', circle: '○', hex: '◎', plus: '✛', arrow: '▷' };

const filled = (g: string[], x: number, y: number) => y >= 0 && y < g.length && x >= 0 && x < W && g[y]![x] === '#';
function hollow(shape: string[]): string[] {
  return shape.map((row, y) =>
    [...row].map((c, x) => (c !== '#' ? '.' : filled(shape, x - 1, y) && filled(shape, x + 1, y) && filled(shape, x, y - 1) && filled(shape, x, y + 1) ? '.' : '#')).join(''),
  );
}

export function sigil(bot: MarkBot, mood: MarkMood, tick: number): string[] {
  const shape = SHAPES[shapeOf(bot.id)]!;
  const col = moodColor(bot.color, mood);
  const open = mood === 'idle' || mood === 'asleep' || mood === 'sad' || (mood === 'waiting' && tick % 16 >= 10);
  const grid = (open ? hollow(shape) : shape).map((r) => r.replace(/#/g, 'B'));
  if (mood === 'sad') {
    // a failed bot is an outline with a solid core, like a target that was hit
    for (const [x, y] of [[4, 3], [5, 3], [4, 4], [5, 4]] as const) grid[y] = grid[y]!.slice(0, x) + 'B' + grid[y]!.slice(x + 1);
  }
  const colors: Record<string, RGB> = { B: col };
  if (mood === 'working') {
    // a soft band of light sweeps down the shape; the shape itself never changes
    const band = Math.floor(tick / 2) % 12 - 2;
    colors.L = mix([col, LIGHT], 0.4);
    for (let y = 0; y < 8; y++) if (y === band || y === band + 1) grid[y] = grid[y]!.replace(/B/g, 'L');
  }
  return paintRows(grid, colors);
}

export function miniSigil(bot: MarkBot, mood: MarkMood, tick: number): string {
  const s = shapeOf(bot.id);
  const col = moodColor(bot.color, mood);
  const glyph = mood === 'idle' || mood === 'asleep' || mood === 'sad' ? HOLLOW_CHAR[s]! : SOLID_CHAR[s]!;
  const mark =
    mood === 'working' ? SPIN[Math.floor(tick / 2) % SPIN.length]! : mood === 'happy' ? '✔' : mood === 'sad' ? '✘' : mood === 'waiting' ? '…' : ' ';
  return paint(col, glyph) + ' ' + paint(col, mark) + '  ';
}

// ---------- tile ----------
/** The glyph cut into the tile, 6×6 pixels. */
const GLYPH: Record<string, string[]> = {
  diamond: ['..##..', '.####.', '######', '######', '.####.', '..##..'],
  triangle: ['..##..', '..##..', '.####.', '.####.', '######', '######'],
  square: ['......', '.####.', '.####.', '.####.', '.####.', '......'],
  circle: ['.####.', '######', '######', '######', '######', '.####.'],
  hex: ['.####.', '#....#', '#....#', '#....#', '#....#', '.####.'],
  plus: ['..##..', '..##..', '######', '######', '..##..', '..##..'],
  arrow: ['.#....', '.###..', '.####.', '.####.', '.###..', '.#....'],
};
export const GLYPHS = GLYPH;

/** The status light: green done, amber waiting, red failed, a slow pulse while working, dim otherwise. */
function light(base: RGB, mood: MarkMood, tick: number): RGB {
  switch (mood) {
    case 'happy': return pal.green;
    case 'sad': return pal.red;
    case 'waiting': return tick % 16 < 10 ? pal.amber : mix([pal.amber, pal.slate], 0.6);
    case 'working': return mix([base, LIGHT], 0.25 + 0.35 * Math.abs(Math.sin(tick / 4)));
    default: return mix([pal.slate, base], 0.2);
  }
}

export function tile(bot: MarkBot, mood: MarkMood, tick: number): string[] {
  const body = mood === 'idle' ? mix([bot.color, pal.slate], 0.3) : mood === 'asleep' ? mix([bot.color, pal.slate], 0.6) : bot.color;
  const g = GLYPH[shapeOf(bot.id)]!;
  const grid = [...Array(8)].map(() => Array(W).fill('.'));
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (!((y === 0 || y === 7) && (x === 0 || x === 7))) grid[y]![x] = 'B';
  g.forEach((row, y) => [...row].forEach((c, x) => c === '#' && (grid[y + 1]![x + 1] = 'D')));
  for (const [x, y] of [[8, 0], [9, 0], [8, 1], [9, 1]] as const) grid[y]![x] = 'L';
  return paintRows(grid.map((r) => r.join('')), { B: body, D: inkOn(bot.color), L: light(bot.color, mood, tick) });
}

const SOLID_TILE_CHAR: Record<string, string> = { diamond: '◆', triangle: '▲', square: '■', circle: '●', hex: '◉', plus: '✚', arrow: '▶' };
export function miniTile(bot: MarkBot, mood: MarkMood, tick: number): string {
  const body = mood === 'idle' ? mix([bot.color, pal.slate], 0.3) : mood === 'asleep' ? mix([bot.color, pal.slate], 0.6) : bot.color;
  const glyph = SOLID_TILE_CHAR[shapeOf(bot.id)]!;
  const t = caps.level ? `${bgCode(body)}${fgCode(inkOn(bot.color))} ${glyph} \x1b[0m` : `[${glyph}]`;
  return t + paint(light(bot.color, mood, tick), '●') + ' ';
}

// ---------- ticker ----------
const VOWELS = new Set('AEIOU');
/** A three-letter symbol from a name: first letter, then the next consonants (Scout → SCT, Quant → QNT). */
export function symbolOf(name: string): string {
  const letters = [...name.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c));
  if (!letters.length) return 'BOT';
  const out = [letters[0]!];
  for (const c of letters.slice(1)) if (out.length < 3 && !VOWELS.has(c)) out.push(c);
  for (const c of letters.slice(1).reverse()) if (out.length < 3 && !out.includes(c)) out.push(c);
  while (out.length < 3) out.push('X');
  return out.join('');
}

const BLOCKS = '▁▂▃▄▅▆▇█';
/** A repeatable series for a bot: the same id always draws the same line. */
function series(id: string, n: number, offset: number): number[] {
  // a gentle random walk, so it reads as a price line and not as noise; the same id and offset always give the same values
  const out: number[] = [];
  let v = 3 + (hash(id) % 3);
  for (let i = 0; i < offset + n; i++) {
    v = Math.max(0, Math.min(7, v + (hash(`${id}:${i}`) % 5) - 2));
    if (i >= offset) out.push(v);
  }
  return out;
}
function spark(id: string, mood: MarkMood, tick: number, n: number): string {
  if (mood === 'asleep') return '┈'.repeat(n);
  if (mood === 'waiting') return '▄'.repeat(n);
  if (mood === 'happy') return [...Array(n)].map((_, i) => BLOCKS[Math.min(7, Math.round(1 + (i * 6) / Math.max(1, n - 1)))]).join('');
  if (mood === 'sad') return [...Array(n)].map((_, i) => BLOCKS[Math.max(0, Math.round(6 - (i * 6) / Math.max(1, n - 1)))]).join('');
  // idle holds still; working scrolls slowly past the same fixed series
  const off = mood === 'working' ? Math.floor(tick / 4) : 0;
  return series(id, n, off).map((v) => BLOCKS[v]).join('');
}
const STANCE: Record<MarkMood, string> = { working: '▲', happy: '▲', sad: '▼', waiting: '■', idle: '–', asleep: '–' };

const chip = (sym: string, bg: RGB) => (caps.level ? `${bgCode(bg)}${fgCode(inkOn(bg))}\x1b[1m ${sym} \x1b[0m` : `[${sym}]`);

export function ticker(bot: MarkBot, mood: MarkMood, tick: number): string[] {
  const col = moodColor(bot.color, mood);
  const sym = symbolOf(bot.name);
  const stance = mood === 'working' || mood === 'happy' ? STANCE[mood] : STANCE[mood];
  const line = `${paint(col, stance)} ${paint(col, spark(bot.id, mood, tick, 6))}`;
  const chipW = caps.level ? 5 : 5; // " SCT " or "[SCT]"
  return [blank(), centre(chip(sym, mood === 'sad' ? pal.red : mood === 'waiting' ? pal.amber : col), chipW), centre(line, 8), blank()];
}

export function miniTicker(bot: MarkBot, mood: MarkMood, tick: number): string {
  const col = moodColor(bot.color, mood);
  const s = spark(bot.id, mood, tick, 1);
  // SCT + arrow + one spark cell = 5 columns
  const sym = symbolOf(bot.name);
  const c = caps.level ? `${bgCode(col)}${fgCode(inkOn(col))}\x1b[1m${sym}\x1b[0m` : sym;
  return c + paint(col, STANCE[mood]) + paint(col, s);
}

// ---------- orbit ----------
/** An 8×7 pixel ring (18 pixels, clockwise from the top) around a pill-shaped core that holds the initials. */
const RING: [number, number][] = [
  [3, 0], [4, 0], [5, 0], [6, 0], [7, 1], [8, 2], [8, 3], [8, 4], [7, 5], [6, 6], [5, 6], [4, 6], [3, 6], [2, 5], [1, 4], [1, 3], [1, 2], [2, 1],
];
const CORE: [number, number][] = [];
for (let y = 2; y <= 3; y++) for (let x = 3; x <= 6; x++) CORE.push([x, y]);

/** Two initials: first letter and the next consonant or letter (Scout → SC, Bolt → BO). */
export const initialsOf = (name: string): string => {
  const l = [...name.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c));
  return ((l[0] ?? 'B') + (l[1] ?? '')).padEnd(2, ' ').slice(0, 2);
};

export function orbit(bot: MarkBot, mood: MarkMood, tick: number): string[] {
  const body = bot.color;
  const track = mix([body, pal.slate], 0.7);
  const dim = mood === 'idle' || mood === 'asleep';
  const core = dim ? mix([body, pal.slate], mood === 'asleep' ? 0.75 : 0.5) : mood === 'sad' ? mix([body, pal.red], 0.5) : body;
  const hot = mood === 'happy' ? pal.green : mood === 'sad' ? pal.red : mood === 'waiting' ? pal.amber : body;
  const grid: string[][] = [...Array(8)].map(() => Array(W).fill('.'));
  const put = (x: number, y: number, c: string) => void (grid[y]![x] = c);
  for (const [x, y] of CORE) put(x, y, 'C');
  RING.forEach(([x, y], i) => {
    let lit = false;
    if (mood === 'working') lit = (i - Math.floor(tick / 2) + 180) % RING.length < 6;
    else if (mood === 'happy' || mood === 'sad') lit = true;
    else if (mood === 'waiting') lit = (i + Math.floor(tick / 8)) % 2 === 0;
    put(x, y, lit ? 'R' : 'T');
  });
  // the initials sit in the core: cell row 1, columns 4 and 5
  const letters = initialsOf(bot.name);
  const ink = inkOn(core);
  return paintRows(grid.map((r) => r.join('')), { C: core, R: hot, T: track }, {
    '1,4': { ch: letters[0]!, bg: core, fg: ink },
    '1,5': { ch: letters[1]!, bg: core, fg: ink },
  });
}

const DIAL = ['○', '◔', '◑', '◕'];
export function miniOrbit(bot: MarkBot, mood: MarkMood, tick: number): string {
  const col = moodColor(bot.color, mood);
  const dial = mood === 'working' ? DIAL[Math.floor(tick / 4) % 4]! : mood === 'happy' || mood === 'sad' ? '●' : '○';
  return paint(col, dial) + ' ' + paint(col, initialsOf(bot.name)) + ' ';
}

// ---------- entry points ----------
export function renderMark(style: MarkStyle, bot: MarkBot, mood: MarkMood, tick: number): string[] {
  return style === 'sigil' ? sigil(bot, mood, tick) : style === 'tile' ? tile(bot, mood, tick) : style === 'ticker' ? ticker(bot, mood, tick) : orbit(bot, mood, tick);
}
export function miniMark(style: MarkStyle, bot: MarkBot, mood: MarkMood, tick: number): string {
  return style === 'sigil' ? miniSigil(bot, mood, tick) : style === 'tile' ? miniTile(bot, mood, tick) : style === 'ticker' ? miniTicker(bot, mood, tick) : miniOrbit(bot, mood, tick);
}
