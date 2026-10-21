/**
 * Chat sessions. The main chat and every run each have their own conversation, saved to
 * `<home>/chats/<id>.json`, so closing aorch and coming back (or a run failing while you are away)
 * loses nothing: the transcript, what Maestro proposed, and what you answered are all still there.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pipeline } from './types.js';

export interface Turn {
  who: 'you' | 'maestro';
  text: string;
}

export type Proposal =
  | { kind: 'save'; pipeline: Pipeline; overwrite: boolean; before?: string[] }
  | { kind: 'optimize'; pipeline: Pipeline; overwrite: true; before: string[] }
  | { kind: 'run'; workflow: string; task: string };

/** What Maestro can do about a run, validated before it is ever shown. Never a shell command. */
export type RunAction =
  | { type: 'retry' }
  | { type: 'resume' }
  | { type: 'escalate'; node: string; agent: string; model?: string }
  | { type: 'guide'; node: string; guidance: string }
  | { type: 'stop' }
  | { type: 'open' }
  | { type: 'manual'; steps: string };

export interface Choice {
  label: string;
  detail?: string;
  action: RunAction;
}

export type Entry =
  | { k: 'you'; text: string }
  | { k: 'maestro'; text: string }
  | { k: 'note'; text: string }
  | { k: 'offer'; r: { text: string; warnings: string[]; proposal?: Proposal }; st: 'pending' | 'done' | 'skipped' | 'failed'; note?: string }
  | { k: 'run'; runId: string; workflow: string }
  | { k: 'choice'; title: string; options: Choice[]; recommended: number; sel: number; st: 'pending' | 'done' | 'skipped' | 'failed'; note?: string };

export interface Session {
  id: string;
  title: string;
  /** The run this conversation is about. The main chat has none. */
  runId?: string;
  workflow?: string;
  log: Entry[];
  history: Turn[];
  /** Failures Maestro has already explained, so he does not repeat himself. */
  diagnosed: string[];
  /** Progress already reported to this conversation, so each step is announced once. */
  reported?: string[];
  createdAt: number;
  updatedAt: number;
}

export const MAIN = 'main';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const dir = (home: string) => join(home, 'chats');
const file = (home: string, id: string) => join(dir(home), `${id}.json`);

export const sessionIdForRun = (runId: string) => `run-${runId}`;

export function blankSession(id: string, title: string, extra: Partial<Session> = {}): Session {
  const now = Date.now();
  return { id, title, log: [], history: [], diagnosed: [], createdAt: now, updatedAt: now, ...extra };
}

export function loadSession(home: string, id: string): Session | undefined {
  if (!ID_RE.test(id) || !existsSync(file(home, id))) return undefined;
  try {
    const j = JSON.parse(readFileSync(file(home, id), 'utf8')) as Partial<Session>;
    if (!j || typeof j !== 'object' || !Array.isArray(j.log)) return undefined;
    return { ...blankSession(id, String(j.title ?? id)), ...j, id, log: j.log, history: Array.isArray(j.history) ? j.history : [], diagnosed: Array.isArray(j.diagnosed) ? j.diagnosed : [] } as Session;
  } catch {
    return undefined;
  }
}

export function saveSession(home: string, s: Session): void {
  if (!ID_RE.test(s.id)) throw new Error('bad session id');
  mkdirSync(dir(home), { recursive: true });
  s.updatedAt = Date.now();
  // keep files small: the newest 400 entries and 40 turns are plenty to resume from
  const slim: Session = { ...s, log: s.log.slice(-400), history: s.history.slice(-40) };
  const tmp = `${file(home, s.id)}.tmp`;
  writeFileSync(tmp, JSON.stringify(slim) + '\n');
  renameSync(tmp, file(home, s.id));
}

export function listSessions(home: string): Session[] {
  if (!existsSync(dir(home))) return [];
  const out: Session[] = [];
  for (const f of readdirSync(dir(home))) {
    if (!f.endsWith('.json')) continue;
    const s = loadSession(home, f.slice(0, -5));
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

const lastFile = (home: string) => join(dir(home), '_last');
export function rememberLast(home: string, id: string): void {
  try {
    mkdirSync(dir(home), { recursive: true });
    writeFileSync(lastFile(home), id);
  } catch {
    /* best effort */
  }
}
export function lastSessionId(home: string): string | undefined {
  try {
    const id = readFileSync(lastFile(home), 'utf8').trim();
    return ID_RE.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** A pipeline-shaped value is fine in a saved offer; this only guards the types the TUI relies on. */
export const isPipeline = (p: unknown): p is Pipeline => !!p && typeof p === 'object' && Array.isArray((p as Pipeline).nodes);
