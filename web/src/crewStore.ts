import { useSyncExternalStore } from 'react';
import { api } from './api';

export interface Pixels { grid: string[]; colors: Record<string, string> }
export interface Look { body: string; eyes: string; mouth: string; top: string; side: string; pattern: string; color: string; accent: string; guard?: boolean }
/** What the non-character styles draw: a glyph shape, a 3-letter symbol and two initials, all chosen by the server so the web and the terminal agree. */
export interface MarkInfo { shape: string; symbol: string; initials: string }
export interface BotDef {
  id: string; name: string; title: string; kind: string; persona: string; readOnly?: boolean; look: Look;
  builtin?: boolean; edited?: boolean; pixels?: Pixels; mark?: MarkInfo;
}

export interface CrewEntry { name: string; title: string; hue: string; pixels?: Pixels; mark?: MarkInfo }
export interface CrewState { crew: Record<string, CrewEntry>; style: string; shapes: Record<string, string[]>; glyphs: Record<string, string[]> }

export const MARK_STYLES = ['sigil', 'tile', 'ticker', 'orbit'];

const BUILTIN: Record<string, CrewEntry> = {
  orchestrator: { name: 'Maestro', title: 'orchestrator', hue: '#9b7bff' },
  planner: { name: 'Scout', title: 'planner', hue: '#5b9dff' },
  architect: { name: 'Brick', title: 'architect', hue: '#38c5d6' },
  coder: { name: 'Bolt', title: 'coder', hue: '#3fb97c' },
  tester: { name: 'Probe', title: 'tester', hue: '#e3ab3a' },
  reviewer: { name: 'Lens', title: 'reviewer', hue: '#e46fa8' },
  approval: { name: 'Gate', title: 'approver', hue: '#9aa6b8' },
};

let state: CrewState = { crew: BUILTIN, style: 'pebble', shapes: {}, glyphs: {} };
const subscribers = new Set<() => void>();

export const getCrew = (): CrewState => state;
export function subscribeCrew(f: () => void): () => void {
  subscribers.add(f);
  return () => subscribers.delete(f);
}

/** Replace the live crew (the server's list, so your own bots appear everywhere a bot does). */
export function applyCrew(bots: BotDef[], extra?: { style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }): void {
  const crew: Record<string, CrewEntry> = {};
  for (const b of bots) crew[b.id] = { name: b.name, title: b.title, hue: b.look.color, pixels: b.pixels, mark: b.mark };
  state = { crew, style: extra?.style ?? state.style, shapes: extra?.shapes ?? state.shapes, glyphs: extra?.glyphs ?? state.glyphs };
  for (const f of subscribers) f();
}

let loaded: Promise<void> | undefined;
/** Fetch the crew once (and again when `force`). Failures leave the current crew in place. */
export function loadCrewDefs(force = false): Promise<void> {
  if (!loaded || force) {
    loaded = api<{ bots: BotDef[]; style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }>('GET', '/api/crew')
      .then((r) => applyCrew(r.bots, r))
      .catch(() => undefined);
  }
  return loaded;
}

export const useCrew = (): CrewState => useSyncExternalStore(subscribeCrew, getCrew);

/** Same mapping as the terminal's crewFor: which bot runs a given node. */
export function crewFor(node: { kind: string; role?: string }, crew: Record<string, CrewEntry> = state.crew): string {
  const named = (node.role ?? '').toLowerCase();
  if (named in crew && named !== 'orchestrator') return named;
  if (node.kind === 'gate') return 'tester';
  if (node.kind === 'approval') return 'approval';
  if (named in crew) return named;
  if (/test|qa/.test(named)) return 'tester';
  if (/review|audit/.test(named)) return 'reviewer';
  if (/arch|design/.test(named)) return 'architect';
  if (/plan|research|spec/.test(named)) return 'planner';
  return 'coder';
}
