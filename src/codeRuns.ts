/**
 * What runs did to a project's files, for the Code screen: the runs whose recorded commits touch a file (the runs lens),
 * the paths runs touched lately (the "Changed by runs" filter), and the run writing in this checkout right now (the lock).
 */
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { CREW } from './bots.js';
import { git } from './git.js';
import { rowLive, runTitle, type LiveProbe } from './runLabels.js';
import type { Store } from './store.js';
import type { RunState, RunStatus } from './types.js';

const MAX_RUNS = 20;
const PATCH_LINES = 80;
const DAY = 86_400_000;
const CACHE_MAX = 500;

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const within = (p: string, base: string) => p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);

export interface RunTouch {
  runId: string;
  /** The task's first line. */
  title: string;
  /** The run's label: its workflow, or "Team run". */
  label: string;
  status: RunStatus;
  live: boolean;
  /** When it finished, else its newest event. */
  at: number;
  add: number;
  del: number;
  /** Changed lines in the run's version of the file. */
  hunks: { start: number; lines: number }[];
  /** The file's diff in this run, from the first hunk, cut to 80 lines (the lens's mini diff). */
  patch: string;
}

type Row = ReturnType<Store['listRows']>[number];

/** Keyed by base + last commit: a finished run is read once, a live one again after each new commit. Oldest entries go first. */
const numstats = new Map<string, Map<string, { add: number; del: number }>>();
const patches = new Map<string, { hunks: RunTouch['hunks']; patch: string }>();
function remember<V>(m: Map<string, V>, k: string, v: V): V {
  if (m.size >= CACHE_MAX) m.delete(m.keys().next().value!);
  m.set(k, v);
  return v;
}

/** The run's newest recorded commit (its last step that committed). */
const lastCommit = (s: RunState): string | undefined =>
  Object.values(s.nodes)
    .filter((n) => n.commit)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .at(-1)?.commit;

/** Runs started in this project's repo (in its folder, or in the repo folder that holds it), newest first, without Evolve probes. */
function projectRuns(store: Store, root: string): (Row & { last: string })[] {
  return store.listRows().flatMap((row) => {
    const repo = real(row.state.repo);
    const last = lastCommit(row.state);
    return !row.state.probe && last && row.state.baseSha && (within(repo, root) || within(root, repo)) ? [{ ...row, last }] : [];
  });
}

/** Lines added and removed per file between the run's base and its last commit, project-relative (`--relative`). */
async function numstatOf(root: string, base: string, last: string) {
  const key = `${root}\0${base}..${last}`;
  const hit = numstats.get(key);
  if (hit) return hit;
  const out = new Map<string, { add: number; del: number }>();
  const r = await git(root, ['diff', '--numstat', '-z', '--relative', base, last]).catch(() => undefined);
  const parts = r?.code === 0 ? r.stdout.split('\0') : [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(parts[i]!.replace(/^\n/, ''));
    if (!m) continue;
    // a rename is "add del <empty>" followed by the old and the new path
    const path = m[3] || ((i += 2), parts[i]!);
    out.set(path, { add: Number(m[1]) || 0, del: Number(m[2]) || 0 });
  }
  return remember(numstats, key, out);
}

/** The file's changed line ranges (from `-U0`) and a short patch with context (from `-U2`). */
async function patchOf(root: string, base: string, last: string, rel: string) {
  const key = `${root}\0${base}..${last}\0${rel}`;
  const hit = patches.get(key);
  if (hit) return hit;
  const [zero, ctx] = await Promise.all([git(root, ['diff', '-U0', '--no-color', '--relative', base, last, '--', rel]), git(root, ['diff', '-U2', '--no-color', '--relative', base, last, '--', rel])]);
  const hunks = [...zero.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ start: Number(m[1]), lines: m[2] === undefined ? 1 : Number(m[2]) }));
  const body = ctx.stdout.split('\n');
  const from = body.findIndex((l) => l.startsWith('@@'));
  const lines = from < 0 ? [] : body.slice(from, body.at(-1) === '' ? -1 : undefined);
  const patch = lines.length > PATCH_LINES ? [...lines.slice(0, PATCH_LINES), '…'].join('\n') : lines.join('\n');
  return remember(patches, key, { hunks, patch });
}

/** The runs whose commits touch `rel` (a clean project-relative path), newest first, at most 20. */
export async function runsForFile(store: Store, engine: LiveProbe, root: string, rel: string): Promise<RunTouch[]> {
  const out: RunTouch[] = [];
  for (const { summary, state, lastTs, last } of projectRuns(store, root)) {
    const stat = (await numstatOf(root, state.baseSha, last)).get(rel);
    if (!stat) continue;
    out.push({
      runId: summary.id,
      title: state.task.split('\n')[0]!.slice(0, 80),
      label: runTitle(summary),
      status: state.status,
      live: rowLive(engine, { ...summary, lastTs }),
      at: state.finishedAt ?? lastTs,
      ...stat,
      ...(await patchOf(root, state.baseSha, last, rel)),
    });
    if (out.length >= MAX_RUNS) break;
  }
  return out;
}

/** Every project-relative path a run started in the last `days` days changed, sorted. */
export async function changedByRuns(store: Store, root: string, days = 30): Promise<string[]> {
  const since = Date.now() - days * DAY;
  const paths = new Set<string>();
  for (const { state, last } of projectRuns(store, root)) {
    if (state.startedAt < since) continue;
    for (const p of (await numstatOf(root, state.baseSha, last)).keys()) paths.add(p);
  }
  return [...paths].sort();
}

export interface RunLock {
  runId: string;
  node: string;
  /** The bot doing the step, by name ("Bolt"). */
  bot: string;
}

/**
 * A live run whose worktree is this very folder (`root`, a real path) and whose running step writes files: saving from
 * the Code screen waits for it (423). Runs in their own worktrees never lock the project's checkout.
 */
export function writingRun(store: Store, engine: LiveProbe, root: string): RunLock | undefined {
  for (const { summary, state, lastTs } of store.listRows()) {
    if (!rowLive(engine, { ...summary, lastTs }) || real(state.workdir) !== root) continue;
    const step = state.pipeline.nodes.find((n) => n.kind === 'agent' && !n.readOnly && state.nodes[n.id]?.status === 'running');
    if (step) return { runId: summary.id, node: step.id, bot: (step.role && CREW[step.role]?.name) || step.title || step.id };
  }
  return undefined;
}
