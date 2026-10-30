import { useSyncExternalStore } from 'react';
import { api } from './api';

export interface Pixels { grid: string[]; colors: Record<string, string> }
/** Pins for a bot's face: one of faceArt's bodies and colours; unset parts come from the bot id. */
export interface FaceLook { body?: string; color?: string }
export interface Look { body: string; eyes: string; mouth: string; top: string; side: string; pattern: string; color: string; accent: string; guard?: boolean; face?: FaceLook }
/** What the terminal's non-character styles draw (the web no longer uses it). */
export interface MarkInfo { shape: string; symbol: string; initials: string }
export interface BotDef {
  id: string; name: string; title: string; kind: string; persona: string; readOnly?: boolean; look: Look;
  builtin?: boolean; edited?: boolean; pixels?: Pixels; mark?: MarkInfo;
  source?: string; whenToUse?: string; modelHint?: string;
  /** Set by the server when an imported persona was cut for the list; send it back unless the persona was edited. */
  personaTruncated?: boolean;
}

export interface CrewEntry { name: string; title: string; hue: string; face?: FaceLook; source?: string; whenToUse?: string }
export interface CrewState { crew: Record<string, CrewEntry> }

const BUILTIN: Record<string, CrewEntry> = {
  orchestrator: { name: 'Tether', title: 'orchestrator', hue: '#9b7bff' },
  planner: { name: 'Scout', title: 'planner', hue: '#5b9dff' },
  architect: { name: 'Brick', title: 'architect', hue: '#38c5d6' },
  coder: { name: 'Bolt', title: 'coder', hue: '#3fb97c' },
  tester: { name: 'Probe', title: 'tester', hue: '#e3ab3a' },
  reviewer: { name: 'Lens', title: 'reviewer', hue: '#e46fa8' },
  approval: { name: 'Gate', title: 'approver', hue: '#9aa6b8' },
};

let state: CrewState = { crew: BUILTIN };
const subscribers = new Set<() => void>();

export const getCrew = (): CrewState => state;
export function subscribeCrew(f: () => void): () => void {
  subscribers.add(f);
  return () => subscribers.delete(f);
}

/** Replace the live crew (the server's list, so your own bots appear everywhere a bot does). */
export function applyCrew(bots: BotDef[]): void {
  const crew: Record<string, CrewEntry> = {};
  for (const b of bots) crew[b.id] = { name: b.name, title: b.title, hue: b.look.color, face: b.look.face, source: b.source, whenToUse: b.whenToUse };
  state = { crew };
  for (const f of subscribers) f();
}

let loaded: Promise<void> | undefined;
/** Fetch the crew once (and again when `force`). Failures leave the current crew in place. */
export function loadCrewDefs(force = false): Promise<void> {
  if (!loaded || force) {
    loaded = api<{ bots: BotDef[] }>('GET', '/api/crew')
      .then((r) => applyCrew(r.bots))
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
