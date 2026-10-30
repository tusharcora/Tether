/**
 * The run page's decision banner (spec 2026-10-29-asks-goals-runs §6.7): Merge to main, or Open PR instead. The run's
 * waiting approvals are approved; once the run is done its branch ships through the Teams ship helpers (push, `gh pr
 * create`) and, for a merge, waits for the PR's checks and merges it. A team's own run ships through its team, as it
 * always has: here it is only approved. What happened lands on the run as `run.shipped`.
 */
import type { Engine } from './engine.js';
import type { Exec } from './exec.js';
import { HttpError } from './serverkit.js';
import type { Store } from './store.js';
import { mergePr, prChecks, shipBranch } from './teams/ship.js';

const POLL_MS = 60_000;
const TRIES = 30;
const firstLine = (t: string, n: number) => t.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, n) ?? 'Tether run';

export interface RunShipDeps {
  store: Store;
  engine: Engine;
  exec: Exec;
  /** The run belongs to a team: its team ships it. */
  teamOwns: (runId: string) => boolean;
  /** How often and how many times a merge looks at pending checks (tests shorten it). */
  pollMs?: number;
  tries?: number;
}

export class RunShip {
  /** run id -> merge too, for runs approved but not finished yet. */
  private want = new Map<string, boolean>();
  private busy = new Set<string>();
  private jobs = new Set<Promise<unknown>>();

  constructor(private d: RunShipDeps) {
    d.store.onAppend((e) => {
      if (e.event.type !== 'run.finished' || !this.want.has(e.runId) || e.event.status === 'paused') return;
      if (e.event.status === 'done') this.job(this.ship(e.runId));
      else this.want.delete(e.runId); // failed or stopped: nothing to ship
    });
  }

  /** Resolves when no ship or merge is in flight (tests). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.allSettled([...this.jobs]);
  }
  private job(p: Promise<unknown>): void {
    const j: Promise<unknown> = p.catch((e: unknown) => console.error(`[ship] ${(e as Error).message}`)).finally(() => this.jobs.delete(j));
    this.jobs.add(j);
  }

  /** The person's Merge to main (`merge`) or Open PR instead. 409 when nothing waits on them and the run is not done. */
  async decide(runId: string, merge: boolean): Promise<void> {
    const s = this.d.store.state(runId);
    if (!s) throw new HttpError(404, `unknown run ${runId}`);
    if (s.ship?.url) throw new HttpError(409, `already shipped as PR #${s.ship.number}`);
    const waiting = s.pipeline.nodes.filter((n) => n.kind === 'approval' && s.nodes[n.id]?.status === 'awaiting');
    if (!waiting.length && s.status !== 'done') throw new HttpError(409, 'nothing in this run waits on you');
    const team = this.d.teamOwns(runId);
    if (!team) this.want.set(runId, merge);
    for (const n of waiting) this.d.engine.approve(runId, n.id, true, 'dashboard');
    const now = this.d.store.state(runId)!;
    if (waiting.length && now.status === 'paused' && !this.d.engine.isLive(runId)) await this.d.engine.resume(runId);
    if (!team && this.d.store.state(runId)!.status === 'done') this.job(this.ship(runId));
  }

  private async ship(runId: string): Promise<void> {
    if (this.busy.has(runId)) return;
    this.busy.add(runId);
    try {
      const merge = this.want.get(runId) ?? false;
      this.want.delete(runId);
      const s = this.d.store.state(runId)!;
      const r = await shipBranch({ repo: s.repo, branch: s.branch, base: s.baseSha, title: firstLine(s.task, 70), body: `Opened from Tether (run ${runId}).\n\n${s.task}`, exec: this.d.exec });
      if ('error' in r) return void this.d.store.append(runId, { type: 'run.shipped', error: r.error });
      this.d.store.append(runId, { type: 'run.shipped', url: r.url, number: r.number });
      if (merge) await this.merge(runId, r, 0);
    } finally {
      this.busy.delete(runId);
    }
  }

  /** Merge once the PR's checks pass; pending checks are looked at again later, a failure is recorded. */
  private async merge(runId: string, pr: { url: string; number: number }, tries: number): Promise<void> {
    let st: Awaited<ReturnType<typeof prChecks>>;
    try {
      st = await prChecks(pr.url, this.d.exec);
    } catch (e) {
      return void this.d.store.append(runId, { type: 'run.shipped', error: `Could not read PR #${pr.number}'s checks: ${(e as Error).message}` });
    }
    if (st === 'merged') return void this.d.store.append(runId, { type: 'run.shipped', merged: true });
    if (st === 'fail') return void this.d.store.append(runId, { type: 'run.shipped', error: `Checks failed on PR #${pr.number}, so it was not merged.` });
    if (st === 'pending') {
      if (tries >= (this.d.tries ?? TRIES)) return void this.d.store.append(runId, { type: 'run.shipped', error: `PR #${pr.number}'s checks are still running; merge it on GitHub when they pass.` });
      // shortcut: the wait lives in memory and ends with the server, as a team's merge does; persist it if merges get lost across restarts
      setTimeout(() => this.job(this.merge(runId, pr, tries + 1)), this.d.pollMs ?? POLL_MS).unref?.();
      return;
    }
    const why = await mergePr(pr.url, this.d.exec);
    this.d.store.append(runId, why ? { type: 'run.shipped', error: `Could not merge PR #${pr.number}: ${why}` } : { type: 'run.shipped', merged: true });
  }
}
