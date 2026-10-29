/**
 * The assistant's saved chats, per project: `<home>/assistant/<ws|_>/<chatId>.json` (`{ id, title, created, updated,
 * messages, once }`, 200 messages at most, written atomically, 0600) and `allow.json` there (the outside-world calls the
 * person allowed for good). "once" lives on the chat: it is for that chat's next turn. A chat file is written only once it
 * has a message, and nothing is deleted but by the person. The old layout (one `<ws>.json` per project and its
 * `<ws>.archive/`) becomes chats on the project's first read.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TITLE_MAX, type ChatMessage } from './types.js';

export const MAX_MESSAGES = 200;
export { TITLE_MAX };
const TITLE_AUTO = 60;

export interface Chat {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: ChatMessage[];
  /** Calls allowed for this chat's next turn. */
  once: string[];
}

/** Short and URL-safe; `allow` is the project's allow.json. */
export const isChatId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) && v !== 'allow';
export const newChatId = () => `c${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

/** The first line of the first message, cut at a word to about 60 characters. */
export function titleOf(text: string): string {
  const line = text.trim().split('\n')[0]!.replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_AUTO) return line || 'New chat';
  const cut = line.slice(0, TITLE_AUTO);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > TITLE_AUTO / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

const root = (home: string) => join(home, 'assistant');
/** A workspace id is a slug; anything else shares the "no project" chats. */
const slug = (ws: string | undefined) => (ws && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ws) ? ws : '_');
const folder = (home: string, ws: string | undefined) => join(root(home), slug(ws));
const allowFile = (home: string, ws: string | undefined) => join(folder(home, ws), 'allow.json');
function chatFile(home: string, ws: string | undefined, id: string): string {
  if (!isChatId(id)) throw new Error(`not a chat id: ${String(id).slice(0, 60)}`);
  return join(folder(home, ws), `${id}.json`);
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function write(f: string, data: unknown): void {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, f);
}

function parse(f: string): Chat | undefined {
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) return undefined;
    const messages = raw.messages as ChatMessage[];
    const at = messages[0]?.at ?? 0;
    return { id: raw.id, title: typeof raw.title === 'string' ? raw.title : titleOf(messages.find((m) => m.role === 'you')?.text ?? ''), created: num(raw.created, at), updated: num(raw.updated, messages.at(-1)?.at ?? at), messages, once: strings(raw.once) };
  } catch {
    return undefined;
  }
}

/**
 * The old layout into chats, idempotent: the current chat (`<ws>.json`) and every archive become chats with ids made from
 * their source (an archive's file name, the current chat's first message id), so a second pass after a crash overwrites
 * instead of doubling. "always" joins allow.json. An old file goes only after its chat is written; an unreadable one stays.
 */
function migrate(home: string, ws: string | undefined): void {
  const s = slug(ws);
  const cur = join(root(home), `${s}.json`);
  const arch = join(root(home), `${s}.archive`);
  if (!existsSync(cur) && !existsSync(arch)) return;
  const moved: string[] = [];
  const move = (from: string, id: string, stamp?: number): Record<string, unknown> | undefined => {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(from, 'utf8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const messages = (Array.isArray(raw?.messages) ? raw.messages : []) as ChatMessage[];
    if (messages.length && isChatId(id) && (parse(chatFile(home, ws, id))?.messages.length ?? -1) < messages.length) {
      const at = messages[0]!.at;
      write(chatFile(home, ws, id), {
        id,
        title: titleOf(messages.find((m) => m.role === 'you')?.text ?? ''),
        created: num(at, stamp ?? 0),
        updated: stamp ?? num(messages.at(-1)!.at, 0),
        messages: messages.slice(-MAX_MESSAGES),
        once: strings(raw.once),
      } satisfies Chat);
    }
    moved.push(from);
    return raw;
  };
  let names: string[] = [];
  try {
    names = readdirSync(arch).filter((n) => n.endsWith('.json'));
  } catch {
    /* no archive */
  }
  for (const n of names) {
    const base = n.slice(0, -'.json'.length);
    const stamp = Date.parse(base.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
    move(join(arch, n), `a-${base}`.slice(0, 40), Number.isNaN(stamp) ? undefined : stamp);
  }
  if (existsSync(cur)) {
    let first = '';
    try {
      first = String((JSON.parse(readFileSync(cur, 'utf8')) as { messages?: { id?: unknown }[] }).messages?.[0]?.id ?? '');
    } catch {
      /* unreadable: move() leaves it */
    }
    const raw = move(cur, `h-${first.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 40));
    const always = strings(raw?.always);
    if (always.length) saveAllow(home, ws, [...new Set([...loadAllowRaw(home, ws), ...always])]);
  }
  for (const f of moved) rmSync(f, { force: true });
  try {
    if (!readdirSync(arch).length) rmSync(arch, { recursive: true, force: true });
  } catch {
    /* no archive */
  }
}

export function readChat(home: string, ws: string | undefined, id: string): Chat | undefined {
  const f = chatFile(home, ws, id);
  migrate(home, ws);
  const c = parse(f);
  return c?.id === id ? c : undefined;
}

/** The project's chats, the most recently updated first. */
export function listChats(home: string, ws: string | undefined): Chat[] {
  migrate(home, ws);
  let names: string[] = [];
  try {
    names = readdirSync(folder(home, ws));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json') && isChatId(n.slice(0, -5)))
    .flatMap((n) => {
      const c = parse(join(folder(home, ws), n));
      return c && `${c.id}.json` === n ? [c] : [];
    })
    .sort((a, b) => b.updated - a.updated);
}

export function saveChat(home: string, ws: string | undefined, c: Chat): void {
  write(chatFile(home, ws, c.id), { ...c, messages: c.messages.slice(-MAX_MESSAGES) });
}

export function deleteChat(home: string, ws: string | undefined, id: string): boolean {
  if (!readChat(home, ws, id)) return false;
  rmSync(chatFile(home, ws, id), { force: true });
  return true;
}

function loadAllowRaw(home: string, ws: string | undefined): string[] {
  try {
    return strings((JSON.parse(readFileSync(allowFile(home, ws), 'utf8')) as { always?: unknown }).always);
  } catch {
    return [];
  }
}

/** Calls allowed for good in this project (their descriptions). */
export function loadAllow(home: string, ws: string | undefined): string[] {
  migrate(home, ws);
  return loadAllowRaw(home, ws);
}

export const saveAllow = (home: string, ws: string | undefined, always: string[]) => write(allowFile(home, ws), { always });

/** Every chat of every project (Settings → Connectors reads them as Code Mode's log). */
export function allChats(home: string): Chat[] {
  let names: string[] = [];
  try {
    names = readdirSync(root(home));
  } catch {
    return [];
  }
  return [...new Set(names.map((n) => n.replace(/\.(json|archive)$/, '')))].flatMap((s) => listChats(home, s));
}
