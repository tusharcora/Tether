/**
 * The run page's decision banner (spec 2026-10-29-asks-goals-runs §6.7): Merge to main, or Open PR instead. The run's
 * waiting approvals are approved; once the run is done its branch ships through the Teams ship helpers (push, `gh pr
 * create`) and, for a merge, waits for the PR's checks and merges it. A team's own run ships through its team, as it
 * always has: here it is only approved. What happened lands on the run as `run.shipped`.
 */
import type { Engine } from './engine.js';
import type { Exec } from './exec.js';
import { gitTop } from './git.js';
import { landBranch, NOTHING_TO_LAND, realOr, shippable, undoLanding, whileLanding } from './history.js';
import { NO_FILES } from './runLabels.js';
import { HttpError } from './serverkit.js';
import type { Store } from './store.js';
import type { Landed } from './history.js';
import type { RunState } from './types.js';
import { mergePr, prChecks, shipBranch } from './teams/ship.js';

const POLL_MS = 60_000;
const TRIES = 30;
/** Landings and undos in one folder go one at a time: two that both saw a clean snapshot would write over each other. */
const folders = new Map<string, Promise<unknown>>();
function inFolder<T>(folder: string, fn: () => Promise<T>): Promise<T> {
  // its real path: runs may spell one folder differently (a symlink, /tmp and /private/tmp)
  const key = realOr(folder);
  const run = (folders.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  folders.set(key, tail);
  void tail.then(() => folders.get(key) === tail && folders.delete(key));
  return run;
}

/** Where a fork's unlanded work starts: the fork point just below its nearest landed parent. Undefined with none landed, so an unlanded parent's work lands with it. */
function landingBase(store: Store, s: RunState): string | undefined {
  for (let run = s; run.origin?.kind === 'fork'; ) {
    const parent = store.state(run.origin.id);
    if (!parent) return run.baseSha; // it may have been landed: touch only the work below it
    if (parent.ship?.landed) return run.baseSha;
    run = parent;
  }
  return undefined;
}

/** What a landing failure tells a person: history.ts writes its own errors for them, but raw git and file-system text carries git words and paths. */
function plainFailure(e: Error): string {
  return e.message.startsWith('git ') || (e as NodeJS.ErrnoException).code ? "This work couldn't be put in the folder, so nothing was changed." : e.message;
}

/** Put a plain-folder run's work in its folder and record it on the run. Shared with the squad path. */
export async function landRun(d: { store: Store; home: string }, runId: string): Promise<{ landed: Landed } | { error: string; conflicts?: string[] }> {
  const s = d.store.state(runId)!;
  // taken before the folder's queue, in the same tick as the run's finish: from there on a rewind can't reach the work
  return whileLanding(runId, () => inFolder(s.repo, async () => {
    const now = d.store.state(runId)!;
    if (now.ship?.landed) return { error: 'This work is already in the folder.' };
    // it may have been rewound while it waited its turn: what's on it now isn't the finished work
    if (now.status !== 'done') return { error: 'This work is still changing, so nothing was put in the folder.' };
    try {
      const r = await landBranch(d.home, s.repo, s.branch, landingBase(d.store, s));
      if ('conflicts' in r) return { error: `${r.conflicts.join(', ')} changed since this work started, so nothing was put in the folder. Keep your version, or send this back.`, conflicts: r.conflicts };
      if (!r.files.length) return { error: NOTHING_TO_LAND };
      d.store.append(runId, { type: 'run.shipped', merged: true, landed: r });
      return { landed: r };
    } catch (e) {
      console.error(`[ship] ${(e as Error).message}`, (e as Error).cause ?? '');
      return { error: plainFailure(e as Error) };
    }
  }));
}

/** Only a squad can still send work back (it lands through `landRun` itself), and a done run can't be: this says what's left to do on its own page. */
function doneFailure(r: { error: string; conflicts?: string[] }, solo: boolean): string {
  if (r.conflicts) return `${r.conflicts.join(', ')} changed since this work started, so nothing in the folder was changed. Keep your version, or rewind this run from its page and run it again.`;
  return solo && r.error === NOTHING_TO_LAND ? NO_FILES : r.error;
}

const firstLine = (t: string, n: number) => t.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, n) ?? 'Tether run';

