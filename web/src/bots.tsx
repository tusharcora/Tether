import { For, type JSX } from 'solid-js';
import { api } from './api';

export interface Pixels { grid: string[]; colors: Record<string, string> }
export interface Look { body: string; eyes: string; mouth: string; top: string; side: string; pattern: string; color: string; accent: string; guard?: boolean }
export interface BotDef {
  id: string; name: string; title: string; kind: string; persona: string; readOnly?: boolean; look: Look;
  builtin?: boolean; edited?: boolean; pixels?: Pixels;
}

/** The live crew: filled from the server so your own bots appear everywhere a bot does. */
export const CREW: Record<string, { name: string; title: string; hue: string; pixels?: Pixels }> = {
  orchestrator: { name: 'Maestro', title: 'orchestrator', hue: '#9b7bff' },
  planner: { name: 'Scout', title: 'planner', hue: '#5b9dff' },
  architect: { name: 'Brick', title: 'architect', hue: '#38c5d6' },
  coder: { name: 'Bolt', title: 'coder', hue: '#3fb97c' },
  tester: { name: 'Probe', title: 'tester', hue: '#e3ab3a' },
  reviewer: { name: 'Lens', title: 'reviewer', hue: '#e46fa8' },
  approval: { name: 'Gate', title: 'approver', hue: '#9aa6b8' },
};

export function applyCrew(bots: BotDef[]): void {
  for (const k of Object.keys(CREW)) delete CREW[k];
  for (const b of bots) CREW[b.id] = { name: b.name, title: b.title, hue: b.look.color, pixels: b.pixels };
}

let loaded: Promise<void> | undefined;
/** Fetch the crew once (and again when `force`). Failures leave the built-in table in place. */
export function loadCrewDefs(force = false): Promise<void> {
  if (!loaded || force) {
    loaded = api<{ bots: BotDef[] }>('GET', '/api/crew').then((r) => applyCrew(r.bots)).catch(() => undefined);
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

/** A bot by role: its pixel look when the server sent one, else a plain pebble in its colour. */
export function Pebble(props: { role: string; size?: number }): JSX.Element {
  const c = () => CREW[props.role] ?? CREW.coder!;
  return (
    <>
      {c().pixels ? (
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
