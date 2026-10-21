/**
 * Terminal UI toolkit for aorch. Zero dependencies.
 *
 * Everything degrades: truecolor → 256 → 16 → plain text. When stdout is not a TTY, or NO_COLOR is set,
 * nothing animates and nothing is coloured, so piping and CI logs stay clean.
 */
import type { PipelineNode, RunState } from './types.js';
import { CREW, crewFor } from './bots.js'; // used lazily: bots.ts also imports this file

// ---------- capability detection ----------
export type ColorLevel = 0 | 1 | 2 | 3;

export function detectColorLevel(env: NodeJS.ProcessEnv = process.env, isTTY = !!process.stdout.isTTY): ColorLevel {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0;
  if (env.FORCE_COLOR === '0') return 0;
  if (!isTTY && !env.FORCE_COLOR) return 0;
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || env.FORCE_COLOR === '3') return 3;
  if (/256color/.test(env.TERM ?? '') || env.FORCE_COLOR === '2') return 2;
  return 1;
}

export const caps = {
  level: detectColorLevel(),
  tty: !!process.stdout.isTTY,
  get animate() {
    return this.tty && this.level > 0 && !process.env.AORCH_NO_ANIMATION && !process.env.CI;
  },
  get cols() {
    return Math.max(40, Math.min(process.stdout.columns || 80, 110));
  },
};

// ---------- colour ----------
export type RGB = [number, number, number];
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

/** Palette. Tuned to read on both dark and light backgrounds. */
export const pal = {
  cyan: [34, 211, 238] as RGB,
  blue: [96, 165, 250] as RGB,
  violet: [167, 139, 250] as RGB,
  pink: [244, 114, 182] as RGB,
  green: [74, 222, 128] as RGB,
  amber: [251, 191, 36] as RGB,
  red: [248, 113, 113] as RGB,
  gray: [120, 130, 150] as RGB,
  slate: [71, 85, 105] as RGB,
  text: [226, 232, 240] as RGB,
};

// xterm's 256-colour cube is NOT linear: its channel levels are 0, 95, 135, 175, 215, 255, and 232-255 is a grey ramp of 8 + 10n.
const CUBE = [0, 95, 135, 175, 215, 255];
const to256 = ([r, g, b]: RGB) => {
  const near = (v: number) => CUBE.reduce((bi, c, i) => (Math.abs(c - v) < Math.abs(CUBE[bi]! - v) ? i : bi), 0);
  const ri = near(r), gi = near(g), bi = near(b);
  const cube = [CUBE[ri]!, CUBE[gi]!, CUBE[bi]!];
  const n = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + 10 * n;
  const d = (c: number[]) => (c[0]! - r) ** 2 + (c[1]! - g) ** 2 + (c[2]! - b) ** 2;
  return d([gv, gv, gv]) < d(cube) ? 232 + n : 16 + 36 * ri + 6 * gi + bi;
};
const to16 = ([r, g, b]: RGB) => {
  const mx = Math.max(r, g, b);
  if (mx < 90) return 30;
  const bright = mx > 200 ? 60 : 0;
  const code = (r > mx * 0.6 ? 1 : 0) | (g > mx * 0.6 ? 2 : 0) | (b > mx * 0.6 ? 4 : 0);
  return 30 + code + bright;
};

export function fgCode(c: RGB, level = caps.level): string {
  if (level === 0) return '';
  if (level === 3) return `${ESC}38;2;${c[0]};${c[1]};${c[2]}m`;
  if (level === 2) return `${ESC}38;5;${to256(c)}m`;
  return `${ESC}${to16(c)}m`;
}

export const paint = (c: RGB, s: string): string => (caps.level ? `${fgCode(c)}${s}${RESET}` : s);
const sgr = (code: string) => (s: string) => (caps.level ? `${ESC}${code}m${s}${RESET}` : s);
export const bold = sgr('1');
export const dim = (s: string) => (caps.level ? `${fgCode(pal.gray)}${s}${RESET}` : s);
export const faint = (s: string) => (caps.level ? `${fgCode(pal.slate)}${s}${RESET}` : s);
export const green = (s: string) => paint(pal.green, s);
export const red = (s: string) => paint(pal.red, s);
export const amber = (s: string) => paint(pal.amber, s);
export const cyan = (s: string) => paint(pal.cyan, s);
export const violet = (s: string) => paint(pal.violet, s);

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
export function mix(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0]!;
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i]!, b = stops[i + 1]!;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

