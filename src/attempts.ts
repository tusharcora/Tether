/**
 * Try more ways (spec 2026-10-30 §6.2): the same task on other agents or models at once, as one attempt set. Siblings
 * start from the original's base with the pipeline it started with, every agent step re-pointed (`applyOverrides`), and
 * count toward the original's goal and team like any run. The Compare page reads the set (`view`); Tether ranks it
 * (`rankAttempts`) but never ships on its own; the person's pick ships through RunShip and the rest stop. Unpicked
 * attempts lose their worktree and branch 7 days after the pick (`sweep`); their run records stay.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AdapterRegistry } from './adapters/index.js';
import { loadBindings } from './bindings.js';
import { crewFor } from './bots.js';
import type { Engine } from './engine.js';
import { diffCommitted, removeBranch, removeWorktree } from './git.js';
import { parseCounts } from './goals/loop.js';
import type { RunShip } from './runShip.js';
import { HttpError } from './serverkit.js';
import type { Store } from './store.js';
import { applyOverrides } from './triggers.js';
import type { RunState } from './types.js';

/** Attempts one request may add, and a set's size. */
export const MAX_MORE = 4;
export const MAX_SET = 8;
/** How long unpicked attempts keep their worktree and branch after the pick. */
export const KEEP_MS = 7 * 86_400_000;
const LETTERS = 'ABCDEFGH';

export interface AgentPick {
  agent: string;
  model?: string;
}
const same = (a: AgentPick, b: AgentPick) => a.agent === b.agent && (a.model ?? '') === (b.model ?? '');
export const isFree = (b: AgentPick) => b.agent === 'openrouter' || b.agent === 'nvidia' || !!b.model?.endsWith(':free');

/** The agents and models the owner has: their crew's bindings, then every registered adapter on its own default; free first, none twice. */
export function agentChoices(home: string, registry: AdapterRegistry): AgentPick[] {
  const out: AgentPick[] = [];
  const add = (x: AgentPick) => registry.has(x.agent) && x.agent !== 'mock' && !out.some((y) => same(x, y)) && out.push(x);
  for (const b of Object.values(loadBindings(home))) add({ agent: b.agent, ...(b.model ? { model: b.model } : {}) });
  for (const id of registry.ids()) add({ agent: id });
  return [...out.filter(isFree), ...out.filter((x) => !isFree(x))];
}

/** `count` picks from `pool` that the set has not used; undefined where none is left (that attempt runs on the original's agents). */
export function defaultPicks(pool: AgentPick[], used: AgentPick[], count: number): (AgentPick | undefined)[] {
  const fresh = pool.filter((x) => !used.some((u) => same(u, x)));
  return Array.from({ length: count }, (_, i) => fresh[i]);
}

/** The agent and model a run's first agent step ran on. */
export function agentOf(s: Pick<RunState, 'pipeline'>): AgentPick & { bot: string } {
  const n = s.pipeline.nodes.find((x) => x.kind === 'agent' && !x.spawn);
  return { agent: n?.agent ?? 'claude', ...(n?.model ? { model: n.model } : {}), bot: n ? crewFor(n) : 'coder' };
}

/** One attempt as the Compare page shows it. */
export interface AttemptView {
  id: string;
  label: string;
  status: RunState['status'];
  live: boolean;
  bot: string;
  agent: string;
  model?: string;
  free: boolean;
  /** The run's checks (its gate steps): passed, failing tests where the output says so. None when it has no gate or none ran. */
  check?: { ok: boolean; failing?: number; passing?: number };
  files: number;
  added: number;
  deleted: number;
  costUsd: number;
  durationMs: number;
  /** The last reviewer's first line, and its bot. */
  review?: { bot: string; line: string };
  /** The first changed file and a few of its lines. */
  excerpt?: { file: string; lines: string[] };
  error?: string;
  ship?: RunState['ship'];
  /** The goal's number check after this run, and before it (when the goal has one and it was measured). */
  metric?: { before?: number; after?: number };
}

/**
 * Tether's pick (plan, my call 8): among attempts that finished without failing (done, or waiting on the person) and
 * changed something, the check passes → fewer failing tests → smaller diff → lower cost. Never shipped on its own.
 */
export function rankAttempts(rows: Pick<AttemptView, 'id' | 'status' | 'live' | 'check' | 'added' | 'deleted' | 'costUsd'>[]): string | undefined {
  const check = (r: (typeof rows)[number]) => (r.check?.ok === true ? 0 : r.check ? 2 : 1);
  return rows
    .filter((r) => !r.live && (r.status === 'done' || r.status === 'paused') && r.added + r.deleted > 0)
    .sort((a, b) => check(a) - check(b) || (a.check?.failing ?? 0) - (b.check?.failing ?? 0) || a.added + a.deleted - (b.added + b.deleted) || a.costUsd - b.costUsd)[0]?.id;
}

