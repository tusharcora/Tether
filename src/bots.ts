/**
 * The aorch crew: small original pixel-art bots, one per role, drawn in the terminal with half-block characters.
 * Each pixel is a colour; two pixel rows share one terminal row (▀ foreground = top pixel, background = bottom pixel).
 */
import { bgCode, caps, fgCode, mix, pal, paint, vlen, type RGB } from './ui.js';

export type Mood = 'idle' | 'working' | 'happy' | 'sad' | 'waiting' | 'asleep';

export interface BotInfo {
  name: string;
  title: string;
  color: () => RGB;
  accent: () => RGB;
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

/** Map a pipeline node to one of the crew. */
export function crewFor(node: { kind: string; role?: string }): string {
  if (node.kind === 'gate') return 'tester';
  if (node.kind === 'approval') return 'approval';
  const r = (node.role ?? '').toLowerCase();
  if (r in CREW) return r;
  if (/test|qa/.test(r)) return 'tester';
  if (/review|audit/.test(r)) return 'reviewer';
  if (/arch|design/.test(r)) return 'architect';
  if (/plan|research|spec/.test(r)) return 'planner';
  return 'coder';
}

export type CrewStyle = 'classic' | 'pebble';
export const CREW_STYLES: Record<CrewStyle, string> = { classic: 'visor bots with antennae and faces', pebble: 'minimal: one flat shape, two eyes, one mark' };
export let crewStyle: CrewStyle = 'classic';
export function setCrewStyle(s: string): boolean {
  if (!(s in CREW_STYLES)) return false;
  crewStyle = s as CrewStyle;
  return true;
}

// Pebble crew: 8x6 pixel grids (# body, a accent, e eye), centred in the same 10x8 cell as the classic bots.
const PEBBLE: Record<string, string[]> = {
  orchestrator: ['.a.aa.a.', '.######.', '.#e##e#.', '.######.', '.######.', '..#..#..'],
  planner: ['...aa...', '..####..', '.#e##e#.', '.######.', '..####..', '..#..#..'],
  architect: ['..aaaa..', '.######.', '.#e##e#.', '.######.', '.######.', '..#..#..'],
  coder: ['..####..', 'a######a', 'a#e##e#a', '.######.', '..####..', '..#..#..'],
  tester: ['.a....a.', '..####..', '.#e##e#.', '.######.', '..####..', '..#..#..'],
  reviewer: ['..####..', '.###aaa.', '.#e#aea.', '.###aaa.', '..####..', '..#..#..'],
  approval: ['..####..', '.######.', '.#e##e#.', '.######.', '.######.', '.######.'],
};

function pebbleSprite(role: string, mood: Mood, tick: number): string[] {
  const g = (PEBBLE[role] ?? PEBBLE.coder!).map((r) => r.split(''));
  const eyes: [number, number][] = [];
  g.forEach((row, y) => row.forEach((c, x) => c === 'e' && eyes.push([x, y])));
  let dx = 0, dy = 0, closed = false;
  if (mood === 'working') dx = [-1, 0, 1, 0][Math.floor(tick / 3) % 4]!;
  else if (mood === 'waiting') dy = -1;
  else if (mood === 'sad') dy = 1;
  else if (mood === 'asleep' || (mood === 'idle' && tick % 40 > 37)) closed = true;
  for (const [x, y] of eyes) g[y]![x] = '#';
  if (!closed) for (const [x, y] of eyes) if (g[y + dy]?.[x + dx] === '#') g[y + dy]![x + dx] = 'e';
  const hop = mood === 'happy' && tick % 12 < 6 ? -1 : 0;
  const out = Array.from({ length: 8 }, () => '..........'.split(''));
  g.forEach((row, y) => row.forEach((c, x) => {
    const ty = y + 1 + hop;
    if (c !== '.' && out[ty]) out[ty]![x + 1] = c === '#' ? 'B' : c === 'a' ? 'A' : 'E';
  }));
  return out.map((r) => r.join(''));
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
  if (crewStyle === 'pebble') return pebbleSprite(role, mood, tick);
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
  const info = CREW[role] ?? CREW.coder!;
  let body = info.color();
  if (mood === 'asleep') body = mix([body, pal.slate], 0.55);
  if (mood === 'sad') body = mix([body, pal.red], 0.25);
  return {
    B: body,
    b: shade(body, 0.62),
    V: shade(body, 0.3),
    E: crewStyle === 'pebble' ? [15, 20, 32] : mood === 'sad' ? pal.red : mood === 'happy' ? pal.green : [240, 249, 255],
    M: mood === 'sad' ? pal.red : [240, 249, 255],
    A: info.accent(),
  };
}

/** Render a bot to 4 terminal rows (10 columns wide). */
export function renderBot(role: string, mood: Mood = 'idle', tick = 0): string[] {
  const px = sprite(role, mood, tick);
  const colors = palette(role, mood);
  // a happy bot hops: shift up by one pixel row on alternate beats
  const hop = mood === 'happy' && tick % 12 < 6;
  const grid = hop ? [...px.slice(1), '..........'] : px;
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

/** One-line emoticon version for table rows. */
export function miniBot(role: string, mood: Mood = 'idle', tick = 0): string {
  const info = CREW[role] ?? CREW.coder!;
  const faces: Record<Mood, string[]> = {
    idle: ['(•‿•)', '(•‿•)', '(-‿-)'],
    working: ['(◔_◔)', '(◕_◔)', '(◔_◕)', '(◕_◕)'],
    happy: ['(^‿^)', '(^▿^)'],
    sad: ['(×_×)', '(×︵×)'],
    waiting: ['(°o°)', '(°O°)'],
    asleep: ['(-_-)', '(-_-)ᶻ'],
  };
  const set = faces[mood];
  return paint(info.color(), set[Math.floor(tick / (mood === 'working' ? 3 : 8)) % set.length]!);
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