export const BRAND: RGB[] = [pal.cyan, pal.violet, pal.pink];
export const HEAT: RGB[] = [pal.green, pal.amber, pal.red];

export function bgCode(c: RGB, level = caps.level): string {
  if (level === 0) return '';
  if (level === 3) return `${ESC}48;2;${c[0]};${c[1]};${c[2]}m`;
  if (level === 2) return `${ESC}48;5;${to256(c)}m`;
  return `${ESC}${to16(c) + 10}m`;
}

// ---------- themes ----------
export interface Theme {
  label: string;
  brand: RGB[];
  pal: Partial<Record<keyof typeof pal, RGB>>;
}
const DEFAULT_PAL = { ...pal };
const g = (n: number): RGB => [n, n, n];
export const THEMES: Record<string, Theme> = {
  aurora: { label: 'cyan → violet → pink (default)', brand: [pal.cyan, pal.violet, pal.pink], pal: {} },
  sunset: {
    label: 'orange → pink → violet',
    brand: [[251, 146, 60], [244, 114, 182], [167, 139, 250]],
    pal: { cyan: [251, 146, 60], violet: [232, 121, 249], blue: [251, 191, 36], pink: [244, 114, 182] },
  },
  matrix: {
    label: 'phosphor greens',
    brand: [[22, 163, 74], [74, 222, 128], [190, 242, 100]],
    pal: { cyan: [74, 222, 128], violet: [34, 197, 94], blue: [110, 231, 183], pink: [163, 230, 53], green: [134, 239, 172], amber: [190, 242, 100], gray: [90, 140, 100], slate: [40, 90, 55], text: [220, 252, 231] },
  },
  amber: {
    label: 'amber CRT',
    brand: [[245, 158, 11], [251, 191, 36], [253, 224, 71]],
    pal: { cyan: [251, 191, 36], violet: [245, 158, 11], blue: [253, 224, 71], pink: [251, 146, 60], green: [253, 224, 71], amber: [251, 191, 36], gray: [180, 140, 60], slate: [120, 90, 30], text: [254, 243, 199] },
  },
  mono: {
    label: 'monochrome',
    brand: [g(120), g(235)],
    pal: { cyan: g(235), violet: g(200), blue: g(215), pink: g(180), green: g(235), amber: g(200), red: g(160), gray: g(125), slate: g(80), text: g(235) },
  },
};
export const PAL_KEYS = ['cyan', 'blue', 'violet', 'pink', 'green', 'amber', 'red', 'gray', 'slate', 'text'] as const;
export type PalKey = (typeof PAL_KEYS)[number];
export const BUILTIN_THEMES = new Set(Object.keys(THEMES));
export const THEME_NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;
const isRGB = (v: unknown): v is RGB => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

/** Validate a theme read from disk. Unknown or malformed parts are dropped, never trusted. */
export function sanitizeTheme(raw: unknown): Theme | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { label?: unknown; brand?: unknown; pal?: unknown };
  const p: Partial<Record<PalKey, RGB>> = {};
  for (const k of PAL_KEYS) {
    const v = (r.pal as Record<string, unknown> | undefined)?.[k];
    if (isRGB(v)) p[k] = v;
  }
  const brand = Array.isArray(r.brand) && r.brand.length >= 2 && r.brand.length <= 6 && r.brand.every(isRGB) ? (r.brand as RGB[]) : undefined;
  const merged = { ...DEFAULT_PAL, ...p };
  return { label: typeof r.label === 'string' ? r.label.slice(0, 60) : 'custom', brand: brand ?? [merged.cyan, merged.violet, merged.pink], pal: p };
}