/** Files, lines added and removed, and the first file's opening changed lines, from a unified diff. */
export function diffSummary(diff: string): { files: number; added: number; deleted: number; excerpt?: { file: string; lines: string[] } } {
  let files = 0;
  let added = 0;
  let deleted = 0;
  let excerpt: { file: string; lines: string[] } | undefined;
  for (const l of diff.split('\n')) {
    const head = /^diff --git a\/.* b\/(.*)$/.exec(l);
    if (head) {
      files++;
      excerpt ??= { file: head[1]!, lines: [] };
    } else if (l.startsWith('+++') || l.startsWith('---')) continue;
    else if (l.startsWith('+') || l.startsWith('-')) {
      if (l[0] === '+') added++;
      else deleted++;
      if (files === 1 && excerpt!.lines.length < 3) excerpt!.lines.push(l.slice(0, 160));
    }
  }
  return { files, added, deleted, ...(excerpt ? { excerpt } : {}) };
}

/** The run's gate steps as one check: all passed, any failed, or none decided yet (undefined). */
export function checkOf(s: Pick<RunState, 'pipeline' | 'nodes'>): AttemptView['check'] {
  const gates = s.pipeline.nodes.filter((n) => n.kind === 'gate');
  const ran = gates.filter((n) => s.nodes[n.id]?.gate);
  if (!ran.length) return undefined;
  const failed = gates.some((n) => s.nodes[n.id]?.status === 'error');
  if (!failed && !gates.every((n) => s.nodes[n.id]?.status === 'done')) return undefined;
  const counts = ran.map((n) => parseCounts(s.nodes[n.id]!.gate!.output));
  const sum = (k: 'failing' | 'passing') => (counts.some((c) => c[k] !== undefined) ? counts.reduce((a, c) => a + (c[k] ?? 0), 0) : undefined);
  const failing = sum('failing');
  const passing = sum('passing');
  return { ok: !failed, ...(failing !== undefined ? { failing } : {}), ...(passing !== undefined ? { passing } : {}) };
}

export interface AttemptsDeps {
  home: string;
  store: Store;
  engine: Engine;
  registry: AdapterRegistry;
  ship: Pick<RunShip, 'decide'>;
  /** Why the original's goal or team may not start `count` more runs now. */
  refusal?: (original: RunState, count: number) => string | undefined;
  /** A sibling started: count it where the original counts (its goal's runs, its team's tasks). */
  adopt?: (original: RunState, sibling: string) => void;
  /** The goal's number check around this run, when there is one. */
  metric?: (s: RunState) => AttemptView['metric'];
}

export class Attempts {
  /** Originals whose siblings are being started (a second click waits its turn: 409). */
  private starting = new Set<string>();

  constructor(private d: AttemptsDeps) {}

  /** A set's runs, A first. */
  members(set: string): RunState[] {
    return this.d.store
      .listRows()
      .map((r) => r.state)
      .filter((s) => s.attemptSet === set)
      .sort((a, b) => (a.attemptLabel ?? '').localeCompare(b.attemptLabel ?? ''));
  }

  /** What the picker pre-fills for `count` more attempts of this run, and everything it can offer. */
  picks(runId: string, count: number): { picks: (AgentPick | undefined)[]; choices: AgentPick[]; original: AgentPick } {
    const s = this.d.store.state(runId);
    if (!s) throw new HttpError(404, `unknown run ${runId}`);
    const members = s.attemptSet ? this.members(s.attemptSet) : [s];
    const choices = agentChoices(this.d.home, this.d.registry);
    const { bot: _, ...original } = agentOf(members[0] ?? s);
    return { picks: defaultPicks(choices, members.map((m) => agentOf(m)), count), choices, original };
  }

