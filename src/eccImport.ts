/** Vendor a pinned ECC checkout under <home>/vendor/ecc and keep the crew's ECC bots in sync with it. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadCrew, MAX_IMPORTED_BOTS, removeBot, saveBot, SOURCE_RE, type BotDef } from './crew.js';
import { agentToBot, ECC_REF, ECC_REPO } from './ecc.js';
import { git } from './git.js';

export type Fetch = (dest: string, ref: string) => Promise<void>;

export const gitFetch: Fetch = async (dest, ref) => {
  mkdirSync(dirname(dest), { recursive: true });
  const r = await git(dirname(dest), ['clone', '--depth', '1', '--branch', ref, ECC_REPO, dest]);
  if (r.code !== 0) throw new Error(`could not fetch ECC ${ref}: ${(r.stderr || r.stdout).trim().split('\n').at(-1) ?? 'git clone failed'}`);
};

export const vendorDir = (home: string) => join(home, 'vendor', 'ecc');
const infoFile = (home: string) => join(vendorDir(home), '.aorch-ecc.json');
const KEEP = new Set(['agents', 'skills', 'commands', 'AGENTS.md', 'LICENSE']);
const isEcc = (b: BotDef) => !!b.source?.startsWith('ecc@');

export interface EccDiff {
  ref: string;
  added: string[];
  updated: string[];
  removed: string[];
  skipped: string[];
  notes: string[];
  skills: number;
  commands: number;
}
export interface Prepared {
  dir: string;
  ref: string;
  diff: EccDiff;
  bots: BotDef[];
  /** `dir` is a staging folder to move into place on apply. */
  staged: boolean;
}

const list = (d: string) => (existsSync(d) ? readdirSync(d).sort() : []);

export async function prepareEcc(home: string, o: { ref?: string; from?: string; fetch?: Fetch }): Promise<Prepared> {
  const ref = o.ref ?? ECC_REF;
  if (!SOURCE_RE.test(`ecc@${ref}`)) throw new Error(`"${ref}" is not a valid ECC version tag`);
  let dir = o.from ?? '';
  let staged = false;
  if (!o.from) {
    dir = join(home, 'vendor', `.ecc-${Date.now()}`);
    try {
      await (o.fetch ?? gitFetch)(dir, ref);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    staged = true;
  }
  const crew = loadCrew(home);
  const taken = new Set(crew.filter((b) => !isEcc(b)).map((b) => b.id));
  const prev = new Set(crew.filter(isEcc).map((b) => b.id));
  const bots: BotDef[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  for (const f of list(join(dir, 'agents')).filter((x) => x.endsWith('.md'))) {
    const r = agentToBot(f, readFileSync(join(dir, 'agents', f), 'utf8'), ref, taken);
    if (r.error || !r.bot) skipped.push(r.error ?? f);
    else if (bots.some((b) => b.id === r.bot!.id)) skipped.push(`${f}: duplicate id "${r.bot.id}"`);
    else {
      bots.push(r.bot);
      if (r.note) notes.push(r.note);
    }
  }
  if (bots.length > MAX_IMPORTED_BOTS) {
    notes.push(`only the first ${MAX_IMPORTED_BOTS} agents were kept`);
    bots.length = MAX_IMPORTED_BOTS;
  }
  const ids = new Set(bots.map((b) => b.id));
  const diff: EccDiff = {
    ref,
    added: [...ids].filter((i) => !prev.has(i)),
    updated: [...ids].filter((i) => prev.has(i)),
    removed: [...prev].filter((i) => !ids.has(i)),
    skipped,
    notes,
    skills: list(join(dir, 'skills')).filter((s) => existsSync(join(dir, 'skills', s, 'SKILL.md'))).length,
    commands: list(join(dir, 'commands')).filter((x) => x.endsWith('.md')).length,
  };
  return { dir, ref, diff, bots, staged };
}

export function applyEcc(home: string, p: Prepared): EccDiff {
  const vd = vendorDir(home);
  const next = `${vd}.next`;
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  for (const e of readdirSync(p.dir)) if (KEEP.has(e)) cpSync(join(p.dir, e), join(next, e), { recursive: true });
  writeFileSync(join(next, '.aorch-ecc.json'), JSON.stringify({ ref: p.ref, at: new Date().toISOString() }) + '\n');
  rmSync(vd, { recursive: true, force: true });
  renameSync(next, vd);
  if (p.staged) rmSync(p.dir, { recursive: true, force: true });
  for (const b of p.bots) saveBot(home, b);
  for (const id of p.diff.removed) removeBot(home, id);
  return p.diff;
}

export async function importEcc(home: string, o: { ref?: string; from?: string; fetch?: Fetch }): Promise<EccDiff> {
  return applyEcc(home, await prepareEcc(home, o));
}

export function removeEcc(home: string): string[] {
  const ids = loadCrew(home).filter(isEcc).map((b) => b.id);
  for (const id of ids) removeBot(home, id);
  rmSync(vendorDir(home), { recursive: true, force: true });
  return ids;
}

export function eccInfo(home: string): { ref: string; at: string } | undefined {
  try {
    const j = JSON.parse(readFileSync(infoFile(home), 'utf8')) as { ref?: unknown; at?: unknown };
    return typeof j.ref === 'string' && typeof j.at === 'string' ? { ref: j.ref, at: j.at } : undefined;
  } catch {
    return undefined;
  }
}
