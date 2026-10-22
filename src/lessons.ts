// Lessons: what a bot should do or avoid, learned from finished runs. Rule-based (no model call), evidence-backed, per bot.
//
// LESSON TEXT IS UNTRUSTED DATA. It can contain a person's feedback note, a reviewer agent's words or a gate's output, all of which a
// repository or a user can shape. This module only cleans and bounds it (control/bidi characters out, <= 240 chars) and neutralises
// wiki links in vault notes. It does NOT make it safe to read as instructions: every prompt that includes lesson text must fence it
// (src/prompt.ts), and `provenance` says how far to trust it: 'metrics' (text written by this module, no outside words), 'feedback'
// (a person's note) and 'check' (reviewer or gate output: lowest trust, limit or drop it).
//
// A lesson is `confident` only if (recomputed every time, never read from disk):
//   - at least `minRuns` DISTINCT runs support it, and
//   - no lesson of the opposite polarity conflicts with it (similar text, or the same shared topic such as "rework": being sent back
//     vs. being liked on the same step are contradictory), and
//   - if its text came from a check (provenance 'check'): it has evidence from a person's feedback or from >= 3 distinct runs.
// Evidence is a function of a run's CURRENT state: reflecting a run replaces that run's earlier evidence, so a flipped rating or an
// edited note moves the evidence and one run never counts twice. Tentative lessons are never proposed (Task 4).
// Lessons are never derived from a reviewer's own verdicts (see signals.ts): they are about the step a check sent back.
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOT_ID_RE } from './crew.js';
import { harnessDir } from './harness.js';
import { cleanNote, signalsOf, type StepSignal } from './signals.js';
import type { RunState, StoredEvent } from './types.js';
import { neutralizeLinks, type Vault } from './vault.js';

export type EvidenceSource = 'feedback' | 'gate' | 'verdict' | 'metrics';
export type Provenance = 'feedback' | 'check' | 'metrics';
export interface Evidence {
  run: string;
  node: string;
  signal: string;
  /** Where the signal came from: a person's feedback, a gate or verdict (reviewer) check, or plain run metrics. */
  source: EvidenceSource;
}
export interface Lesson {
  id: string;
  bot: string;
  /** Untrusted data: fence it in any prompt. */
  text: string;
  polarity: 'do' | 'avoid';
  /** Polarity-neutral subject ('rework', 'handoff', 'note'): a do and an avoid on a shared topic contradict each other. */
  topic: string;
  /** Where the words of `text` came from (see the header). */
  provenance: Provenance;
  evidence: Evidence[];
  /** Distinct runs in `evidence`. */
  runs: number;
  status: 'tentative' | 'confident';
  updatedAt: string;
}
export type NewLesson = Omit<Lesson, 'id' | 'status' | 'updatedAt'>;

export const LESSON_TEXT_MAX = 240;
export const MAX_LESSONS_PER_BOT = 200;
export const MAX_EVIDENCE = 60;
export const DEFAULT_MIN_RUNS = 3;
export const SIMILAR = 0.7;
const REASON_MAX = 120;
const MAX_FILE_BYTES = 2_000_000;
/** "Fast and cheap" for the keep-doing rule: no baseline exists per step, so fixed ceilings. */
export const FAST_MS = 120_000;
export const CHEAP_USD = 0.25;

/** Text from a run or person: control/bidi/zero-width out, whitespace collapsed, capped (no split surrogate). */
export function boundText(raw: unknown, max = LESSON_TEXT_MAX): string {
  return (cleanNote(typeof raw === 'string' ? raw.slice(0, max * 4) : raw) ?? '').replace(/\s+/g, ' ').slice(0, max).replace(/[\ud800-\udbff]$/, '').trim();
}

// ---------- similarity ----------

