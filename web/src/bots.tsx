import { For, Show, createSignal, type JSX } from 'solid-js';
import { api } from './api';

export interface Pixels { grid: string[]; colors: Record<string, string> }
export interface Look { body: string; eyes: string; mouth: string; top: string; side: string; pattern: string; color: string; accent: string; guard?: boolean }
/** What the non-character styles draw: a glyph shape, a 3-letter symbol and two initials, all chosen by the server so the web and the terminal agree. */
export interface MarkInfo { shape: string; symbol: string; initials: string }
export interface BotDef {
  id: string; name: string; title: string; kind: string; persona: string; readOnly?: boolean; look: Look;
  builtin?: boolean; edited?: boolean; pixels?: Pixels; mark?: MarkInfo;
}

/** The active crew style ('pebble' draws the pixel bots; sigil, ticker and orbit draw marks) and the glyph grids. */
const [style, setStyle] = createSignal('pebble');
const [shapes, setShapes] = createSignal<Record<string, string[]>>({});
const [glyphs, setGlyphs] = createSignal<Record<string, string[]>>({});
export const crewStyle = style;
export const MARK_STYLES = ['sigil', 'tile', 'ticker', 'orbit'];

/** The live crew: filled from the server so your own bots appear everywhere a bot does. */
export const CREW: Record<string, { name: string; title: string; hue: string; pixels?: Pixels; mark?: MarkInfo }> = {
  orchestrator: { name: 'Maestro', title: 'orchestrator', hue: '#9b7bff' },
  planner: { name: 'Scout', title: 'planner', hue: '#5b9dff' },
  architect: { name: 'Brick', title: 'architect', hue: '#38c5d6' },
  coder: { name: 'Bolt', title: 'coder', hue: '#3fb97c' },
  tester: { name: 'Probe', title: 'tester', hue: '#e3ab3a' },
  reviewer: { name: 'Lens', title: 'reviewer', hue: '#e46fa8' },
  approval: { name: 'Gate', title: 'approver', hue: '#9aa6b8' },
};

export function applyCrew(bots: BotDef[], extra?: { style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }): void {
  for (const k of Object.keys(CREW)) delete CREW[k];
  for (const b of bots) CREW[b.id] = { name: b.name, title: b.title, hue: b.look.color, pixels: b.pixels, mark: b.mark };
  if (extra?.style) setStyle(extra.style);
  if (extra?.shapes) setShapes(extra.shapes);
  if (extra?.glyphs) setGlyphs(extra.glyphs);
}

let loaded: Promise<void> | undefined;
/** Fetch the crew once (and again when `force`). Failures leave the built-in table in place. */
export function loadCrewDefs(force = false): Promise<void> {
  if (!loaded || force) {
    loaded = api<{ bots: BotDef[]; style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }>('GET', '/api/crew').then((r) => applyCrew(r.bots, r)).catch(() => undefined);
  }
  return loaded;
}

/** Same mapping as the terminal's crewFor: which bot runs a given node. */
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

/** A bot drawn from its pixel grid: one rect per run of same-coloured pixels, crisp at any size. */
export function Sprite(props: { pixels: Pixels; size?: number; label?: string }): JSX.Element {
  const rows = () => props.pixels.grid;
  const w = 10;
  return (
    <svg viewBox={`0 0 ${w} ${rows().length}`} width={props.size ?? 40} height={((props.size ?? 40) * rows().length) / w} shape-rendering="crispEdges" role="img" aria-label={props.label ?? 'bot'}>
      <For each={rows()}>
        {(row, y) => (
          <For each={[...row]}>
            {(c, x) => (c === '.' || !props.pixels.colors[c] ? null : <rect x={x()} y={y()} width="1.02" height="1.02" fill={props.pixels.colors[c]} />)}
          </For>
        )}
      </For>
    </svg>
  );
}

const ink = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 140 ? '#10141c' : '#e6ebf2';
};
/** The same fixed series per symbol every time: a gentle line, not noise. */
const spark = (seed: string): string => {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let v = 3;
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    v = Math.max(0, Math.min(7, v + (h % 5) - 2));
    pts.push(`${(4 + i * 4.57).toFixed(1)},${(30 - v * 1.5).toFixed(1)}`);
  }
  return pts.join(' ');
};

