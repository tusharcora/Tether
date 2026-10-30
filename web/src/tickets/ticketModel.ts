/**
 * Tickets (board 10) as data: the board's columns, the filters, the This week strip, and the Backlog and Todo helper
 * boxes (ideas from chats, free agents for unassigned tickets, queued pickups). Pure; every number comes from real
 * tickets, squads and chats, and a box with nothing real to show is empty (the screen hides it).
 */
import type { Priority, Stage } from '../../../src/goals/types.js';
import type { GoalType, GoalView } from '../goals/goalsApi';
import type { AgentNow, Queued, TeamSummary } from '../teams/teamsApi';

export type Ticket = GoalView;
export const STAGE_LABEL: Record<Stage, string> = { backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress', in_review: 'In review', done: 'Done', canceled: 'Canceled' };
/** The board's columns; Canceled is in the List and its own filter. */
export const BOARD: Stage[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' };
/** How many of the three bars are lit, and in what tone. */
export const BARS: Record<Priority, { n: number; tone: 'bad' | 'warn' | 'mut' | 'none' }> = { urgent: { n: 3, tone: 'bad' }, high: { n: 3, tone: 'warn' }, medium: { n: 2, tone: 'warn' }, low: { n: 1, tone: 'mut' }, none: { n: 0, tone: 'none' } };
const RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
export const TYPE_WORD: Record<GoalType, string> = { feature: 'Feature', bugfix: 'Bug', refactor: 'Refactor', chore: 'Chore' };

export interface Filter {
  /** Needs me: tickets waiting on a person. */
  needs?: boolean;
  bugs?: boolean;
  squad?: string;
  /** An agent id, a person id, or '' for unassigned. */
  assignee?: string;
  canceled?: boolean;
}
export const priorityOf = (t: Pick<Ticket, 'priority'>): Priority => t.priority ?? 'none';

export function filterTickets(list: Ticket[], f: Filter): Ticket[] {
  return list.filter(
    (t) =>
      (!f.needs || !!t.needs) &&
      (!f.bugs || t.type === 'bugfix') &&
      (f.squad === undefined || t.squad === f.squad) &&
      (f.assignee === undefined || (f.assignee === '' ? !t.assignee : t.assignee?.id === f.assignee)) &&
      (f.canceled ? t.stage === 'canceled' : true),
  );
}

/** The board: a column per status, most urgent first (then newest); Done newest finished first. */
export function columns(list: Ticket[]): Record<Stage, Ticket[]> {
  const out = { backlog: [], todo: [], in_progress: [], in_review: [], done: [], canceled: [] } as Record<Stage, Ticket[]>;
  for (const t of list) out[t.stage].push(t);
  for (const s of Object.keys(out) as Stage[])
    out[s].sort((a, b) => (s === 'done' || s === 'canceled' ? (b.endedAt ?? 0) - (a.endedAt ?? 0) : RANK[priorityOf(a)] - RANK[priorityOf(b)] || b.createdAt - a.createdAt));
  return out;
}

const DAY = 86_400_000;
/** Monday 00:00 of the week `now` is in, local time. */
export const weekStart = (now: number): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY;
};
/** "38m", "3h", "2d". */
export const span = (ms: number): string => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : ms < DAY ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / DAY)}d`);
/** When a ticket started waiting on a person: its latest activity (the done message, the ship card), else when it was made. */
export const waitingSince = (t: Ticket): number => t.activity?.at(-1)?.at ?? t.createdAt;

/** Tickets that reached Done between `from` and `to`. */
const shippedIn = (list: Ticket[], from: number, to: number) => list.filter((t) => t.stage === 'done' && t.endedAt !== undefined && t.endedAt >= from && t.endedAt < to);
/** Shipped per day for the `n` days up to today, oldest first. */
export function shippedPerDay(list: Ticket[], now: number, n: number): number[] {
  const today = new Date(now).setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => shippedIn(list, today - (n - 1 - i) * DAY, today - (n - 2 - i) * DAY).length);
}

/** Board 10's This week strip: shipped (with each day so far), in flight and who, Todo → Done, the oldest wait on you. */
export function thisWeek(list: Ticket[], now = Date.now()) {
  const from = weekStart(now);
  const shipped = shippedIn(list, from, now + 1);
  const days = Math.min(7, Math.floor((now - from) / DAY) + 1);
  const inFlight = list.filter((t) => t.stage === 'in_progress' || t.stage === 'in_review');
  const who = [...new Set(inFlight.flatMap((t) => (t.assignee ? [t.assignee.id] : [])))];
  const avgMs = shipped.length ? shipped.reduce((a, t) => a + (t.endedAt! - t.createdAt), 0) / shipped.length : undefined;
  const oldest = list.filter((t) => t.needs && t.stage !== 'done' && t.stage !== 'canceled').sort((a, b) => waitingSince(a) - waitingSince(b))[0];
  return { shipped: shipped.length, perDay: shippedPerDay(list, now, days), inFlight: inFlight.length, who, ...(avgMs !== undefined ? { avgMs } : {}), ...(oldest ? { oldest: { ticket: oldest, since: waitingSince(oldest) } } : {}) };
}

/**
 * Board 10's "Ready for an agent": each unassigned Todo ticket of a squad gets one of that squad's free agents (each
 * agent suggested once), and each queued pickup can start now.
 */
export function readyFor(list: Ticket[], squads: TeamSummary[], agents: ({ id: string; name: string } & Partial<AgentNow>)[]) {
  const free = new Set(agents.filter((a) => !a.state || a.state === 'idle').map((a) => a.id));
  const used = new Set<string>();
  const assign: { ticket: Ticket; agent: string }[] = [];
  for (const t of list.filter((x) => x.stage === 'todo' && !x.assignee && x.squad).sort((a, b) => RANK[priorityOf(a)] - RANK[priorityOf(b)] || a.createdAt - b.createdAt)) {
    const agent = squads.find((s) => s.id === t.squad)?.agents.find((a) => free.has(a) && !used.has(a));
    if (!agent) continue;
    used.add(agent);
    assign.push({ ticket: t, agent });
  }
  const pickups: { squad: string; q: Queued; ticket?: Ticket }[] = squads.flatMap((s) => s.queue.map((q) => ({ squad: s.id, q, ...(q.ticket && list.some((t) => t.id === q.ticket) ? { ticket: list.find((t) => t.id === q.ticket)! } : {}) })));
  return { assign, pickups };
}

/** The tickets of one squad per status, as the squad pulse counts them (Todo, Doing, Review, Done). */
export function squadCounts(list: Ticket[], squad: string): { stage: Stage; label: string; n: number }[] {
  const mine = list.filter((t) => t.squad === squad);
  return (
    [
      ['todo', 'Todo'],
      ['in_progress', 'Doing'],
      ['in_review', 'Review'],
      ['done', 'Done'],
    ] as [Stage, string][]
  ).map(([stage, label]) => ({ stage, label, n: mine.filter((t) => t.stage === stage).length }));
}