export interface RunShipDeps {
  store: Store;
  engine: Engine;
  exec: Exec;
  home: string;
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
      if (e.event.type !== 'run.finished' || e.event.status === 'paused') return;
      // the log is replayed by folding, not through here: only a new `run.finished` arrives, and landed work stays on the run's state
      const s = d.store.state(e.runId);
      if (e.event.status === 'done' && s?.solo && s.history && !s.ship?.landed && !d.teamOwns(e.runId)) this.want.set(e.runId, true);
      if (!this.want.has(e.runId)) return;
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

  /** The person's Merge to main (`merge`) or Open PR instead. 409 when nothing waits on them and the run is not done. `fromTicket`: its ticket's own approval. */
  async decide(runId: string, merge: boolean, fromTicket = false): Promise<void> {
    const s = this.d.store.state(runId);
    if (!s) throw new HttpError(404, `unknown run ${runId}`);
    if (s.ship?.landed) throw new HttpError(409, 'This work is already in the folder.');
    if (s.ship?.url) throw new HttpError(409, `already shipped as PR #${s.ship.number}`);
    const waiting = s.pipeline.nodes.filter((n) => n.kind === 'approval' && s.nodes[n.id]?.status === 'awaiting');
    if (!waiting.length && s.status !== 'done') throw new HttpError(409, 'nothing in this run waits on you');
    const team = this.d.teamOwns(runId);
    if (team && s.history && !waiting.length) throw new HttpError(409, 'Ship this from its squad.');
    if (s.origin?.kind === 'goal' && s.history && !waiting.length && !fromTicket) throw new HttpError(409, 'Finish this from its ticket.');
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
      if (s.history) {
        const r = await landRun(this.d, runId);
        if ('error' in r) this.d.store.append(runId, { type: 'run.shipped', error: doneFailure(r, !!s.solo) });
        return;
      }
      const out = await shippable(await gitTop(s.repo), this.d.home, runId, s.branch, s.baseSha, s.dirty);
      if ('error' in out) return void this.d.store.append(runId, { type: 'run.shipped', error: out.error });
      const r = await shipBranch({ repo: s.repo, branch: out.branch, base: out.base, title: firstLine(s.task, 70), body: `Opened from Tether (run ${runId}).\n\n${s.task}`, exec: this.d.exec });
      if ('error' in r) return void this.d.store.append(runId, { type: 'run.shipped', error: r.error });
      this.d.store.append(runId, { type: 'run.shipped', url: r.url, number: r.number });
      if (merge) await this.merge(runId, r, 0);
    } finally {
      this.busy.delete(runId);
    }
  }

  /** Take a landing back out of the folder, or 409 naming the files a person changed since. The run's work is kept. */
  async undo(runId: string): Promise<void> {
    const s = this.d.store.state(runId);
    if (!s) throw new HttpError(404, `unknown run ${runId}`);
    if (!s.ship?.landed) throw new HttpError(409, 'Nothing was put in the folder, so there is nothing to undo.');
    await inFolder(s.repo, async () => {
      const landed = this.d.store.state(runId)!.ship?.landed;
      if (!landed) throw new HttpError(409, 'Nothing was put in the folder, so there is nothing to undo.');
      let r: Awaited<ReturnType<typeof undoLanding>>;
      try {
        r = await undoLanding(this.d.home, s.repo, landed);
      } catch (e) {
        console.error(`[undo] ${(e as Error).message}`, (e as Error).cause ?? '');
        throw new HttpError(409, (e as Error).message);
      }
      if (r !== true) throw new HttpError(409, `These files can't be undone automatically: ${r.conflicts.join(', ')}. Nothing was changed.`);
      this.d.store.append(runId, { type: 'run.shipped', undone: true });
    });
  }

  /** Merge once the PR's checks pass; pending checks are looked at again later, a failure is recorded. */
  /** Merge a PR this run already opened (a ticket's Merge PR), once its checks pass. */
  mergeOpen(runId: string): void {
    const ship = this.d.store.state(runId)?.ship;
    if (!ship?.url || ship.number === undefined || ship.merged) throw new HttpError(409, 'This run has no open PR to merge.');
    this.job(this.merge(runId, { url: ship.url, number: ship.number }, 0));
  }

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
