/**
 * The assistant's saved chats: `<home>/assistant/<ws|_>.json`, one per project, written atomically, 200 messages at most.
 * "New chat" moves the chat to `<ws>.archive/` (the last 20 are kept). The file also remembers which outside-world calls the
 * person allowed: "always" for good, "once" for the next turn only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from './types.js';

export const MAX_MESSAGES = 200;
const KEEP_ARCHIVES = 20;

export interface ChatFile {
  messages: ChatMessage[];
  /** Calls allowed for good (their descriptions). */
  always: string[];
  /** Calls allowed for the next turn. */
  once: string[];
}

const dir = (home: string) => join(home, 'assistant');
/** A workspace id is a slug; anything else shares the "no project" chat. */
const slug = (ws: string | undefined) => (ws && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ws) ? ws : '_');
const file = (home: string, ws: string | undefined) => join(dir(home), `${slug(ws)}.json`);

export function loadChat(home: string, ws: string | undefined): ChatFile {
  try {
    const raw = JSON.parse(readFileSync(file(home, ws), 'utf8')) as Partial<ChatFile>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { messages: Array.isArray(raw.messages) ? raw.messages : [], always: list(raw.always), once: list(raw.once) };
  } catch {
    return { messages: [], always: [], once: [] };
  }
}

export function saveChat(home: string, ws: string | undefined, c: ChatFile): void {
  mkdirSync(dir(home), { recursive: true });
  const f = file(home, ws);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...c, messages: c.messages.slice(-MAX_MESSAGES) }), { mode: 0o600 });
  renameSync(tmp, f);
}

/** Archive the current chat and start a fresh one (the allowed-always calls stay). */
export function newChat(home: string, ws: string | undefined): ChatFile {
  const cur = loadChat(home, ws);
  if (cur.messages.length) {
    const arch = join(dir(home), `${slug(ws)}.archive`);
    mkdirSync(arch, { recursive: true });
    writeFileSync(join(arch, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ messages: cur.messages }), { mode: 0o600 });
    const all = readdirSync(arch).filter((n) => n.endsWith('.json')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_ARCHIVES))) rmSync(join(arch, old), { force: true });
  }
  const fresh = { messages: [], always: cur.always, once: [] };
  saveChat(home, ws, fresh);
  return fresh;
}

export const hasChat = (home: string, ws: string | undefined) => existsSync(file(home, ws));
