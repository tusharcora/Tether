/**
 * What the Evolve surfaces (CLI, API, terminal UI, dashboard) share: turning a person's pick into edit indices, accepting and rejecting
 * proposals with typed refusals, rolling back, and plain data views of harnesses, lessons and proposals.
 *
 * Picks are 1-BASED everywhere a person or a client gives them ("1,3", [1, 3], or "kept"), as the printouts number edits; `acceptProposal`
 * takes 0-based indices, so every surface goes through `pickFrom`. Views number edits from 1 as well.
 *
 * Views are data: lesson, harness and proposal text is bounded and stripped of control characters, evidence is ids only (run, step, signal),
 * and nothing in a view names a file path. Clients must render text as text (never as HTML).
 */
import { acceptProposal, compose, getProposal, listProposals, parsePick, rejectProposal, type Proposal } from './evolve.js';
import { BOT_ID_RE, loadCrew, type BotDef } from './crew.js';
import { appendChangelog, baselinePersona, HarnessConflict, HarnessError, listVersions, NON_EVOLVABLE, peekHarness, rollback, type Harness, type HarnessEdit } from './harness.js';
import { boundText, loadLessons, type Lesson } from './lessons.js';
import { neutralizeLinks, type Vault } from './vault.js';

export type EvolveOpCode = 'invalid' | 'not_found' | 'conflict';
/** A refusal with a kind: invalid input (HTTP 400), something that does not exist (404), or a state that does not allow it (409). */
export class EvolveOpError extends Error {
  constructor(readonly code: EvolveOpCode, message: string) {
    super(message);
  }
}

const PROPOSAL_ID_RE = /^([a-z][a-z0-9_-]{0,23})-([0-9a-f]{16})$/;
const TEXT_MAX = 600;
const plain = (t: unknown, max = TEXT_MAX) => boundText(String(t ?? ''), max).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ');

/** The bot id a proposal id names (the bot may have been deleted since: showing and rejecting still work). A malformed id is invalid. */
export function botIdOfProposal(id: unknown): string {
  const m = typeof id === 'string' && id.length <= 64 ? PROPOSAL_ID_RE.exec(id) : null;
  if (!m || !BOT_ID_RE.test(m[1]!)) throw new EvolveOpError('invalid', `invalid proposal id: ${JSON.stringify(plain(id, 40))}`);
  return m[1]!;
}

/** Bots whose steps run with a harness: agent and verdict kinds, except the non-evolvable manager. Others show no version. */
export const usesHarness = (b: Pick<BotDef, 'id' | 'kind'>) => (b.kind === 'agent' || b.kind === 'verdict') && !NON_EVOLVABLE.includes(b.id);

/** Error text for a response: the home directory becomes <home>, so no absolute path of this machine leaves it. */
export function scrubPaths(msg: string, home: string): string {
  let out = String(msg ?? '');
  for (const h of [home, home.replace(/\/+$/, '')].filter((x) => x.length > 1)) out = out.split(h).join('<home>');
  return out.replace(/<home>\/+/g, '<home>/');
}

/** A crew bot by id: a malformed id is invalid, an unknown one not found. */
export function findBot(home: string, id: unknown): BotDef {
  if (typeof id !== 'string' || !BOT_ID_RE.test(id)) throw new EvolveOpError('invalid', `invalid bot id: ${JSON.stringify(plain(id, 40))}`);
  const bot = loadCrew(home).find((b) => b.id === id);
  if (!bot) throw new EvolveOpError('not_found', `no such bot: ${id}`);
  return bot;
}

/** A stored proposal, with typed refusals. */
export function loadProposal(home: string, id: unknown): Proposal {
  botIdOfProposal(id);
  try {
    return getProposal(home, id as string);
  } catch (e) {
    const msg = (e as Error).message;
    if (/^no such proposal/.test(msg)) throw new EvolveOpError('not_found', msg);
    throw new EvolveOpError('conflict', msg);
  }
}

/** open, accepted, rejected, or superseded (closed by aorch because the harness moved on; stored as rejected with a "superseded" note). */
export type ProposalLabel = 'open' | 'accepted' | 'rejected' | 'superseded';
export function labelOf(p: Proposal): ProposalLabel {
  if (p.status === 'rejected' && typeof p.note === 'string' && p.note.startsWith('superseded')) return 'superseded';
  return p.status;
}