/** Add saved custom themes. Built-in names cannot be replaced. */
export function registerThemes(custom: Record<string, unknown> | undefined) {
  for (const [name, raw] of Object.entries(custom ?? {})) {
    if (!THEME_NAME_RE.test(name) || BUILTIN_THEMES.has(name)) continue;
    const t = sanitizeTheme(raw);
    if (t) THEMES[name] = t;
  }
}

/** Apply a palette directly (used by the live theme editor); the name shows in the header. */
export function applyPalette(t: Theme, name: string) {
  Object.assign(pal, DEFAULT_PAL, t.pal);
  BRAND.length = 0;
  BRAND.push(...t.brand);
  HEAT.length = 0;
  HEAT.push(pal.green, pal.amber, pal.red);
  themeName = name;
}
export const basePalette = () => ({ ...DEFAULT_PAL });

export let themeName = 'aurora';
/** Switch palette in place so every helper (and any array holding palette entries) picks it up. */
export function setTheme(name: string): boolean {
  const t = THEMES[name];
  if (!t) return false;
  Object.assign(pal, DEFAULT_PAL, t.pal);
  BRAND.length = 0;
  BRAND.push(...t.brand);
  HEAT.length = 0;
  HEAT.push(pal.green, pal.amber, pal.red);
  themeName = name;
  return true;
}

/** Colour a string with a gradient across its visible characters. `shift` slides it (used for animation). */
export function gradient(s: string, stops: RGB[] = BRAND, shift = 0): string {
  if (!caps.level) return s;
  const chars = [...s];
  const n = Math.max(1, chars.length - 1);
  let out = '';
  chars.forEach((ch, i) => {
    out += ch === ' ' ? ch : `${fgCode(mix(stops, (((i / n + shift) % 1) + 1) % 1))}${ch}`;
  });
  return out + RESET;
}

/** A bright spot sweeping across the text: used on the step that is currently running. */
export function shimmer(s: string, base: RGB, phase: number): string {
  if (!caps.level) return s;
  const chars = [...s];
  const span = chars.length + 6;
  const centre = (phase % span) - 3;
  let out = '';
  chars.forEach((ch, i) => {
    const d = Math.abs(i - centre);
    const t = Math.max(0, 1 - d / 3);
    const c: RGB = [lerp(base[0], 255, t * 0.85), lerp(base[1], 255, t * 0.85), lerp(base[2], 255, t * 0.85)];
    out += `${fgCode(c)}${ch}`;
  });
  return out + RESET;
}

// ---------- text measurement ----------
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export const strip = (s: string) => s.replace(ANSI_RE, '');
export const vlen = (s: string) => [...strip(s)].length;

export function padEnd(s: string, w: number): string {
  const n = vlen(s);
  return n >= w ? s : s + ' '.repeat(w - n);
}
export function padStart(s: string, w: number): string {
  const n = vlen(s);
  return n >= w ? s : ' '.repeat(w - n) + s;
}

