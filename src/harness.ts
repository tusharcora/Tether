/**
 * The per-bot harness: the parts of a bot that Evolve may improve (persona, guidance notes, skills), kept as numbered,
 * immutable versions under <home>/harness/<bot>/vN.json. The highest valid version is the current one. Nothing here can
 * touch permissions, limits, write access, bindings or tools: those are not part of a Harness.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { BOT_ID_RE, type BotDef } from './crew.js';
import { aorchSkills } from './skills.js';

export interface Harness {
  version: number;
  persona: string;
  guidance: string[];
  skills: string[];
  at: string;
  note?: string;
  /** The version this one was made from. */
  base?: number;
  /** The bot definition's persona when this version was made; a difference later means the bot was edited in crew. */
  crewPersona?: string;
}

export interface HarnessEdit {
  field: 'persona' | 'guidance' | 'skills';
  op: 'add' | 'remove' | 'replace';
  before?: string;
  after?: string;
}

export const MAX_GUIDANCE = 12;
export const MAX_ITEM_CHARS = 400;
export const MAX_PERSONA_CHARS = 600;
export const MAX_SKILLS = 20;
export const MAX_SKILL_CHARS = 80;
export const MAX_NOTE_CHARS = 200;
/** Versions kept per bot: v1 (the baseline) and the newest ones; older ones are deleted when a new version is saved. */
export const MAX_VERSIONS = 200;
const MAX_FILE_BYTES = 64 * 1024;

/**
 * Ruling: bots whose harness Evolve must not propose changes for. A manager's plan and review prompts are built in
 * handoff.ts from the step itself and never receive harness guidance or persona, so an accepted edit would do nothing
 * while being recorded as adopted. Task 4 (propose) must refuse these bots.
 */
export const NON_EVOLVABLE: readonly string[] = ['manager'];

export class HarnessError extends Error {}
/** The harness changed since the caller read it. */
export class HarnessConflict extends HarnessError {
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`harness changed: expected current version v${expected} but it is v${actual}`);
  }
}

export function harnessDir(home: string, bot: string): string {
  if (!BOT_ID_RE.test(bot)) throw new HarnessError(`invalid bot id: ${JSON.stringify(bot)}`);
  return join(home, 'harness', bot);
}

const vfile = (home: string, bot: string, n: number) => join(harnessDir(home, bot), `v${n}.json`);

function parse(raw: unknown, n: number): Harness | undefined {
  const o = raw as Partial<Harness> | null;
  if (!o || typeof o !== 'object' || o.version !== n || typeof o.persona !== 'string' || typeof o.at !== 'string') return undefined;
  const strs = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (!strs(o.guidance) || !strs(o.skills)) return undefined;
  return {
    version: n,
    persona: o.persona,
    guidance: [...o.guidance!],
    skills: [...o.skills!],
    at: o.at,
    ...(typeof o.note === 'string' ? { note: o.note } : {}),
    ...(typeof o.base === 'number' ? { base: o.base } : {}),
    ...(typeof o.crewPersona === 'string' ? { crewPersona: o.crewPersona } : {}),
  };
}

function readVersion(home: string, id: string, n: number): Harness | undefined {
  try {
    const f = vfile(home, id, n);
    if (statSync(f).size > MAX_FILE_BYTES) return undefined;
    return parse(JSON.parse(readFileSync(f, 'utf8')), n);
  } catch {
    return undefined;
  }
}

/** One stored version, or undefined. */
export function getVersion(home: string, bot: BotDef | string, n: number): Harness | undefined {
  return readVersion(home, typeof bot === 'string' ? bot : bot.id, n);
}

/** The newest readable version; reads only as many files as it takes to find one. */
function latest(home: string, id: string): Harness | undefined {
  const ns = numbers(home, id);
  for (let i = ns.length - 1; i >= 0; i--) {
    const h = readVersion(home, id, ns[i]!);
    if (h) return h;
  }
  return undefined;
}