/** A bot drawn as a mark: a bold glyph (sigil), a symbol chip with a line (ticker), or initials in a ring (orbit). */
export function Mark(props: { style: string; mark: MarkInfo; hue: string; size?: number; label?: string; progress?: number }): JSX.Element {
  const size = () => props.size ?? 40;
  return (
    <Show
      when={props.style === 'sigil'}
      fallback={
        <Show
          when={props.style === 'tile'}
          fallback={
        <Show
          when={props.style === 'ticker'}
          fallback={
            <svg viewBox="0 0 40 40" width={size()} height={size()} role="img" aria-label={props.label ?? props.mark.initials}>
              <circle cx="20" cy="20" r="17" fill="none" stroke={props.hue} stroke-opacity=".28" stroke-width="3" />
              <circle cx="20" cy="20" r="17" fill="none" stroke={props.hue} stroke-width="3" stroke-linecap="round" stroke-dasharray={`${(props.progress ?? 0.7) * 106.8} 107`} transform="rotate(-90 20 20)" />
              <circle cx="20" cy="20" r="12" fill={props.hue} />
              <text x="20" y="24.5" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" font-size="11" fill={ink(props.hue)}>{props.mark.initials}</text>
            </svg>
          }
        >
          <svg viewBox="0 0 40 40" width={size()} height={size()} role="img" aria-label={props.label ?? props.mark.symbol}>
            <rect x="3" y="5" width="34" height="14" rx="3.5" fill={props.hue} />
            <text x="20" y="15.2" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" font-size="9.5" fill={ink(props.hue)}>{props.mark.symbol}</text>
            <polyline points={spark(props.mark.symbol)} fill="none" stroke={props.hue} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        </Show>
          }
        >
          <svg viewBox="0 0 40 40" width={size()} height={size()} role="img" aria-label={props.label ?? props.mark.shape}>
            <rect x="2" y="4" width="32" height="32" rx="8" fill={props.hue} />
            <For each={glyphs()[props.mark.shape] ?? []}>
              {(row, y) => <For each={[...row]}>{(c, x) => (c === '#' ? <rect x={7 + x() * 3.6} y={9 + y() * 3.6} width="3.7" height="3.7" fill={ink(props.hue)} /> : null)}</For>}
            </For>
            <circle cx="34" cy="7" r="4.2" fill="#3fb97c" stroke="var(--panel, #10141c)" stroke-width="1.5" />
          </svg>
        </Show>
      }
    >
      <svg viewBox="0 0 10 8" width={size()} height={(size() * 8) / 10} shape-rendering="crispEdges" role="img" aria-label={props.label ?? props.mark.shape}>
        <For each={shapes()[props.mark.shape] ?? []}>
          {(row, y) => <For each={[...row]}>{(c, x) => (c === '#' ? <rect x={x()} y={y()} width="1.02" height="1.02" fill={props.hue} /> : null)}</For>}
        </For>
      </svg>
    </Show>
  );
}

/** A bot by role in the active style: a mark for sigil, ticker and orbit; otherwise its pixel look, else a plain pebble in its colour. */
export function Pebble(props: { role: string; size?: number }): JSX.Element {
  const c = () => CREW[props.role] ?? CREW.coder!;
  return (
    <>
      {MARK_STYLES.includes(style()) && c().mark ? (
        <Mark style={style()} mark={c().mark!} hue={c().hue} size={props.size} label={c().name} />
      ) : c().pixels ? (
        <Sprite pixels={c().pixels!} size={props.size} label={c().name} />
      ) : (
        <svg viewBox="0 0 32 32" width={props.size ?? 40} height={props.size ?? 40} role="img" aria-label={c().name}>
          <path d="M16 3c7 0 12.5 5 12.5 12.5 0 7.6-5 13.5-12.5 13.5S3.5 23.1 3.5 15.5C3.5 8 9 3 16 3z" fill={c().hue} />
          <circle cx="11.5" cy="18.5" r="1.9" fill="#0d1117" />
          <circle cx="20.5" cy="18.5" r="1.9" fill="#0d1117" />
        </svg>
      )}
    </>
  );
}