/** What the saved probe of a proposal kept, dropped and could not probe (0-based), recomputed from its stored results; undefined without results. */
export function keptOf(p: Proposal): NonNullable<Proposal['composed']> | undefined {
  if (!p.probe?.results.length) return undefined;
  return compose(p, p.probe.results).composed;
}

/**
 * A person's pick as 0-based indices, or undefined for "all edits". Accepts a 1-based list as text ("1,3"), a 1-based array of whole
 * numbers ([1, 3]), or "kept" (what the saved probe kept, which includes edits it could not probe). Anything else is invalid.
 */
export function pickFrom(p: Pick<Proposal, 'edits'> & Partial<Proposal>, input: unknown): number[] | undefined {
  if (input === undefined) return undefined;
  const n = p.edits.length;
  try {
    if (input === 'kept') {
      const c = keptOf(p as Proposal);
      if (!c) throw new EvolveOpError('invalid', 'this proposal has no probe results: pick edits by number (like 1,3), or probe it first');
      if (!c.kept.length) throw new EvolveOpError('invalid', 'the probe kept none of the edits: pick edits by number if you want them anyway');
      return [...c.kept];
    }
    if (typeof input === 'string') return parsePick(input, n);
    if (Array.isArray(input)) {
      if (!input.length || input.length > 20 || !input.every((x) => typeof x === 'number' && Number.isInteger(x))) throw new EvolveOpError('invalid', '"pick" must be a non-empty list of edit numbers, starting at 1');
      return parsePick(input.join(','), n);
    }
  } catch (e) {
    if (e instanceof EvolveOpError) throw e;
    throw new EvolveOpError('invalid', (e as Error).message);
  }
  throw new EvolveOpError('invalid', '"pick" must be a list of edit numbers starting at 1 (like [1, 3]), or "kept"');
}

function mustBeOpen(p: Proposal): void {
  if (p.status === 'open') return;
  const l = labelOf(p);
  throw new EvolveOpError('conflict', l === 'superseded' ? `proposal ${p.id} was superseded (${plain(p.note, 80)}): run aorch evolve ${p.bot} again` : `proposal ${p.id} was already ${l}`);
}

const editLine = (e: HarnessEdit) => `${e.field} ${e.op}${e.before !== undefined ? `: "${neutralizeLinks(plain(e.before))}"` : ''}${e.after !== undefined ? `${e.before !== undefined ? ' ->' : ':'} "${neutralizeLinks(plain(e.after))}"` : ''}`;

/** The vault note that records an adopted version: what changed, from which proposal and lessons. Text is data, links neutralised. */
export function adoptedNote(p: Proposal, h: Harness, picked: number[]): string {
  const es = picked.map((i) => p.edits[i]!).filter(Boolean);
  const lessons = [...new Set(es.flatMap((e) => e.lessons))];
  return [
    '---',
    'type: harness-adopted',
    `bot: ${p.bot}`,
    `version: ${h.version}`,
    `base: ${p.base}`,
    `proposal: ${p.id}`,
    'tags: [aorch/harness]',
    '---',
    `# ${p.bot} harness v${h.version} adopted`,
    '',
    `Accepted from proposal ${p.id} (edit${picked.length === 1 ? '' : 's'} ${picked.map((i) => i + 1).join(', ')} of ${p.edits.length}) on ${h.at}. Roll back with: aorch harness ${p.bot} rollback ${p.base}`,
    '',
    '## Changes',
    ...es.map((e) => `- ${editLine(e)}`),
    '',
    '## Lessons cited',
    ...lessons.map((id) => `- ${plain(id, 64)}`),
    '',
  ].join('\n');
}

/**
 * Accept a proposal (all edits, or the person's 1-based pick) as the bot's next harness version, then note it in the vault under
 * `lessons/<bot>/harness-v<N>.md` (best effort: a vault problem never fails the accept). The version itself is written before the first
 * await, so it exists as soon as this is called. Refusals: invalid (bad id, bad pick, non-evolvable bot), not_found, conflict (stale base,
 * already decided, superseded).
 */