/** Version numbers present on disk (valid or not), ascending. */
function numbers(home: string, bot: string): number[] {
  try {
    return readdirSync(harnessDir(home, bot))
      .map((f) => /^v([1-9]\d*)\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** listVersions results by directory: version files are immutable, so an unchanged directory (mtime and names) has the same versions. */
const versionCache = new Map<string, { key: string; list: Harness[] }>();

/** Every readable version, oldest first. Unreadable files are skipped, never overwritten. Cached by the directory's mtime and file names. */
export function listVersions(home: string, bot: BotDef | string): Harness[] {
  const id = typeof bot === 'string' ? bot : bot.id;
  const dir = harnessDir(home, id);
  let key = '';
  try {
    key = `${statSync(dir).mtimeMs}|${readdirSync(dir).filter((f) => /^v[1-9]\d*\.json$/.test(f)).sort().join(',')}`;
  } catch {
    return [];
  }
  const hit = versionCache.get(dir);
  if (hit && hit.key === key) return hit.list.map((h) => ({ ...h, guidance: [...h.guidance], skills: [...h.skills] }));
  const out: Harness[] = [];
  for (const n of numbers(home, id)) {
    const h = readVersion(home, id, n);
    if (h) out.push(h);
  }
  if (versionCache.size > 500) versionCache.clear();
  versionCache.set(dir, { key, list: out.map((h) => ({ ...h, guidance: [...h.guidance], skills: [...h.skills] })) });
  return out;
}

/** Delete the oldest versions beyond MAX_VERSIONS, always keeping v1 and the newest. Best effort. */
function prune(home: string, bot: string): void {
  try {
    const ns = numbers(home, bot);
    if (ns.length <= MAX_VERSIONS) return;
    const middle = ns.filter((n) => n !== 1);
    for (const n of middle.slice(0, ns.length - MAX_VERSIONS)) unlinkSync(vfile(home, bot, n));
  } catch {
    /* best effort */
  }
}

// ---------- the per-bot lock (accept, reject, rollback across processes) ----------

const LOCK_STALE_MS = 60_000;
const lockFile = (home: string, bot: string) => join(harnessDir(home, bot), '.lock');

/**
 * Run `fn` holding `<home>/harness/<bot>/.lock` (created with O_EXCL). A lock older than 60 s is stale and taken over. If another
 * process holds a fresh lock, throws HarnessError "busy" at once: accept, reject and rollback are quick, so the caller just retries.
 */
export function withHarnessLock<T>(home: string, bot: string, fn: () => T): T {
  const f = lockFile(home, bot);
  mkdirSync(harnessDir(home, bot), { recursive: true });
  let fd: number | undefined;
  for (let tries = 0; tries < 2 && fd === undefined; tries++) {
    try {
      fd = openSync(f, 'wx');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(f).mtimeMs;
      } catch {
        continue; // released meanwhile: try again
      }
      if (age <= LOCK_STALE_MS) throw new HarnessError(`${bot}'s harness is busy (another accept, reject or rollback is running): try again in a moment`);
      try {
        unlinkSync(f);
      } catch {
        /* someone else took it over */
      }
    }
  }
  if (fd === undefined) throw new HarnessError(`${bot}'s harness is busy: try again in a moment`);
  try {
    writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
  } catch {
    /* the lock is the file, not its content */
  }
  closeSync(fd);
  try {
    return fn();
  } finally {
    try {
      unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
}

// ---------- the changelog ----------

export interface ChangelogEntry {
  at: string;
  action: 'adopted' | 'rollback';
  version: number;
  base: number;
  /** adopted: the proposal and the 1-based edits that were applied. */
  proposal?: string;
  picked?: number[];
  /** rollback: the version that was copied. */
  to?: number;
}
const MAX_CHANGELOG = 500;
const changelogFile = (home: string, bot: string) => join(harnessDir(home, bot), 'changelog.jsonl');

/** Append one line to `<home>/harness/<bot>/changelog.jsonl`, keeping the newest MAX_CHANGELOG lines. Best effort: never throws. */
export function appendChangelog(home: string, bot: string, e: ChangelogEntry): void {
  try {
    const f = changelogFile(home, bot);
    appendFileSync(f, JSON.stringify(e) + '\n');
    if (statSync(f).size > 200_000) writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-MAX_CHANGELOG).join('\n') + '\n');
  } catch {
    /* a changelog problem never undoes the change it records */
  }
}

/** The bot's changelog, oldest first (well-formed lines only, newest MAX_CHANGELOG). */
export function readChangelog(home: string, bot: string): ChangelogEntry[] {
  try {
    const out: ChangelogEntry[] = [];
    for (const line of readFileSync(changelogFile(home, bot), 'utf8').split('\n').slice(-MAX_CHANGELOG - 1)) {
      try {
        const o = JSON.parse(line) as ChangelogEntry;
        if (o && typeof o === 'object' && (o.action === 'adopted' || o.action === 'rollback') && typeof o.version === 'number' && typeof o.at === 'string') out.push(o);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function validate(h: Pick<Harness, 'persona' | 'guidance' | 'skills'>): void {
  if (typeof h.persona !== 'string') throw new HarnessError('persona must be text');
  if (!Array.isArray(h.guidance) || !h.guidance.every((g) => typeof g === 'string')) throw new HarnessError('guidance must be a list of text');
  if (h.guidance.length > MAX_GUIDANCE) throw new HarnessError(`guidance is limited to ${MAX_GUIDANCE} items (got ${h.guidance.length})`);
  for (const g of h.guidance) {
    if (!g.trim()) throw new HarnessError('guidance items cannot be empty');
    if (g.length > MAX_ITEM_CHARS) throw new HarnessError(`a guidance item is limited to ${MAX_ITEM_CHARS} characters (got ${g.length})`);
  }
  if (h.persona.length > MAX_PERSONA_CHARS) throw new HarnessError(`persona is limited to ${MAX_PERSONA_CHARS} characters (got ${h.persona.length})`);
  if (!Array.isArray(h.skills) || !h.skills.every((s) => typeof s === 'string' && s.trim())) throw new HarnessError('skills must be a list of names');
  if (h.skills.length > MAX_SKILLS) throw new HarnessError(`skills are limited to ${MAX_SKILLS} (got ${h.skills.length})`);
  if (h.skills.some((s) => s.length > MAX_SKILL_CHARS)) throw new HarnessError(`a skill name is limited to ${MAX_SKILL_CHARS} characters`);
  const note = (h as { note?: unknown }).note;
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE_CHARS)) throw new HarnessError(`note is limited to ${MAX_NOTE_CHARS} characters`);
}

/** Errors that mean "this filesystem has no hard links": fall back to an exclusive create. */
const NO_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK']);

/** Write a new version atomically and never over an existing one: tmp file (pid-unique) then hard link (fails if present), else an exclusive create. Returns false when the version already exists. */
function publish(home: string, bot: string, h: Harness): boolean {
  const dir = harnessDir(home, bot);
  mkdirSync(dir, { recursive: true });
  const final = vfile(home, bot, h.version);
  const data = JSON.stringify(h, null, 2) + '\n';
  const tmp = join(dir, `.v${h.version}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, data);
  try {
    linkSync(tmp, final);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST') return false;
    if (!NO_LINK.has(code)) throw e;
    try {
      writeFileSync(final, data, { flag: 'wx' });
      return true;
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e2;
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
  }
}

/** The aorch skills that have a step run by this bot. */
function skillsFor(home: string, bot: BotDef): string[] {
  return aorchSkills(home)
    .filter((s) => s.steps?.some((st) => st.role === bot.id))
    .map((s) => s.name);
}

/** What v1 would be: the bot's definition and skills, not stored. */
function baseline(home: string, bot: BotDef, version: number): Harness {
  return { version, persona: bot.persona, guidance: [], skills: skillsFor(home, bot), at: new Date().toISOString(), crewPersona: bot.persona };
}

/**
 * The bot's current harness: the newest stored version. The first use snapshots v1 from the bot's definition and skills. Later crew
 * edits of the bot make no version and change nothing here (ruling: a crew-tab description never changes run prompts; a harness persona
 * only comes from an accepted proposal or a rollback). A corrupt newest file is never reused: the next number is above every file on disk.
 */
export function currentHarness(home: string, bot: BotDef): Harness {
  for (let tries = 0; tries < 3; tries++) {
    const cur = latest(home, bot.id);
    if (cur) return cur;
    const next = baseline(home, bot, Math.max(0, ...numbers(home, bot.id)) + 1);
    if (publish(home, bot.id, next)) return next;
  }
  return latest(home, bot.id)!;
}

/** The current harness without writing anything: the newest stored version, else what v1 would be. For views and GET routes. */
export function peekHarness(home: string, bot: BotDef): Harness {
  return latest(home, bot.id) ?? baseline(home, bot, Math.max(0, ...numbers(home, bot.id)) + 1);
}

/** The persona baseline a harness persona is compared with: v1, or the oldest readable version when v1 is unreadable. */
export function baselinePersona(home: string, bot: BotDef | string): string | undefined {
  return (getVersion(home, bot, 1) ?? listVersions(home, bot)[0])?.persona;
}

/**
 * What a step of this bot runs with: the current version, and its persona only when it differs from the baseline. That persona is
 * ADDED to the step's role prompt as a fenced role note (prompt.ts); it never replaces the step's own prompt.
 */
export function harnessForRun(home: string, bot: BotDef, pin?: number): { harness: Harness; persona?: string } {
  const cur = currentHarness(home, bot);
  const h = (pin !== undefined && getVersion(home, bot, pin)) || cur;
  const base = baselinePersona(home, bot);
  return { harness: h, ...(base !== undefined && h.persona !== base && h.persona.trim() ? { persona: h.persona } : {}) };
}

/** Save a new version on top of `expectBase`. Throws HarnessConflict when the current version is not `expectBase`. */
export function saveVersion(home: string, bot: BotDef, h: Omit<Harness, 'version' | 'at'>, expectBase: number): Harness {
  validate(h);
  const cur = currentHarness(home, bot);
  if (cur.version !== expectBase) throw new HarnessConflict(expectBase, cur.version);
  const next: Harness = {
    version: Math.max(cur.version, ...numbers(home, bot.id)) + 1,
    persona: h.persona,
    guidance: [...h.guidance],
    skills: [...h.skills],
    at: new Date().toISOString(),
    ...(h.note !== undefined ? { note: h.note } : {}),
    base: expectBase,
    crewPersona: bot.persona,
  };
  if (!publish(home, bot.id, next)) throw new HarnessConflict(expectBase, latest(home, bot.id)?.version ?? next.version);
  prune(home, bot.id);
  return next;
}

/** Make an older version current again by saving a NEW version that copies it. History is never rewritten. */
export function rollback(home: string, bot: BotDef, version: number): Harness {
  return withHarnessLock(home, bot.id, () => rollbackLocked(home, bot, version));
}
function rollbackLocked(home: string, bot: BotDef, version: number): Harness {
  const cur = currentHarness(home, bot);
  const target = getVersion(home, bot, version);
  if (!target) throw new HarnessError(`${bot.id} has no version v${version}`);
  if (version === cur.version) throw new HarnessError(`v${version} is already the current version of ${bot.id}`);
  return saveVersion(home, bot, { persona: target.persona, guidance: target.guidance, skills: target.skills, note: `rollback to v${version}` }, cur.version);
}

/** What changed from `a` to `b`: persona as one replace; guidance and skills as adds and removes. */
export function diffHarness(a: Harness, b: Harness): HarnessEdit[] {
  const out: HarnessEdit[] = [];
  if (a.persona !== b.persona) out.push({ field: 'persona', op: 'replace', before: a.persona, after: b.persona });
  for (const field of ['guidance', 'skills'] as const) {
    const left = [...a[field]];
    const added: string[] = [];
    for (const x of b[field]) {
      const i = left.indexOf(x);
      if (i >= 0) left.splice(i, 1);
      else added.push(x);
    }
    for (const x of left) out.push({ field, op: 'remove', before: x });
    for (const x of added) out.push({ field, op: 'add', after: x });
  }
  return out;
}
