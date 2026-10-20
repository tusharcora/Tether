/**
 * The crew as data. A bot is a small JSON file: who it is, what it is for, and how it looks. The seven
 * built-in bots can be edited (the edit is saved as an override and can be reset); you can add and remove
 * your own. Files live in <home>/crew/<id>.json. Nothing here imports the renderer, so it stays pure + fs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type BotKind = 'agent' | 'verdict' | 'gate' | 'approval' | 'orchestrator';
export const BOT_KINDS: BotKind[] = ['agent', 'verdict', 'gate', 'approval', 'orchestrator'];
export const KIND_BLURB: Record<BotKind, string> = {
  agent: 'does a job (read-only or writes)',
  verdict: 'reviews and ends with PASS / FAIL',
  gate: 'runs a command; failures loop back',
  approval: 'a person decides',
  orchestrator: 'designs the workflow',
};

export const LOOK_PARTS = {
  body: ['pebble', 'wide', 'tall', 'square', 'blob'],
  eyes: ['dots', 'tall', 'wide', 'visor', 'cyclops', 'sleepy', 'wink', 'glasses'],
  mouth: ['none', 'flat', 'smile', 'open'],
  top: ['none', 'antenna', 'horns', 'crest', 'cap', 'crown', 'sprout'],
  side: ['none', 'arms', 'ears', 'cans', 'wings'],
  pattern: ['none', 'blush', 'band', 'belly', 'badge', 'spots'],
} as const;
export type PartKey = keyof typeof LOOK_PARTS;
export const PART_KEYS = Object.keys(LOOK_PARTS) as PartKey[];

export interface Look {
  body: string;
  eyes: string;
  mouth: string;
  top: string;
  side: string;
  pattern: string;
  /** Body colour, #rrggbb. */
  color: string;
  /** 'auto' derives a light tint of the body colour. */
  accent: string;
  /** Pull the body colour into the crew's soft mid-light range. Default on. */
  guard?: boolean;
}

export interface BotDef {
  id: string;
  name: string;
  title: string;
  kind: BotKind;
  /** What the bot is for. Becomes the step's instructions for custom bots. */
  persona: string;
  /** Agent steps only: may not edit files. */
  readOnly?: boolean;
  look: Look;
  /** Set on load: one of the seven built-ins. */
  builtin?: boolean;
  /** Set on load: a built-in the user has edited. */
  edited?: boolean;
}

const look = (body: string, eyes: string, mouth: string, top: string, side: string, pattern: string, color: string, accent = 'auto'): Look => ({ body, eyes, mouth, top, side, pattern, color, accent, guard: true });

export const BUILTIN_BOTS: BotDef[] = [
  { id: 'orchestrator', name: 'Maestro', title: 'orchestrator', kind: 'orchestrator', persona: 'Turns a plain request into a workflow: picks the crew, the order and the checks.', look: look('pebble', 'dots', 'smile', 'crown', 'none', 'none', '#9b7bff') },
  { id: 'planner', name: 'Scout', title: 'planner', kind: 'agent', readOnly: true, persona: 'Reads the repo and writes the plan. Never edits files.', look: look('pebble', 'tall', 'flat', 'antenna', 'none', 'none', '#5b9dff') },
  { id: 'architect', name: 'Brick', title: 'architect', kind: 'agent', readOnly: true, persona: 'Designs structure and interfaces before anyone writes code.', look: look('square', 'dots', 'flat', 'cap', 'none', 'none', '#38c5d6', '#f2c14e') },
  { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change in the run worktree, small steps, tests alongside.', look: look('wide', 'dots', 'smile', 'none', 'arms', 'none', '#3fb97c') },
  { id: 'tester', name: 'Probe', title: 'tester', kind: 'gate', persona: 'Runs the test command. Failures loop back to the coder.', look: look('pebble', 'wink', 'flat', 'horns', 'none', 'none', '#e3ab3a') },
  { id: 'reviewer', name: 'Lens', title: 'reviewer', kind: 'verdict', readOnly: true, persona: 'Reads the diff critically and ends with VERDICT: PASS or FAIL.', look: look('pebble', 'glasses', 'flat', 'none', 'none', 'none', '#e46fa8', '#ffffff') },
  { id: 'approval', name: 'Gate', title: 'approver', kind: 'approval', persona: 'A person. Pauses the run until someone says yes.', look: look('blob', 'dots', 'flat', 'none', 'none', 'badge', '#9aa6b8', '#6d4aff') },
];
export const BUILTIN_IDS = new Set(BUILTIN_BOTS.map((b) => b.id));
export const BOT_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max) : '';

