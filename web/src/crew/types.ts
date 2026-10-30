import type { BotDef } from '../crewStore';

export interface Pack { id: string; name: string; blurb: string; bots: BotDef[] }
export interface Ecc { ref: string; at: string }
export interface Meta { kinds: { kind: string; blurb: string }[]; packs: Pack[]; ecc: Ecc | null; eccDefault: string }
export interface ImportReply { ref: string; added: string[]; updated: string[]; removed: string[]; skipped: string[]; notes: string[]; skills: number; commands: number }
/** The library's tabs; built-ins are the lineup. */
export type Filter = 'all' | 'custom' | 'ecc';
/** `codeMode`: how the agent takes Code Mode's run_code (over MCP, natively), or null when its steps always run direct. */
export interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[]; codeMode?: 'mcp' | 'native' | null }
export interface Row { role: string; name: string; title: string; kind: string; binding: { agent: string; model?: string; toolStyle?: 'code' | 'direct'; codeReads?: boolean } | null }
export type CrewReply = { bots: BotDef[]; packs: Pack[]; kinds: { kind: string; blurb: string }[]; evolve?: Record<string, { version: number; open: number }>; ecc?: Ecc | null; eccDefault?: string };
/** The agent and model a bot runs on (an empty agent means "default (claude)", i.e. no link), and how it calls tools. */
export type Binding = { agent: string; model: string; toolStyle: 'code' | 'direct'; codeReads: boolean };

export const isEcc = (b?: BotDef) => !!b?.source?.startsWith('ecc@');
export const sourceOf = (b?: BotDef): 'builtin' | 'custom' | 'ecc' => (isEcc(b) ? 'ecc' : b?.builtin ? 'builtin' : 'custom');