export async function adopt(home: string, id: unknown, pick?: unknown, vault?: Pick<Vault, 'writeNote'>): Promise<{ harness: Harness; proposal: Proposal; vaultNote?: string }> {
  const botId = botIdOfProposal(id);
  if (NON_EVOLVABLE.includes(botId)) throw new EvolveOpError('invalid', `${botId} cannot be evolved`);
  findBot(home, botId);
  const p = loadProposal(home, id);
  mustBeOpen(p);
  // never pick for the person: after a probe that dropped edits, "all" has to be said explicitly (a list, or "kept")
  const c = keptOf(p);
  if ((pick === undefined || pick === null) && c?.dropped.length) {
    throw new EvolveOpError('invalid', `the probe dropped edit${c.dropped.length > 1 ? 's' : ''} ${c.dropped.map((i) => i + 1).join(',')} of ${p.id}: choose the edits to accept (pick "kept" for ${c.kept.map((i) => i + 1).join(',') || 'none'}, or list the edits, e.g. ${p.edits.map((_, i) => i + 1).join(',')} for all of them)`);
  }
  const idx = pickFrom(p, pick);
  let harness: Harness;
  try {
    harness = acceptProposal(home, p.id, idx);
  } catch (e) {
    if (e instanceof HarnessConflict) throw new EvolveOpError('conflict', `${e.message}; this proposal was written for v${p.base}: run aorch evolve ${p.bot} again`);
    throw new EvolveOpError('conflict', (e as Error).message);
  }
  const picked = idx ?? p.edits.map((_, i) => i);
  appendChangelog(home, p.bot, { at: harness.at, action: 'adopted', version: harness.version, base: p.base, proposal: p.id, picked: picked.map((i) => i + 1) });
  let proposal: Proposal;
  try {
    proposal = getProposal(home, p.id);
  } catch {
    proposal = { ...p, status: 'accepted', picked, version: harness.version };
  }
  let vaultNote: string | undefined;
  if (vault) {
    const rel = `lessons/${p.bot}/harness-v${harness.version}.md`;
    try {
      if (await vault.writeNote(rel, adoptedNote(p, harness, picked))) vaultNote = rel;
    } catch {
      /* the vault note is a record, not part of the accept */
    }
  }
  return { harness, proposal, ...(vaultNote ? { vaultNote } : {}) };
}

/** Reject a proposal (its edits are remembered and never proposed again). Same refusals as `adopt`. */
export function decline(home: string, id: unknown): Proposal {
  botIdOfProposal(id);
  const p = loadProposal(home, id);
  mustBeOpen(p);
  try {
    rejectProposal(home, p.id);
  } catch (e) {
    throw new EvolveOpError('conflict', (e as Error).message);
  }
  try {
    return getProposal(home, p.id);
  } catch {
    return { ...p, status: 'rejected' };
  }
}

/** Parse a version as typed by a person: "3" or "v3". */
export function versionArg(s: string): number | undefined {
  const m = /^v?([1-9]\d{0,5})$/.exec(s.trim());
  return m ? Number(m[1]) : undefined;
}

/** Roll a bot back to an older version (as a new version). The version must be a whole number above 0 that exists and is not current. */
export function revert(home: string, botId: unknown, version: unknown): Harness {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new EvolveOpError('invalid', '"version" must be a whole number from 1');
  const bot = findBot(home, botId);
  try {
    const h = rollback(home, bot, version);
    appendChangelog(home, bot.id, { at: h.at, action: 'rollback', version: h.version, base: h.base ?? h.version - 1, to: version });
    return h;
  } catch (e) {
    if (e instanceof HarnessConflict) throw new EvolveOpError('conflict', e.message);
    if (e instanceof HarnessError) throw new EvolveOpError('invalid', e.message);
    throw e;
  }
}

// ---------- views (plain data) ----------

export interface LessonView {
  id: string;
  bot: string;
  text: string;
  polarity: Lesson['polarity'];
  provenance: Lesson['provenance'];
  status: Lesson['status'];
  runs: number;
  updatedAt: string;
  evidence: { run: string; node: string; signal: string; source: string }[];
}
export function lessonView(l: Lesson): LessonView {
  return {
    id: plain(l.id, 64),
    bot: l.bot,
    text: plain(l.text, 300),
    polarity: l.polarity,
    provenance: l.provenance,
    status: l.status,
    runs: l.runs,
    updatedAt: l.updatedAt,
    evidence: l.evidence.slice(0, 20).map((e) => ({ run: plain(e.run, 80), node: plain(e.node, 80), signal: plain(e.signal, 40), source: e.source })),
  };
}

