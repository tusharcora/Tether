/**
 * The Runs page (board 3) as data: which runs need the person, which are live, the rest by when; the filters and search;
 * the line under each title; and the week's figures for the right rail. Pure, so the page only lays it out.
 */
import type { RunRow } from '../api';
import { isFinished } from '../home/runText';
import { runsIn } from '../projects/projects';
import type { WorkspaceRow } from '../home/workspaces';
import { shortRunId } from '../ui/studio/RunGlyph';

const DAY = 86_400_000;
export const PAGE = 50;
export const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/** It waits on the person: a question, a plan ready, an approval waiting. */
export const needsYou = (r: Pick<RunRow, 'pending' | 'planReady' | 'steps'>): boolean => r.pending > 0 || r.planReady || r.steps.some((s) => s.status === 'awaiting');
/** Working now in this server and not waiting on the person. */
export const isLive = (r: RunRow): boolean => r.live && !needsYou(r);

export interface RunGroups {
  needs: RunRow[];
  live: RunRow[];
  today: RunRow[];
  /** Earlier this week, then older. */
  week: RunRow[];
  older: RunRow[];
}

/** Needs you, Live, Today, Earlier (this week, then older); newest first in each. */
export function groupRuns(rows: RunRow[], now = Date.now()): RunGroups {
  const sorted = [...rows].sort((a, b) => b.startedAt - a.startedAt);
  const today = startOfDay(now);
  const g: RunGroups = { needs: [], live: [], today: [], week: [], older: [] };
  for (const r of sorted) {
    if (needsYou(r) && !isFinished(r.status)) g.needs.push(r);
    else if (isLive(r)) g.live.push(r);
    else if (r.startedAt >= today) g.today.push(r);
    else if (r.startedAt >= now - 7 * DAY) g.week.push(r);
    else g.older.push(r);
  }
  return g;
}

export type RunsTab = 'all' | 'needs' | 'live' | 'scheduled';
export interface RunsFilter {
  tab: RunsTab;
  team?: string;
  agent?: string;
  project?: WorkspaceRow;
  q?: string;
}

/** The runs the filters keep: the tab, a team, an agent, the project, and the search over task, goal title, id and branch. */
export function filterRows(rows: RunRow[], f: RunsFilter, goalTitle: (id: string) => string | undefined = () => undefined): RunRow[] {
  const q = f.q?.trim().toLowerCase();
  return (f.project ? runsIn(rows, f.project) : rows).filter((r) => {
    if (f.tab === 'needs' && !(needsYou(r) && !isFinished(r.status))) return false;
    if (f.tab === 'live' && !isLive(r)) return false;
    if (f.team && r.origin?.team !== f.team) return false;
    if (f.agent && !r.bots.includes(f.agent)) return false;
    if (!q) return true;
    const goal = r.origin?.kind === 'goal' ? goalTitle(r.origin.id) : undefined;
    return [r.task, goal ?? '', r.id, shortRunId(r.id), r.branch].some((x) => x.toLowerCase().includes(q));
  });
}

/** The muted line under a run's title: what is happening now, what waits on you, the error and where to retry, or how it ended. */
export function nowLine(r: RunRow): { text: string; bad?: boolean } {
  const waiting = r.steps.find((s) => s.status === 'awaiting');
  if (!isFinished(r.status) || r.status === 'paused') {
    if (r.pending > 0) return { text: `${r.pending === 1 ? 'A question waits' : `${r.pending} questions wait`} for you` };
    if (r.planReady) return { text: 'The plan is ready for you' };
    if (waiting) return { text: `${waiting.title ?? waiting.id} waits on you` };
  }
  if (r.status === 'error') {
    const failed = r.steps.find((s) => s.status === 'error');
    const at = failed?.title ?? failed?.id;
    return { text: at ? `${at} failed · Retry from ${at}` : 'Failed · Retry', bad: true };
  }
  if (isLive(r) && r.current) return { text: `${r.current.bot} on ${r.current.title}` };
  if (r.live) return { text: r.kind === 'team' && !r.steps.length ? 'Tether is planning' : 'Working' };
  if (r.ship?.merged) return { text: `PR #${r.ship.number} merged` };
  if (r.ship?.url) return { text: `PR #${r.ship.number} open` };
  if (r.status === 'done') return { text: 'Done' };
  if (r.status === 'stopped') return { text: 'Stopped' };
  return { text: r.status === 'paused' ? 'Paused' : 'Interrupted: resume it from its page' };
}

/** The week's figures: runs, merged PRs, spend and the share of agent steps on free models, runs done without a retry. */
export function weekStats(rows: RunRow[], now = Date.now()) {
  const week = rows.filter((r) => r.startedAt >= now - 7 * DAY);
  const agentSteps = week.flatMap((r) => r.steps.filter((s) => s.kind === 'agent'));
  const done = week.filter((r) => r.status === 'done');
  return {
    runs: week.length,
    merged: week.filter((r) => r.ship?.merged).length,
    spent: week.reduce((a, r) => a + r.costUsd, 0),
    freeShare: agentSteps.length ? agentSteps.filter((s) => s.free).length / agentSteps.length : 0,
    firstTry: done.length ? done.filter((r) => !r.retried).length / done.length : undefined,
  };
}

/** Spend per day for the last 7 days, oldest first (the last is today). */
export function spendByDay(rows: RunRow[], now = Date.now()): number[] {
  const today = startOfDay(now);
  const days = Array.from({ length: 7 }, () => 0);
  for (const r of rows) {
    const back = Math.floor((today - startOfDay(r.startedAt)) / DAY);
    if (back >= 0 && back < 7) days[6 - back]! += r.costUsd;
  }
  return days;
}

export const ORIGIN_LABEL = { chat: 'Chats', goal: 'Goals', team: 'Teams', trigger: 'Triggers', schedule: 'Schedule', other: 'Other' } as const;
export type OriginKey = keyof typeof ORIGIN_LABEL;

/** Where the runs were started from, counted; a run from before origins counts as other. Zero counts are left out. */
export function startedFrom(rows: RunRow[]): { key: OriginKey; n: number }[] {
  const n = new Map<OriginKey, number>();
  for (const r of rows) n.set(r.origin?.kind ?? 'other', (n.get(r.origin?.kind ?? 'other') ?? 0) + 1);
  return (Object.keys(ORIGIN_LABEL) as OriginKey[]).flatMap((key) => (n.get(key) ? [{ key, n: n.get(key)! }] : []));
}
