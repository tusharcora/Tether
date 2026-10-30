/**
 * Auto-fix in the app (spec 2026-10-30 §3.4). When a run fails and no person stopped or rejected it, the server works on it
 * by the supervisor's rules (supervisor.ts `decide`, `culprit`), each round an event:
 *
 *   round 1   one read-only turn (the assistant's agent) diagnoses the failure; its guidance goes to the failed steps, which run again
 *   round 2+  the failing step moves to the stronger link (bots.json "escalate"), then runs again
 *   stop      after the setting's rounds, or when nothing stronger is left: the run stays failed and Needs you says why
 *
 * A read-only team run whose failure needs edits is never flipped silently: the person is asked once (Allow edits and retry?).
 */
import { existsSync } from 'node:fs';
import type { AdapterRegistry } from './adapters/index.js';
import { assistantAgent } from './assistant/turn.js';
import { loadBindings } from './bindings.js';
import type { Engine } from './engine.js';
import { autoFixOn, autoFixRounds } from './prefs.js';
import { fixGuidance } from './runchat.js';
import type { Store } from './store.js';
import { culprit, decide, DEFAULT_ESCALATION } from './supervisor.js';
import { planWaiting, type RunState } from './types.js';

export interface AutoFixDeps {
  home: string;
  store: Store;
  engine: Engine;
  registry: AdapterRegistry;
}

/** Why auto-fix leaves this run alone (undefined: it may work on it). The setting is checked by the caller. */
export function autoFixRefusal(s: RunState): string | undefined {
  if (s.status !== 'error') return `the run is ${s.status}`;
  if (s.probe) return 'a probe replay is never retried';
  if (s.budgetStop && s.capsOn) return 'it stopped at its spending cap, your limit';
  if (!existsSync(s.workdir)) return 'its worktree is gone';
  if (s.pipeline.nodes.some((n) => n.kind === 'approval' && s.nodes[n.id]?.status === 'error')) return 'a person rejected it';
  if (!Object.values(s.nodes).some((n) => n.status === 'error')) return 'it failed outside any step';
  return undefined;
}

const NEEDS_WRITES = 'this run is read-only, and fixing it needs file edits';

export class AutoFix {
  private jobs = new Set<Promise<unknown>>();
  /** Runs a round is being worked out for: from the failure until the retry starts (or auto-fix gives up). */
  private working = new Set<string>();
  /** Runs whose Allow edits and retry? card waits on the person. In memory, so the 2-second polls read no run state. */
  private waiting = new Set<string>();

  constructor(private d: AutoFixDeps) {
    d.store.onAppend((e) => {
      const t = e.event.type;
      if (t === 'autofix.needs_writes') this.waiting.add(e.runId);
      else if (t === 'run.resumed' || t === 'run.writes' || t === 'autofix.gave_up' || t === 'autofix.round') this.waiting.delete(e.runId);
      if (t === 'run.finished' && e.event.status === 'error') this.take(e.runId);
    });
    for (const { state: s } of d.store.listRows()) {
      if (s.status !== 'error' || !s.autofix || s.autofix.gaveUp) continue;
      // after a restart: a card still waits, or a cycle that was between rounds carries on
      if (s.autofix.needsWrites) this.waiting.add(s.id);
      else this.take(s.id);
    }
  }

  /** Resolves when no round is being worked out (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.allSettled([...this.jobs]);
  }

  busy(runId: string): boolean {
    return this.working.has(runId);
  }

  /** Auto-fix is on this failed run (working out a round, or waiting on the person's Allow edits): it is not over yet. */
  pending(runId: string): boolean {
    return this.working.has(runId) || this.waiting.has(runId);
  }

  /** The person's Allow edits: a waiting plan is planned again with writes on; a run auto-fix asked about retries with edits. */
  async allowEdits(runId: string): Promise<void> {
    const { engine, store } = this.d;
    const s = store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    if (planWaiting(s)) return engine.allowEdits(runId, { background: true });
    const asked = s.autofix?.needsWrites;
    await engine.allowEdits(runId);
    if (!asked || !s.autofix) return;
    const guidance = store.eventsNoChunks(runId).flatMap((e) => (e.event.type === 'autofix.needs_writes' ? [e.event.guidance] : [])).at(-1);
    const round = s.autofix.round + 1;
    if (guidance) this.guide(store.state(runId)!, guidance, round);
    store.append(runId, { type: 'autofix.round', round, of: s.autofix.of, action: 'retry', detail: 'retrying with edits allowed' });
    await engine.resume(runId, { retryFailed: true });
  }