export interface EditView {
  /** 1-based, as picks are given. */
  n: number;
  field: HarnessEdit['field'];
  op: HarnessEdit['op'];
  before?: string;
  after?: string;
  lessons: { id: string; text?: string; polarity?: Lesson['polarity']; runs?: number; provenance?: Lesson['provenance']; status?: Lesson['status'] }[];
  /** A persona edit: its text is ADDED to the bot's role prompt as a role note; `before` is present only when it replaces an earlier role note. */
  roleNote?: true;
  /** From the saved probe: kept, dropped, or kept without being probed. */
  probe?: 'kept' | 'dropped' | 'unprobed';
  probeNote?: string;
}
export interface ProposalView {
  id: string;
  bot: string;
  base: number;
  status: Proposal['status'];
  label: ProposalLabel;
  note?: string;
  createdAt: string;
  decidedAt?: string;
  /** 1-based. */
  picked?: number[];
  version?: number;
  costUsd?: number;
  /** Open, but written for an older version: it can no longer be accepted. */
  stale: boolean;
  edits: EditView[];
  probe?: { at: string; budgetUsd: number; spentUsd: number; stoppedBy?: string; results: { task: string; run: string; edit?: number; verdict: string; costUsd: number; baseline: string; candidate: string }[] };
  /** 1-based edit numbers from the saved probe. */
  composed?: { kept: number[]; dropped: number[]; unprobed: number[] };
}

const scoreText = (s: { gatesPassed?: boolean; redos: number; costUsd: number; failed?: true; judge?: number }) =>
  `${s.failed ? 'failed' : s.gatesPassed === undefined ? 'no checks' : s.gatesPassed ? 'checks pass' : 'checks fail'}, ${s.redos} redo${s.redos === 1 ? '' : 's'}, $${s.costUsd.toFixed(4)}${s.judge !== undefined ? `, judge ${s.judge.toFixed(2)}` : ''}`;

export function proposalView(home: string, p: Proposal, lessons: Lesson[], current?: number): ProposalView {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  let cur = current;
  if (cur === undefined && p.status === 'open') {
    const bot = loadCrew(home).find((b) => b.id === p.bot);
    cur = bot ? peekHarness(home, bot).version : undefined;
  }
  const base = p.edits.some((e) => e.field === 'persona') ? baselinePersona(home, p.bot) ?? loadCrew(home).find((b) => b.id === p.bot)?.persona : undefined;
  const c = keptOf(p);
  const one = (xs: number[]) => xs.map((i) => i + 1);
  return {
    id: p.id,
    bot: p.bot,
    base: p.base,
    status: p.status,
    label: labelOf(p),
    ...(p.note ? { note: plain(p.note, 200) } : {}),
    createdAt: p.createdAt,
    ...(p.decidedAt ? { decidedAt: p.decidedAt } : {}),
    ...(p.picked ? { picked: one(p.picked) } : {}),
    ...(p.version !== undefined ? { version: p.version } : {}),
    ...(p.costUsd !== undefined ? { costUsd: p.costUsd } : {}),
    stale: p.status === 'open' && cur !== undefined && cur !== p.base,
    edits: p.edits.map((e, i) => {
      const tag = c ? (c.dropped.includes(i) ? 'dropped' : c.unprobed.includes(i) ? 'unprobed' : c.kept.includes(i) ? 'kept' : undefined) : undefined;
      const why = c?.notes.find((x) => x.edit === i)?.reason;
      return {
        n: i + 1,
        field: e.field,
        op: e.op,
        ...(e.field === 'persona' ? { roleNote: true as const } : {}),
        ...(e.before !== undefined && !(e.field === 'persona' && e.before === base) ? { before: plain(e.before) } : {}),
        ...(e.after !== undefined ? { after: plain(e.after) } : {}),
        lessons: e.lessons.map((id) => {
          const l = byId.get(id);
          return { id: plain(id, 64), ...(l ? { text: plain(l.text, 300), polarity: l.polarity, runs: l.runs, provenance: l.provenance, status: l.status } : {}) };
        }),
        ...(tag ? { probe: tag } : {}),
        ...(why ? { probeNote: plain(why, 200) } : {}),
      };
    }),
    ...(p.probe
      ? {
          probe: {
            at: p.probe.at,
            budgetUsd: p.probe.budgetUsd,
            spentUsd: p.probe.spentUsd,
            ...(p.probe.stoppedBy ? { stoppedBy: p.probe.stoppedBy } : {}),
            results: p.probe.results.slice(0, 40).map((r) => ({ task: plain(r.task, 120), run: plain(r.run, 80), ...(r.edit !== undefined ? { edit: r.edit + 1 } : {}), verdict: r.verdict, costUsd: r.costUsd, baseline: scoreText(r.baseline), candidate: scoreText(r.candidate) })),
          },
        }
      : {}),
    ...(c ? { composed: { kept: one(c.kept), dropped: one(c.dropped), unprobed: one(c.unprobed) } } : {}),
  };
}