  /**
   * Start `count` (1–4) more attempts of `runId`'s task, each on its own agent/model (`agents`, else the default picks).
   * The run becomes A of a new set unless it is in one already. Returns the new run ids.
   */
  async start(runId: string, o: { count: number; agents?: AgentPick[] }): Promise<string[]> {
    const s = this.d.store.state(runId);
    if (!s) throw new HttpError(404, `unknown run ${runId}`);
    if (s.kind === 'team') throw new HttpError(400, 'Try more ways works on workflow runs: a team run plans first. Start the task again instead.');
    if (s.probe) throw new HttpError(400, 'a probe replay cannot be tried again');
    if (!Number.isInteger(o.count) || o.count < 1 || o.count > MAX_MORE) throw new HttpError(400, `"count" must be a whole number from 1 to ${MAX_MORE}`);
    for (const a of o.agents ?? []) if (!this.d.registry.has(a.agent)) throw new HttpError(400, `unknown agent "${a.agent}"`);
    const set = s.attemptSet ?? `a${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const members = s.attemptSet ? this.members(set) : [s];
    const original = members[0]!;
    if (this.starting.has(original.id)) throw new HttpError(409, 'more attempts of this run are starting already');
    if (members.length + o.count > MAX_SET) throw new HttpError(409, `a set holds at most ${MAX_SET} attempts (this one has ${members.length})`);
    const why = this.d.refusal?.(original, o.count);
    if (why) throw new HttpError(409, why);
    const pipeline = this.d.engine.startedWith(original.id);
    const fill = defaultPicks(agentChoices(this.d.home, this.d.registry), [...members.map((m) => agentOf(m)), ...(o.agents ?? [])], o.count);
    const picks = Array.from({ length: o.count }, (_, i) => o.agents?.[i] ?? fill[i - (o.agents?.length ?? 0)]);
    this.starting.add(original.id);
    const ids: string[] = [];
    try {
      if (!s.attemptSet) this.d.store.append(s.id, { type: 'attempt.set', set, label: 'A' });
      for (const [i, pick] of picks.entries()) {
        const id = await this.d.engine.start({
          pipeline: pick ? applyOverrides(pipeline, pick) : pipeline,
          task: original.task,
          repo: original.repo,
          ref: original.baseSha,
          autoApprove: original.autoApprove,
          workspace: original.workspace?.id ?? false,
          ...(original.origin ? { origin: original.origin } : {}),
        });
        this.d.store.append(id, { type: 'attempt.set', set, label: LETTERS[members.length + i]! });
        this.d.adopt?.(original, id);
        ids.push(id);
      }
    } catch (e) {
      if (!ids.length) throw new HttpError(422, (e as Error).message.split('\n')[0]!);
      console.error(`[attempts] ${(e as Error).message}`); // the ones started keep going
    } finally {
      this.starting.delete(original.id);
    }
    return ids;
  }

  /** The Compare page: every attempt with its check, changes, cost, time and review, and Tether's pick. */
  async view(set: string): Promise<{ set: string; task: string; runs: AttemptView[]; pick?: string; picked?: RunState['attemptPicked'] }> {
    const members = this.members(set);
    if (!members.length) throw new HttpError(404, `unknown attempt set ${set}`);
    const runs: AttemptView[] = [];
    for (const s of members) {
      const diff = existsSync(s.workdir) ? await diffCommitted(s.workdir, s.baseSha).catch(() => '') : '';
      const { agent, model, bot } = agentOf(s);
      const reviewer = [...s.pipeline.nodes].reverse().find((n) => n.verdict && s.nodes[n.id]?.output);
      const line = reviewer ? s.nodes[reviewer.id]!.output!.split('\n').map((l) => l.trim()).find((l) => l && !/^VERDICT:/i.test(l)) : undefined;
      const check = checkOf(s);
      const metric = this.d.metric?.(s);
      runs.push({
        id: s.id,
        label: s.attemptLabel ?? '?',
        status: s.status,
        live: this.d.engine.isLive(s.id),
        bot,
        agent,
        ...(model ? { model } : {}),
        free: isFree({ agent, model }),
        ...(check ? { check } : {}),
        ...diffSummary(diff),
        costUsd: s.costUsd,
        durationMs: (s.finishedAt ?? Date.now()) - s.startedAt,
        ...(reviewer && line ? { review: { bot: crewFor(reviewer), line: line.slice(0, 160) } } : {}),
        ...(s.error ? { error: s.error.split('\n')[0]!.slice(0, 200) } : {}),
        ...(s.ship ? { ship: s.ship } : {}),
        ...(metric ? { metric } : {}),
      });
    }
    const picked = members.find((m) => m.attemptPicked)?.attemptPicked;
    const pick = rankAttempts(runs);
    return { set, task: members[0]!.task, runs, ...(pick ? { pick } : {}), ...(picked ? { picked } : {}) };
  }

  /** The person's pick: ship it (the run page's Open PR, or Merge with `merge`), then stop the others still going. */
  async pick(set: string, runId: string, merge = false): Promise<void> {
    const members = this.members(set);
    if (!members.length) throw new HttpError(404, `unknown attempt set ${set}`);
    if (!members.some((m) => m.id === runId)) throw new HttpError(400, `${runId} is not an attempt in this set`);
    if (members.some((m) => m.attemptPicked)) throw new HttpError(409, 'an attempt was already picked from this set');
    await this.d.ship.decide(runId, merge);
    for (const m of members) this.d.store.append(m.id, { type: 'attempt.picked', run: runId });
    for (const m of members) if (m.id !== runId) this.d.engine.stop(m.id);
  }

  /** Remove the worktree and branch of every unpicked attempt picked over more than 7 days ago. Returns how many. */
  async sweep(now = Date.now()): Promise<number> {
    let n = 0;
    for (const { state: s } of this.d.store.listRows()) {
      const p = s.attemptPicked;
      if (!p || p.run === s.id || now - p.at < KEEP_MS || this.d.engine.isLive(s.id) || !existsSync(s.workdir)) continue;
      await removeWorktree(s.repo, s.workdir).catch(() => {});
      await removeBranch(s.repo, s.branch).catch(() => {});
      n++;
    }
    return n;
  }
}