const tokens = (t: string): Set<string> => new Set(t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
export const hasWords = (t: string) => tokens(t).size > 0;
const normText = (t: string) => [...tokens(t)].join(' ');
const idOf = (bot: string, polarity: string, text: string) => `${bot}-${createHash('sha1').update(`${bot}\0${polarity}\0${normText(text)}`).digest('hex').slice(0, 8)}`;

// ---------- extraction ----------

export interface ExtractContext {
  /** Why a step was sent back (cleaned reviewer or gate text), by node id. Never invented: absent means unknown. */
  reasons?: ReadonlyMap<string, { text: string; source: 'gate' | 'verdict' }>;
  /** The person's note on a thumbs-down, by node id. */
  notes?: ReadonlyMap<string, string>;
}

const BOT_OK = (b: string) => BOT_ID_RE.test(b);
/** Topics on which a do and an avoid contradict each other even when their words differ. */
const SHARED_TOPICS: ReadonlySet<string> = new Set(['rework', 'handoff']);

/**
 * Rule-based lessons from one run's step signals:
 * - 2+ redos: avoid being sent back (with the reason when known);
 * - 2+ refused handoffs: avoid handing off what teammates refuse;
 * - thumbs-down with a note: avoid what the note says (consistent notes across runs merge and become confident);
 * - thumbs-up, no redos, nothing failed or rejected, quick and cheap: keep doing what worked (topic 'rework': it contradicts being sent back).
 */
export function extractLessons(sigs: StepSignal[], ctx: ExtractContext = {}): NewLesson[] {
  const out: NewLesson[] = [];
  for (const g of sigs) {
    if (!BOT_OK(g.bot)) continue;
    const mk = (polarity: 'do' | 'avoid', text: string, topic: string, provenance: Provenance, signal: string, source: EvidenceSource) => {
      const t = boundText(text);
      if (t && hasWords(t)) out.push({ bot: g.bot, text: t, polarity, topic, provenance, evidence: [{ run: g.run, node: g.node, signal, source }], runs: 1 });
    };
    if (g.redos >= 2) {
      const why = ctx.reasons?.get(g.node);
      const reason = why ? boundText(why.text, REASON_MAX) : '';
      if (reason && hasWords(reason)) mk('avoid', `Work gets sent back for rework: ${reason}`, 'rework', 'check', `redos:${g.redos}`, why!.source);
      else mk('avoid', 'Work gets sent back for rework repeatedly', 'rework', 'metrics', `redos:${g.redos}`, 'metrics');
    }
    if (g.handoffRefusals >= 2) mk('avoid', 'Handing work to teammates who refuse it', 'handoff', 'metrics', `refusals:${g.handoffRefusals}`, 'metrics');
    const note = boundText(ctx.notes?.get(g.node), LESSON_TEXT_MAX - 20);
    if (g.feedback === 'down' && note && hasWords(note)) mk('avoid', `Person said: ${note}`, 'note', 'feedback', 'feedback:down', 'feedback');
    if (
      g.feedback === 'up' &&
      g.redos === 0 &&
      g.verdict !== 'fail' &&
      g.gatePassed !== false &&
      g.approved !== false &&
      g.handoffRefusals === 0 &&
      g.durationMs <= FAST_MS &&
      g.costUsd <= CHEAP_USD
    )
      mk('do', 'Work was liked and needed no rework', 'rework', 'metrics', 'feedback:up', 'feedback');
  }
  return out;
}

// ---------- merging ----------

const evKey = (e: Evidence) => `${e.run}\0${e.node}\0${e.signal}`;
const SOURCES: readonly EvidenceSource[] = ['feedback', 'gate', 'verdict', 'metrics'];

/** Two lessons contradict: same bot, opposite polarity, and similar words or a shared topic. */
function conflicts(a: Lesson, b: Lesson): boolean {
  return a !== b && a.bot === b.bot && a.polarity !== b.polarity && ((SHARED_TOPICS.has(a.topic) && a.topic === b.topic) || similarity(a.text, b.text) >= SIMILAR);
}

const confidentOk = (l: Lesson, list: Lesson[], minRuns: number) =>
  l.runs >= minRuns && !list.some((o) => conflicts(l, o)) && (l.provenance !== 'check' || l.runs >= DEFAULT_MIN_RUNS || l.evidence.some((e) => e.source === 'feedback'));

/** Order to drop lessons in when over the cap: tentative before confident, oldest first. */
const evictOrder = (a: Lesson, b: Lesson) => (a.status === 'tentative' ? 0 : 1) - (b.status === 'tentative' ? 0 : 1) || a.updatedAt.localeCompare(b.updatedAt);

/**
 * Recompute everything derived: runs (distinct runs in evidence), status, then the cap (drop oldest tentative first), then status again
 * (an evicted counterpart no longer blocks). Status is never trusted from the input.
 */
export function settle(lessons: Lesson[], minRuns = DEFAULT_MIN_RUNS): Lesson[] {
  let list = lessons.map((l) => ({ ...l, evidence: [...l.evidence] }));
  const refresh = () => {
    for (const l of list) l.runs = new Set(l.evidence.map((e) => e.run)).size;
    for (const l of list) l.status = confidentOk(l, list, minRuns) ? 'confident' : 'tentative';
  };
  refresh();
  if (list.length > MAX_LESSONS_PER_BOT) {
    const drop = new Set([...list].sort(evictOrder).slice(0, list.length - MAX_LESSONS_PER_BOT));
    list = list.filter((l) => !drop.has(l));
    refresh();
  }
  return list;
}

/**
 * Merge new lessons into a bot's list. The best match (highest similarity >= 0.7, same bot and polarity) is the same lesson; its text and id win.
 * Evidence is unioned and `runs` counts distinct runs, so reflecting the same run twice changes nothing. `replaceRun` first removes that
 * run's earlier evidence from every lesson (a flipped rating or edited note moves it); lessons left without evidence disappear.
 */
export function mergeLessons(existing: Lesson[], incoming: NewLesson[], minRuns = DEFAULT_MIN_RUNS, now: Date = new Date(), replaceRun?: string): Lesson[] {
  const at = now.toISOString();
  const orig = new Map(existing.map((l) => [l.id, l.evidence.map(evKey).sort().join('|')]));
  let list: Lesson[] = existing.map((l) => ({ ...l, evidence: [...l.evidence] }));
  if (replaceRun !== undefined) {
    for (const l of list) l.evidence = l.evidence.filter((e) => e.run !== replaceRun);
    list = list.filter((l) => l.evidence.length > 0);
  }
  for (const inc of incoming) {
    const text = boundText(inc.text);
    if (!text || !hasWords(text) || !BOT_OK(inc.bot)) continue;
    let hit: Lesson | undefined;
    let best = 0;
    for (const l of list) {
      if (l.bot !== inc.bot || l.polarity !== inc.polarity) continue;
      const sim = similarity(l.text, text);
      if (sim >= SIMILAR && sim > best) {
        best = sim;
        hit = l;
      }
    }
    if (!hit) {
      hit = { id: idOf(inc.bot, inc.polarity, text), bot: inc.bot, text, polarity: inc.polarity, topic: boundText(inc.topic, 40) || 'note', provenance: inc.provenance, evidence: [], runs: 0, status: 'tentative', updatedAt: at };
      list.push(hit);
    }
    const seen = new Set(hit.evidence.map(evKey));
    for (const e of inc.evidence) {
      if (typeof e.run !== 'string' || !e.run || seen.has(evKey(e))) continue;
      seen.add(evKey(e));
      hit.evidence.push({ run: e.run.slice(0, 80), node: String(e.node).slice(0, 80), signal: String(e.signal).slice(0, 40), source: SOURCES.includes(e.source) ? e.source : 'metrics' });
    }
    if (hit.evidence.length > MAX_EVIDENCE) hit.evidence = hit.evidence.slice(-MAX_EVIDENCE);
  }
  for (const l of list) if (orig.get(l.id) !== l.evidence.map(evKey).sort().join('|')) l.updatedAt = at;
  return settle(list, minRuns);
}

// ---------- storage ----------

const lessonsFile = (home: string, bot: string) => join(harnessDir(home, bot), 'lessons.json');

function clean(raw: unknown, bot: string): Lesson | undefined {
  const o = raw as Partial<Lesson> | null;
  if (!o || typeof o !== 'object' || o.bot !== bot) return undefined;
  if (typeof o.id !== 'string' || !o.id.startsWith(`${bot}-`) || o.id.length > 64 || !/^[\w-]+$/.test(o.id)) return undefined;
  if (typeof o.text !== 'string' || (o.polarity !== 'do' && o.polarity !== 'avoid') || !Array.isArray(o.evidence)) return undefined;
  const text = boundText(o.text);
  if (!text || !hasWords(text)) return undefined;
  const evidence: Evidence[] = o.evidence
    .filter((e) => e && typeof e === 'object' && typeof e.run === 'string' && typeof e.node === 'string' && typeof e.signal === 'string')
    .slice(-MAX_EVIDENCE)
    .map((e) => ({ run: e.run.slice(0, 80), node: e.node.slice(0, 80), signal: e.signal.slice(0, 40), source: SOURCES.includes(e.source) ? e.source : 'metrics' }));
  // status is recomputed by settle(); text of unknown provenance is treated as the least trusted
  return {
    id: o.id,
    bot,
    text,
    polarity: o.polarity,
    topic: boundText(o.topic, 40) || 'note',
    provenance: o.provenance === 'feedback' || o.provenance === 'metrics' ? o.provenance : 'check',
    evidence,
    runs: 0,
    status: 'tentative',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt.slice(0, 40) : new Date(0).toISOString(),
  };
}

/** missing: no file. corrupt: unreadable as lessons (bad JSON/shape/size). error: an I/O error, which says nothing about the content. */
type Read = { kind: 'missing' } | { kind: 'corrupt' } | { kind: 'error'; error: unknown } | { kind: 'ok'; lessons: Lesson[] };
function readLessons(home: string, bot: string, minRuns = DEFAULT_MIN_RUNS): Read {
  const f = lessonsFile(home, bot);
  let text: string;
  try {
    if (statSync(f).size > MAX_FILE_BYTES) return { kind: 'corrupt' };
    text = readFileSync(f, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'error', error };
  }
  try {
    const j = JSON.parse(text) as { lessons?: unknown };
    if (!j || typeof j !== 'object' || !Array.isArray(j.lessons)) return { kind: 'corrupt' };
    const seen = new Set<string>();
    const lessons: Lesson[] = [];
    for (const r of j.lessons) {
      const l = clean(r, bot);
      if (l && !seen.has(l.id)) {
        seen.add(l.id);
        lessons.push(l);
      }
    }
    return { kind: 'ok', lessons: settle(lessons.slice(0, MAX_LESSONS_PER_BOT), minRuns) };
  } catch {
    return { kind: 'corrupt' };
  }
}

/**
 * A bot's lessons, with runs and status recomputed (a stored status is never trusted; a changed `minRuns` applies at once).
 * A missing or corrupt file reads as empty (a corrupt one is kept as lessons.json.bak on the next save). An I/O error or an invalid bot id throws.
 */
export function loadLessons(home: string, bot: string, minRuns = DEFAULT_MIN_RUNS): Lesson[] {
  const r = readLessons(home, bot, minRuns);
  if (r.kind === 'error') throw r.error;
  return r.kind === 'ok' ? r.lessons : [];
}

/**
 * Atomic (tmp + rename, pid-unique). Over the size cap it prunes (older evidence first, then the oldest tentative lessons) instead of failing,
 * and returns what it saved. Refuses when `home` does not exist (never recreates a removed state dir) or when the existing file cannot be
 * read for an I/O reason (it might be fine). A corrupt existing file is copied to lessons.json.bak first.
 */
export function saveLessons(home: string, bot: string, ls: Lesson[]): Lesson[] {
  const dir = harnessDir(home, bot);
  const f = lessonsFile(home, bot);
  if (!existsSync(home)) throw new Error(`no such directory: ${home}`);
  mkdirSync(dir, { recursive: true });
  const cur = readLessons(home, bot);
  if (cur.kind === 'error') throw cur.error;
  if (cur.kind === 'corrupt') {
    try {
      copyFileSync(f, `${f}.bak`);
    } catch {
      /* best effort: the corrupt file is unusable anyway */
    }
  }
  let list = ls.filter((l) => l.bot === bot).slice(-MAX_LESSONS_PER_BOT);
  const size = () => Buffer.byteLength(JSON.stringify({ version: 1, lessons: list }));
  for (let k = MAX_EVIDENCE; size() > MAX_FILE_BYTES && k > 2; ) {
    k = Math.floor(k / 2);
    list = list.map((l) => ({ ...l, evidence: l.evidence.slice(-k) }));
  }
  while (size() > MAX_FILE_BYTES && list.length > 1) {
    const drop = [...list].sort(evictOrder)[0]!;
    list = list.filter((l) => l !== drop);
  }
  if (size() > MAX_FILE_BYTES) throw new Error('lessons file too large');
  const body = JSON.stringify({ version: 1, lessons: list.map((l) => ({ ...l, runs: new Set(l.evidence.map((e) => e.run)).size })) });
  const tmp = `${f}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, f);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
    throw e;
  }
  return list;
}

// ---------- reflecting ----------

const lastLine = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean).pop() ?? '';
const firstLine = (t: string) => t.split('\n').map((x) => x.trim()).find(Boolean) ?? '';

/**
 * The cleaned reason a check sent a step back, from the run itself: the latest FAILED verdict text or gate output line of a check that
 * names the step (fixNode). With events this sees failures that a later pass overwrote in the folded state. Absent when unknown.
 * This is reviewer-agent or command output: untrusted (provenance 'check').
 */
function reasonsOf(s: RunState, events?: StoredEvent[]): Map<string, { text: string; source: 'gate' | 'verdict' }> {
  const checks = new Map(s.pipeline.nodes.filter((c) => c.fixNode && (c.kind === 'gate' || c.verdict)).map((c) => [c.id, c]));
  const out = new Map<string, { text: string; source: 'gate' | 'verdict' }>();
  const put = (c: { fixNode?: string }, raw: string, source: 'gate' | 'verdict') => {
    const text = boundText(raw, REASON_MAX);
    if (text && hasWords(text) && c.fixNode) out.set(c.fixNode, { text, source });
  };
  const verdictText = (t: string) => firstLine(t).replace(/^\W*(verdict\W*)?fail\w*\W*/i, '');
  if (events) {
    for (const { event: e } of events) {
      if (e.type === 'gate.result' && !e.ok) {
        const c = checks.get(e.node);
        if (c) put(c, lastLine(e.output), 'gate');
      } else if (e.type === 'node.finished' && e.verdict === 'FAIL') {
        const c = checks.get(e.node);
        if (c) put(c, verdictText(e.output || e.error || ''), 'verdict');
      }
    }
    return out;
  }
  for (const c of checks.values()) {
    const cs = s.nodes[c.id];
    if (c.kind === 'gate' && cs?.gate && !cs.gate.ok) put(c, lastLine(cs.gate.output), 'gate');
    else if (cs?.verdict === 'FAIL') put(c, verdictText(cs.output ?? cs.error ?? ''), 'verdict');
  }
  return out;
}

/** The lesson text of a vault note: untrusted data, links neutralised, bounded. */
function noteOf(l: Lesson): string {
  const ev = l.evidence.slice(0, 20).map((e) => `- run ${neutralizeLinks(boundText(e.run, 80))} step ${neutralizeLinks(boundText(e.node, 80))}: ${neutralizeLinks(boundText(e.signal, 40))} (${e.source})`);
  return [
    '---',
    'type: lesson',
    `bot: ${l.bot}`,
    `polarity: ${l.polarity}`,
    `provenance: ${l.provenance}`,
    `runs: ${l.runs}`,
    'tags: [aorch/lesson]',
    '---',
    `# Lesson: ${l.bot} should ${l.polarity === 'do' ? 'do' : 'avoid'}`,
    '',
    neutralizeLinks(l.text),
    '',
    `Supported by ${l.runs} distinct runs. Untrusted text: it comes from ${l.provenance === 'metrics' ? 'run metrics' : l.provenance === 'feedback' ? "a person's feedback" : 'reviewer or gate output'}.`,
    '',
    '## Evidence',
    ...ev,
    '',
  ].join('\n');
}