/** Truncate to a visible width, keeping ANSI sequences intact and closing any open colour. */
export function clip(s: string, w: number): string {
  if (vlen(s) <= w) return s;
  let out = '';
  let seen = 0;
  const parts = s.split(/(\x1b\[[0-9;]*[A-Za-z])/);
  for (const p of parts) {
    if (p.startsWith('\x1b[')) {
      out += p;
      continue;
    }
    for (const ch of p) {
      if (seen >= w - 1) return out + '…' + (caps.level ? RESET : '');
      out += ch;
      seen++;
    }
  }
  return out;
}

// ---------- glyphs & formatting ----------
export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const dur = (ms: number) =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
export const usd = (n: number) => `$${n.toFixed(2)}`;
export const ago = (t: number) => dur(Date.now() - t) + ' ago';
export const clock = (t = Date.now()) => new Date(t).toTimeString().slice(0, 8);

export function glyph(status: string, frame = 0): string {
  switch (status) {
    case 'done':
      return green('✔');
    case 'error':
      return red('✘');
    case 'running':
      return paint(mix(BRAND, (frame % 20) / 20), SPIN[frame % SPIN.length]!);
    case 'awaiting':
    case 'paused':
      return amber('◉');
    case 'skipped':
      return dim('◌');
    case 'stopped':
      return amber('■');
    default:
      return faint('○');
  }
}

export const statusColor = (s: string): RGB =>
  ({ done: pal.green, error: pal.red, running: pal.cyan, awaiting: pal.amber, paused: pal.amber, stopped: pal.amber, skipped: pal.gray })[s] ?? pal.gray;

// ---------- components ----------
/** A horizontal meter whose fill shifts green → amber → red as it fills. */
export function meter(frac: number, width = 16, stops: RGB[] = HEAT): string {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  let out = '';
  for (let i = 0; i < width; i++) {
    out += i < filled ? paint(mix(stops, width === 1 ? 0 : i / (width - 1)), '▰') : faint('▱');
  }
  return out;
}

const BARS = '▁▂▃▄▅▆▇█';
/** A tiny line chart: one block character per value, scaled between the series min and max. Colour follows the trend. */
export function spark(values: number[], width = 20, color: RGB = pal.green): string {
  const v = values.slice(-width);
  if (!v.length) return faint('▁'.repeat(Math.min(width, 3)));
  const mn = Math.min(...v), mx = Math.max(...v);
  const chars = v.map((x) => BARS[mx === mn ? 0 : Math.min(7, Math.floor(((x - mn) / (mx - mn)) * 7.999))]!).join('');
  return paint(color, chars.slice(0, -1)) + paint(pal.amber, chars.slice(-1));
}

export interface BoxOpts {
  title?: string;
  footer?: string;
  width?: number;
  border?: RGB[];
  pad?: number;
}

/** A rounded box. Title and footer sit in the border. Border colour can be a gradient. */
export function box(lines: string[], o: BoxOpts = {}): string[] {
  const width = o.width ?? caps.cols;
  const inner = width - 2;
  const pad = o.pad ?? 1;
  const stops = o.border ?? [pal.slate];
  const edge = (s: string, i: number, n: number) => paint(mix(stops, n <= 1 ? 0 : i / (n - 1)), s);
  const bar = (left: string, right: string, label?: string) => {
    const lab = label ? ` ${label} ` : '';
    const room = inner - vlen(lab) - 1;
    const fill = '─'.repeat(Math.max(0, room));
    const raw = `${left}─${lab}${fill}${right}`;
    if (!label) return gradientBorder(raw, stops);
    // colour the border parts, keep the label as-is
    const l = gradientBorder(`${left}─`, stops);
    const r = gradientBorder(`${fill}${right}`, stops, 0.5);
    return `${l}${lab}${r}`;
  };
  const out: string[] = [];
  out.push(bar('╭', '╮', o.title));
  for (const [i, line] of lines.entries()) {
    const body = padEnd(clip(line, inner - pad * 2), inner - pad * 2);
    out.push(`${edge('│', 0, 1)}${' '.repeat(pad)}${body}${' '.repeat(pad)}${edge('│', 1, 2)}`);
    void i;
  }
  out.push(bar('╰', '╯', o.footer));
  return out;
}

function gradientBorder(s: string, stops: RGB[], offset = 0): string {
  if (!caps.level) return s;
  return gradient(s, stops.length > 1 ? stops : [stops[0]!, stops[0]!], offset);
}

const LOGO = [
  ' ▄▀█ █▀█ █▀█ █▀▀ █ █',
  ' █▀█ █▄█ █▀▄ █▄▄ █▀█',
];

/** The wordmark, with a diagonal gradient. Optionally revealed line by line. */
export async function banner(subtitle?: string, opts: { animate?: boolean } = {}): Promise<void> {
  const animate = opts.animate ?? caps.animate;
  const lines = LOGO.map((l, i) => gradient(l, BRAND, i * 0.08));
  const sub = subtitle ? `  ${dim(subtitle)}` : '';
  for (const [i, l] of lines.entries()) {
    process.stdout.write(`${l}${i === 1 ? sub : ''}\n`);
    if (animate) await new Promise((r) => setTimeout(r, 55));
  }
  process.stdout.write('\n');
}

/** Typewriter reveal for a single line. */
export async function typeLine(s: string, ms = 12): Promise<void> {
  if (!caps.animate) return void process.stdout.write(s + '\n');
  const parts = s.split(/(\x1b\[[0-9;]*[A-Za-z])/);
  for (const p of parts) {
    if (p.startsWith('\x1b[')) process.stdout.write(p);
    else
      for (const ch of p) {
        process.stdout.write(ch);
        await new Promise((r) => setTimeout(r, ms));
      }
  }
  process.stdout.write('\n');
}

/** Simple aligned table. Cells may contain ANSI. */
export function table(rows: string[][], gap = 2): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, vlen(c))));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : padEnd(c, widths[i]!))).join(' '.repeat(gap)));
}