/** Validate untrusted JSON into a bot, or explain what is wrong. Unknown look parts fall back to the first option. */
export function sanitizeBot(raw: unknown): { bot?: BotDef; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'a bot must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !BOT_ID_RE.test(r.id)) return { error: 'id must be lowercase letters, digits, - or _ (start with a letter, max 24)' };
  const name = text(r.name, 24);
  if (!name) return { error: 'name is required' };
  const kind = BOT_KINDS.includes(r.kind as BotKind) ? (r.kind as BotKind) : undefined;
  if (!kind) return { error: `kind must be one of ${BOT_KINDS.join(', ')}` };
  const lk = (r.look && typeof r.look === 'object' ? r.look : {}) as Record<string, unknown>;
  const out: Look = { ...look('pebble', 'dots', 'flat', 'none', 'none', 'none', '#9aa6b8') };
  for (const k of PART_KEYS) {
    const v = lk[k];
    out[k] = typeof v === 'string' && (LOOK_PARTS[k] as readonly string[]).includes(v) ? v : LOOK_PARTS[k][0]!;
  }
  out.color = typeof lk.color === 'string' && HEX_RE.test(lk.color) ? lk.color.toLowerCase() : '#9aa6b8';
  out.accent = lk.accent === 'auto' || (typeof lk.accent === 'string' && HEX_RE.test(lk.accent)) ? String(lk.accent).toLowerCase() : 'auto';
  out.guard = lk.guard !== false;
  const bot: BotDef = { id: r.id, name, title: text(r.title, 28), kind, persona: text(r.persona, 600), look: out };
  if (kind === 'agent' && r.readOnly === true) bot.readOnly = true;
  if (kind === 'verdict') bot.readOnly = true;
  return { bot };
}

/** A bot as written to disk (no load-time flags). */
export const toFile = (b: BotDef): BotDef => {
  const { builtin: _b, edited: _e, ...rest } = b;
  void _b;
  void _e;
  return rest;
};

const dir = (home: string) => join(home, 'crew');
const file = (home: string, id: string) => join(dir(home), `${id}.json`);

/** Built-ins (with any saved overrides applied), then your own bots in name order. */
export function loadCrew(home: string): BotDef[] {
  const saved = new Map<string, BotDef>();
  try {
    for (const f of readdirSync(dir(home)).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const { bot } = sanitizeBot(JSON.parse(readFileSync(join(dir(home), f), 'utf8')));
        if (bot && f === `${bot.id}.json`) saved.set(bot.id, bot);
      } catch {
        /* unreadable bot file: skip it */
      }
    }
  } catch {
    /* no crew folder yet */
  }
  const out: BotDef[] = BUILTIN_BOTS.map((b) => {
    const o = saved.get(b.id);
    saved.delete(b.id);
    // a built-in keeps its role: only identity and look can be changed, not what kind of step it is
    return o ? { ...o, kind: b.kind, readOnly: b.readOnly, builtin: true, edited: true } : { ...b, builtin: true };
  });
  return [...out, ...[...saved.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60)];
}

export function saveBot(home: string, bot: BotDef): void {
  const { bot: ok, error } = sanitizeBot(toFile(bot));
  if (!ok) throw new Error(error);
  mkdirSync(dir(home), { recursive: true });
  const f = file(home, ok.id);
  writeFileSync(`${f}.tmp`, JSON.stringify(toFile(ok), null, 2) + '\n');
  renameSync(`${f}.tmp`, f);
}

/** Remove one of your own bots, or reset an edited built-in to its original. Built-ins cannot be deleted. */
export function removeBot(home: string, id: string): 'deleted' | 'reset' | 'none' {
  if (!BOT_ID_RE.test(id)) return 'none';
  const f = file(home, id);
  if (!existsSync(f)) return 'none';
  unlinkSync(f);
  return BUILTIN_IDS.has(id) ? 'reset' : 'deleted';
}

/** An unused id for a new bot called `name`. */
export function freshId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot').replace(/^[^a-z]+/, 'bot-').slice(0, 20);
  let id = BOT_ID_RE.test(base) ? base : 'bot';
  for (let i = 2; used.has(id); i++) id = `${base.slice(0, 20)}${i}`;
  return id;
}