export interface HarnessView {
  bot: string;
  evolvable: boolean;
  current: Harness;
  /** Newest last, at most 50. */
  versions: { version: number; at: string; note?: string; base?: number }[];
  total: number;
}
export function harnessView(home: string, botId: unknown): HarnessView {
  const bot = findBot(home, botId);
  // a read: never snapshots v1 (a bot that never ran shows what v1 would be, with no versions stored)
  const cur = peekHarness(home, bot);
  const all = listVersions(home, bot);
  const clean = (h: Harness): Harness => ({ version: h.version, persona: plain(h.persona), guidance: h.guidance.map((g) => plain(g)), skills: h.skills.map((s) => plain(s, 80)), at: h.at, ...(h.note ? { note: plain(h.note, 200) } : {}), ...(h.base !== undefined ? { base: h.base } : {}) });
  return {
    bot: bot.id,
    evolvable: !NON_EVOLVABLE.includes(bot.id),
    current: clean(cur),
    versions: all.slice(-50).map((h) => ({ version: h.version, at: h.at, ...(h.note ? { note: plain(h.note, 200) } : {}), ...(h.base !== undefined ? { base: h.base } : {}) })),
    total: all.length,
  };
}

/** A bot's proposals for a screen: open ones first (newest first), then the most recently decided `decided` ones. */
export function proposalsFor(home: string, botId: string, decided = 10): Proposal[] {
  const all = listProposals(home, botId).reverse();
  return [...all.filter((p) => p.status === 'open'), ...all.filter((p) => p.status !== 'open').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')).slice(0, decided)];
}

/** Per bot: its newest stored harness version (1 when none is stored yet) and how many proposals are open. Reads only; never snapshots a harness. */
export function evolveSummary(home: string, ids: string[]): Record<string, { version: number; open: number }> {
  const out: Record<string, { version: number; open: number }> = {};
  const crew = new Map(loadCrew(home).map((b) => [b.id, b]));
  for (const id of ids) {
    const b = crew.get(id);
    if (!BOT_ID_RE.test(id) || !b || !usesHarness(b)) continue;
    try {
      out[id] = { version: listVersions(home, id).at(-1)?.version ?? 1, open: listProposals(home, id, 'open').length };
    } catch {
      out[id] = { version: 1, open: 0 };
    }
  }
  return out;
}

export interface EvolveData {
  bot: { id: string; name: string };
  version: number;
  evolvable: boolean;
  proposals: ProposalView[];
  confident: number;
  tentative: number;
}
/** Everything the terminal's evolve view shows for one bot. */
export function evolveData(home: string, botId: string): EvolveData {
  const bot = findBot(home, botId);
  const cur = peekHarness(home, bot).version;
  let lessons: Lesson[] = [];
  try {
    lessons = loadLessons(home, bot.id);
  } catch {
    /* shown as no lessons */
  }
  return {
    bot: { id: bot.id, name: plain(bot.name, 40) },
    version: cur,
    evolvable: !NON_EVOLVABLE.includes(bot.id),
    proposals: proposalsFor(home, bot.id, 5).map((p) => proposalView(home, p, lessons, cur)),
    confident: lessons.filter((l) => l.status === 'confident').length,
    tentative: lessons.filter((l) => l.status !== 'confident').length,
  };
}