// ---------- live run board ----------
export interface BoardInput {
  state: RunState;
  frame: number;
  now: number;
}

const nodeLabel = (n: RunState['pipeline']['nodes'][number]) => (n.spawn ? spawnedLabel(n) : n.title ?? n.role ?? n.kind);

/** Display order for lists: each spawned step sits right after its manager (and its earlier siblings), the rest keep their order. */
export function underManagers(nodes: PipelineNode[]): PipelineNode[] {
  const kids = new Map<string, PipelineNode[]>();
  for (const n of nodes) if (n.spawn) kids.set(n.spawn.parent, [...(kids.get(n.spawn.parent) ?? []), n]);
  const out: PipelineNode[] = [];
  const add = (n: PipelineNode) => {
    out.push(n);
    for (const k of kids.get(n.id) ?? []) add(k);
  };
  for (const n of nodes) if (!n.spawn || !nodes.some((m) => m.id === n.spawn!.parent)) add(n);
  return out;
}

/** A step a manager handed out: `↳ <bot name>` plus its title. Other steps get their plain label. */
export function spawnedLabel(n: PipelineNode): string {
  if (!n.spawn) return n.title ?? n.role ?? n.kind;
  const bot = CREW[crewFor(n)]?.name ?? n.role ?? 'bot';
  return n.title ? `↳ ${bot} · ${n.title}` : `↳ ${bot}`;
}

/** Pure: produce the board for one frame. Kept separate from I/O so it can be tested and screenshotted. */
export function renderBoard({ state: s, frame, now }: BoardInput, width = caps.cols): string[] {
  const nodes = underManagers(s.pipeline.nodes);
  const inner = width - 4;
  const labelW = Math.min(18, Math.max(...nodes.map((n) => vlen(nodeLabel(n))), 6));
  const kindW = Math.max(...nodes.map((n) => vlen(n.kind === 'agent' ? n.agent ?? 'agent' : n.kind)), 5);
  const rows: string[] = [];

  for (const n of nodes) {
    const ns = s.nodes[n.id];
    const st = ns?.status ?? 'queued';
    const label = padEnd(clip(nodeLabel(n), labelW), labelW);
    const name =
      st === 'running' ? shimmer(label, pal.cyan, Math.floor(frame / 1.5)) : st === 'done' ? paint(pal.text, label) : st === 'error' ? red(label) : st === 'awaiting' ? amber(label) : dim(label);
    const tool = dim(padEnd(n.kind === 'agent' ? n.agent ?? 'agent' : n.kind, kindW));
    const end = st === 'running' || !ns?.finishedAt || ns.finishedAt < (ns.startedAt ?? 0) ? now : ns.finishedAt;
    const elapsed = ns?.startedAt ? dur(Math.max(0, end - ns.startedAt)) : '';
    const bits: string[] = [];
    if (ns?.verdict) bits.push(ns.verdict === 'PASS' ? green('PASS') : red('FAIL'));
    if (ns && ns.attempts > 1) bits.push(amber(`↻${ns.attempts}`));
    if (ns?.loops) bits.push(amber(`loops ${ns.loops}`));
    if (ns?.commit) bits.push(dim(ns.commit.slice(0, 7)));
    if (st === 'awaiting') bits.push(amber('needs approval'));
    if (st === 'skipped') bits.push(dim('skipped'));
    const cost = ns?.costUsd ? dim(usd(ns.costUsd)) : '';
    const left = `${glyph(st, frame)} ${name}  ${tool}`;
    const right = [bits.join(' '), dim(padStart(elapsed, 6)), padStart(cost, 6)].filter((x) => vlen(x)).join('  ');
    const gap = Math.max(2, inner - vlen(left) - vlen(right));
    rows.push(`${left}${' '.repeat(gap)}${right}`);
    if (st === 'running' && ns?.live) {
      const last = ns.live.trim().split('\n').filter(Boolean).pop() ?? '';
      if (last) rows.push(`  ${faint('╰')} ${dim(clip(last.replace(/\s+/g, ' '), inner - 5))}`);
    }
  }

  const cap = s.pipeline.settings.maxCostUsd;
  const frac = cap ? s.costUsd / cap : 0;
  const finished = s.finishedAt ?? now;
  const foot = [
    cap ? `${meter(frac, 12)} ${usd(s.costUsd)}${dim(` / ${usd(cap)}`)}` : `${dim('spent')} ${usd(s.costUsd)}`,
    dim('·'),
    dim(dur(finished - s.startedAt)),
  ].join(' ');

  const sc = statusColor(s.status);
  const title = `${paint(pal.cyan, '◈')} ${bold(s.pipeline.name)} ${faint('·')} ${paint(sc, s.status)}`;
  return box(rows, { title, footer: foot, width, border: s.status === 'done' ? [pal.green, pal.cyan] : s.status === 'error' ? [pal.red, pal.pink] : s.status === 'paused' ? [pal.amber, pal.pink] : BRAND });
}

