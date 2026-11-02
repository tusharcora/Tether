/**
 * What Tether keeps for Telegram (spec 2026-10-30 §6.1), in <home>/squads/telegram.json (0600, written atomically): the
 * update offset, the bot it polls as, the owner's Telegram user (linked by `/iam`), the one-time codes waiting for `/pair`
 * or `/iam`, and per team the pinned status message, the Telegram ids of the messages it may edit (newest 300) and a mute.
 * Never the token: that is in the secret store.
 */
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { squadsDir } from '../store.js';

export const MAX_EDITABLE = 300;
export const CODE_MS = 10 * 60_000;
/** Six characters a person can read off a screen and type on a phone (no 0/O, 1/I). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface TgTeam {
  /** The pinned live-status message. */
  pin?: number;
  /** Team message id -> Telegram message id, oldest first. */
  msgs: Record<string, number>;
  /** Non-approval posts are skipped until then. */
  mute?: number;
}
export interface TgState {
  offset: number;
  bot?: { id: number; username: string; readsAll: boolean };
  owner?: { id: number; name: string };
  /** `for`: a team id (`/pair`) or 'iam'. */
  codes: { code: string; for: string; exp: number }[];
  teams: Record<string, TgTeam>;
}

const file = (home: string) => join(squadsDir(home), 'telegram.json');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function loadTg(home: string): TgState {
  let j: unknown;
  try {
    j = JSON.parse(readFileSync(file(home), 'utf8'));
  } catch {
    j = undefined;
  }
  if (!isObj(j)) return { offset: 0, codes: [], teams: {} };
  return {
    offset: Number.isSafeInteger(j.offset) ? (j.offset as number) : 0,
    ...(isObj(j.bot) ? { bot: j.bot as TgState['bot'] } : {}),
    ...(isObj(j.owner) && Number.isSafeInteger(j.owner.id) ? { owner: j.owner as TgState['owner'] } : {}),
    codes: Array.isArray(j.codes) ? (j.codes as TgState['codes']).filter((c) => isObj(c) && typeof c.code === 'string') : [],
    teams: isObj(j.teams) ? (j.teams as Record<string, TgTeam>) : {},
  };
}
export function saveTg(home: string, s: TgState): void {
  const f = file(home);
  mkdirSync(join(f, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  renameSync(tmp, f);
}
/** Read-modify-write. Synchronous, so nothing in this process interleaves. */
export function editTg<T>(home: string, fn: (s: TgState) => T): T {
  const s = loadTg(home);
  const r = fn(s);
  saveTg(home, s);
  return r;
}

export const tgTeam = (s: TgState, teamId: string): TgTeam => (s.teams[teamId] ??= { msgs: {} });

/** Remember a sent message, dropping the oldest past the cap. */
export function remember(t: TgTeam, msgId: string, tgId: number): void {
  delete t.msgs[msgId];
  t.msgs[msgId] = tgId;
  const keys = Object.keys(t.msgs);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_EDITABLE))) delete t.msgs[k];
}

/** A new one-time code for `/pair` (a team id) or `/iam`; an older code for the same thing goes. */
export function newCode(s: TgState, what: string, now = Date.now()): { code: string; exp: number } {
  const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  s.codes = [...s.codes.filter((c) => c.for !== what && c.exp > now), { code, for: what, exp: now + CODE_MS }];
  return { code, exp: now + CODE_MS };
}
/** Use a code once: what it was for, or undefined (unknown, expired or used). */
export function takeCode(s: TgState, code: string, now = Date.now()): string | undefined {
  const want = code.trim().toUpperCase();
  const hit = s.codes.find((c) => c.code === want && c.exp > now);
  s.codes = s.codes.filter((c) => c !== hit && c.exp > now);
  return hit?.for;
}
