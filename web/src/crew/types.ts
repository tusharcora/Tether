import type { BotDef } from '../crewStore';

export interface Pack { id: string; name: string; blurb: string; bots: BotDef[] }
export interface Ecc { ref: string; at: string }
export interface Meta { kinds: { kind: string; blurb: string }[]; packs: Pack[]; ecc: Ecc | null; eccDefault: string }
export interface ImportReply { ref: string; added: string[]; updated: string[]; removed: string[]; skipped: string[]; notes: string[]; skills: number; commands: number }
export type Filter = 'all' | 'builtin' | 'custom' | 'ecc';
export interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[] }
export interface Row { role: string; name: string; title: string; kind: string; binding: { agent: string; model?: string } | null }
export type CrewReply = { bots: BotDef[]; packs: Pack[]; kinds: { kind: string; blurb: string }[]; evolve?: Record<string, { version: number; open: number }>; ecc?: Ecc | null; eccDefault?: string };
/** The agent and model a bot runs on; an empty agent means "default (claude)", i.e. no link. */
export type Binding = { agent: string; model: string };

export const isEcc = (b?: BotDef) => !!b?.source?.startsWith('ecc@');
export const sourceOf = (b?: BotDef): Exclude<Filter, 'all'> => (isEcc(b) ? 'ecc' : b?.builtin ? 'builtin' : 'custom');
/** The hue the slider shows before it is moved; not saved until then. */
export const DEFAULT_HUE = 200;