/** What replaces a note when its lesson stops being confident or is dropped: no lesson text, so retrieval cannot hand it out as guidance. */
function retiredNote(id: string): string {
  return ['---', 'type: lesson-retired', 'tags: [aorch/lesson-retired]', '---', `# Retired lesson ${id}`, '', 'This lesson is no longer confident (conflicting or too little evidence) and is not guidance.', ''].join('\n');
}

/**
 * Turn a finished run into lessons. Best effort: it never throws (a failure returns what it could), so it can never fail a run.
 * `events` (when the caller has them) give exact per-attempt signals. The run's earlier evidence is replaced by what the run says now.
 * Returns the lessons this run created or touched, as stored. Vault notes follow the lessons: written for confident ones, replaced by a
 * "retired" stub when a lesson stops being confident or is dropped (the Vault API has no delete). Nothing is created if `home` is gone.
 */
export async function reflect(home: string, s: RunState, vault?: Vault, events?: StoredEvent[], minRuns = DEFAULT_MIN_RUNS): Promise<Lesson[]> {
  const touched: Lesson[] = [];
  const toWrite: Lesson[] = [];
  const toRetire: string[] = [];
  try {
    const sigs = signalsOf(s, events);
    const notes = new Map<string, string>();
    for (const g of sigs) {
      const n = s.nodes[g.node]?.feedback?.note;
      if (n) notes.set(g.node, n);
    }
    const incoming = extractLessons(sigs, { reasons: reasonsOf(s, events), notes });
    const bots = [...new Set(sigs.map((g) => g.bot).filter(BOT_OK))];
    for (const bot of bots) {
      // load -> merge -> save has no await in between, so concurrent reflections in this process cannot interleave
      try {
        const r = readLessons(home, bot, minRuns);
        if (r.kind === 'error') continue; // cannot tell what is there: do not overwrite
        const before = r.kind === 'ok' ? r.lessons : [];
        const mine = incoming.filter((l) => l.bot === bot);
        const merged = mergeLessons(before, mine, minRuns, new Date(), s.id);
        const changed = JSON.stringify(merged) !== JSON.stringify(before);
        const saved = changed || r.kind === 'corrupt' ? saveLessons(home, bot, merged) : merged;
        const wasConfident = new Set(before.filter((l) => l.status === 'confident').map((l) => l.id));
        const touchedIds = new Set(mine.map((m) => idOfMatch(saved, m)));
        for (const l of saved) {
          if (touchedIds.has(l.id)) touched.push(l);
          if (l.status === 'confident' && (touchedIds.has(l.id) || !wasConfident.has(l.id))) toWrite.push(l);
        }
        const nowConfident = new Set(saved.filter((l) => l.status === 'confident').map((l) => l.id));
        for (const id of wasConfident) if (!nowConfident.has(id)) toRetire.push(`lessons/${bot}/${id}.md`);
      } catch {
        continue;
      }
    }
    if (vault) {
      for (const l of toWrite) {
        try {
          await vault.writeNote(`lessons/${l.bot}/${l.id}.md`, noteOf(l));
        } catch {
          /* a vault problem never matters here */
        }
      }
      for (const path of toRetire) {
        try {
          await vault.writeNote(path, retiredNote(path.split('/').pop()!.replace(/\.md$/, '')));
        } catch {
          /* ditto */
        }
      }
    }
  } catch {
    /* reflection is best effort */
  }
  return touched;
}

function idOfMatch(saved: Lesson[], m: NewLesson): string | undefined {
  const t = boundText(m.text);
  let best: Lesson | undefined;
  let score = 0;
  for (const l of saved) {
    if (l.bot !== m.bot || l.polarity !== m.polarity) continue;
    const sim = similarity(l.text, t);
    if (sim >= SIMILAR && sim > score) {
      score = sim;
      best = l;
    }
  }
  return best?.id;
}