/** Animated live view: a board pinned to the bottom, events scrolling above it. */
export class LiveBoard {
  private timer?: NodeJS.Timeout;
  private lines = 0;
  private frame = 0;
  private active = false;

  constructor(private readonly getState: () => RunState | undefined, private readonly out: NodeJS.WriteStream = process.stdout) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.out.write(`${ESC}?25l`); // hide cursor
    const restore = () => this.out.write(`${ESC}?25h`);
    process.once('exit', restore);
    this.draw();
    this.timer = setInterval(() => {
      this.frame++;
      this.draw();
    }, 80);
    this.timer.unref();
  }

  /** Print a line above the board. */
  log(text: string) {
    if (!this.active) return void this.out.write(text + '\n');
    this.erase();
    this.out.write(text + '\n');
    this.draw();
  }

  /** Freeze the final frame in place and give the cursor back. */
  stop() {
    if (!this.active) return;
    clearInterval(this.timer);
    this.active = false;
    this.erase();
    this.draw();
    this.out.write(`${ESC}?25h`);
    this.lines = 0;
  }

  private erase() {
    if (this.lines) this.out.write(`${ESC}${this.lines}A${ESC}J`);
    this.lines = 0;
  }

  private draw() {
    const s = this.getState();
    if (!s) return;
    this.erase();
    const board = renderBoard({ state: s, frame: this.frame, now: Date.now() });
    this.out.write(board.join('\n') + '\n');
    this.lines = board.length;
  }
}

/** Final result card. */
export function resultCard(s: RunState, extra: string[] = []): string[] {
  const sc = statusColor(s.status);
  const head = `${glyph(s.status)} ${bold(paint(sc, s.status.toUpperCase()))}  ${dim(`run ${s.id}`)}`;
  const cap = s.pipeline.settings.maxCostUsd;
  const lines = [
    head,
    `${dim('cost    ')} ${usd(s.costUsd)}${cap ? dim(` of ${usd(cap)}`) : ''}   ${dim('time')} ${dur((s.finishedAt ?? Date.now()) - s.startedAt)}`,
    `${dim('branch  ')} ${cyan(s.branch)}`,
    `${dim('worktree')} ${s.workdir}`,
  ];
  if (s.error) lines.push('', red(s.error.split('\n')[0]!));
  lines.push(...extra);
  return box(lines, { width: caps.cols, border: s.status === 'done' ? [pal.green, pal.cyan] : s.status === 'error' ? [pal.red, pal.pink] : [pal.amber, pal.pink] });
}