  /** The person's Stop while auto-fix is between rounds: it gives up now. */
  cancel(runId: string): boolean {
    const s = this.d.store.state(runId);
    if (!s || s.status !== 'error' || !s.autofix || s.autofix.gaveUp) return false;
    this.giveUp(runId, s.autofix.round, 'stopped by you');
    return true;
  }

  private job(p: Promise<unknown>): void {
    const j: Promise<unknown> = p.catch((e: unknown) => console.error(`[autofix] ${(e as Error).message}`)).finally(() => this.jobs.delete(j));
    this.jobs.add(j);
  }

  private take(runId: string): void {
    if (this.working.has(runId)) return;
    const s = this.d.store.state(runId);
    if (!s || !autoFixOn(this.d.home) || autoFixRefusal(s) || s.autofix?.gaveUp || s.autofix?.needsWrites) return;
    this.working.add(runId);
    this.job(
      this.round(runId)
        .catch((e: unknown) => this.giveUp(runId, this.d.store.state(runId)?.autofix?.round ?? 0, `could not go on: ${(e as Error).message.split('\n')[0]!.slice(0, 160)}`))
        .finally(() => this.working.delete(runId)),
    );
  }

  private async round(runId: string): Promise<void> {
    const { engine, store, home } = this.d;
    await engine.wait(runId); // the engine's own bookkeeping for the failure first
    let s = store.state(runId);
    if (!s || engine.isLive(runId) || autoFixRefusal(s) || s.autofix?.gaveUp || s.autofix?.needsWrites) return;
    const of = s.autofix?.of ?? autoFixRounds(home);
    const round = (s.autofix?.round ?? 0) + 1;
    if (!s.autofix) store.append(runId, { type: 'autofix.started', rounds: of });
    const escalate = loadBindings(home).escalate ?? DEFAULT_ESCALATION;
    const d = decide(s, round, of, escalate);
    // past its rounds, the why is what still fails; otherwise the rule that stopped it (nothing stronger, a hard stop)
    if (d.action === 'stop') return this.giveUp(runId, round - 1, round > of && s.error ? s.error.split('\n')[0]! : d.detail);
    let detail = d.detail;
    if (d.action === 'retry') {
      const fix = await fixGuidance(s, { registry: this.d.registry, ...assistantAgent(home), escalate });
      s = store.state(runId)!;
      // the person retried, stopped or allowed edits while the diagnosis ran: theirs wins
      if (engine.isLive(runId) || s.status !== 'error' || !s.autofix || s.autofix.gaveUp) return;
      if (fix.needsWrites && s.kind === 'team' && !s.pipeline.settings.allowWrites && !store.eventsNoChunks(runId).some((e) => e.event.type === 'autofix.needs_writes')) {
        this.working.delete(runId); // waiting on the person now, not working
        store.append(runId, { type: 'autofix.needs_writes', why: NEEDS_WRITES, ...(fix.guidance ? { guidance: fix.guidance } : {}) });
        return;
      }
      if (fix.guidance) {
        this.guide(s, fix.guidance, round);
        detail += ' with the diagnosis attached';
      }
    } else engine.amend(runId, d.node!, { agent: d.target!.agent, model: d.target!.model }, `auto-fix round ${round}`);
    store.append(runId, { type: 'autofix.round', round, of, action: d.action, ...(d.action === 'escalate' ? { node: d.node, to: d.target } : {}), detail });
    await engine.resume(runId, { retryFailed: true });
  }

  /** The diagnosis goes to every failed agent step and to the step the supervisor blames (a failing check's fixer). */
  private guide(s: RunState, guidance: string, round: number): void {
    const ids = new Set(s.pipeline.nodes.filter((n) => n.kind === 'agent' && s.nodes[n.id]?.status === 'error').map((n) => n.id));
    const c = culprit(s);
    if (c) ids.add(c.id);
    for (const id of ids) this.d.engine.amend(s.id, id, { guidance: `Auto-fix diagnosis (round ${round}): ${guidance}` }, `auto-fix round ${round}`);
  }

  private giveUp(runId: string, rounds: number, why: string): void {
    this.working.delete(runId); // over before the event lands, so a goal watching the run settles on it
    this.d.store.append(runId, { type: 'autofix.gave_up', rounds, why: why.replace(/\s+/g, ' ').slice(0, 200) });
  }
}
