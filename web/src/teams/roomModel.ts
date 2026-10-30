/**
 * A team's room (board 2) as data: the runs strip (the team's runs and loop goals, the live one first), who handed work to
 * whom in the last week (the Whole team map), and the chat focused on one member. Pure.
 */
import type { GoalView } from '../goals/goalsApi';
import type { Card, TeamMessage, TeamView } from './teamsApi';

const WEEK = 7 * 86_400_000;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, name: string) => new RegExp(`(^|[^\\w@])@${esc(name)}(?![\\w-])`, 'i').test(text);

export type StripItem =
  | { kind: 'run'; id: string; runId: string; title: string; card: Extract<Card, { kind: 'run' }>; pr?: { number: number; merged?: boolean }; at: number }
  | { kind: 'loop'; id: string; goalId: string; title: string; goal?: GoalView; at: number };

const LIVE = new Set(['running', 'paused']);

/** The team's runs (each run card, its PR if any) and loop goals, the live ones first, then the newest. */
export function stripItems(v: Pick<TeamView, 'messages'>, goals: GoalView[] = []): StripItem[] {
  const prs = new Map<string, { number: number; merged?: boolean }>();
  for (const m of v.messages) if (m.card?.kind === 'pr' && m.run) prs.set(m.run, { number: m.card.number, merged: m.card.merged });
  const items: StripItem[] = [];
  for (const m of v.messages) {
    const c = m.card;
    if (c?.kind === 'run' && !items.some((x) => x.kind === 'run' && x.runId === c.runId)) items.push({ kind: 'run', id: `r:${c.runId}`, runId: c.runId, title: c.title, card: c, ...(prs.has(c.runId) ? { pr: prs.get(c.runId) } : {}), at: m.at });
    if (c?.kind === 'loop' && !items.some((x) => x.kind === 'loop' && x.goalId === c.goalId)) {
      const goal = goals.find((g) => g.id === c.goalId);
      items.push({ kind: 'loop', id: `g:${c.goalId}`, goalId: c.goalId, title: goal?.title ?? 'Loop', ...(goal ? { goal } : {}), at: m.at });
    }
  }
  const live = (x: StripItem) => (x.kind === 'run' ? LIVE.has(x.card.status) : x.goal?.status === 'active' || x.goal?.status === 'needs_you');
  return items.sort((a, b) => Number(live(b)) - Number(live(a)) || b.at - a.at);
}

/** The run the map shows for a strip item: the run, or a loop's latest run. */
export const runOf = (x: StripItem | undefined): string | undefined => (x?.kind === 'run' ? x.runId : x?.goal?.items.filter((i) => i.kind === 'run' && i.runId).at(-1)?.runId);

export interface Who {
  id: string;
  name: string;
  kind: 'person' | 'agent';
}

/** Who handed work to whom in the last week: a message from one member that @mentions another, counted. */
export function handoffEdges(messages: TeamMessage[], who: Who[], now = Date.now()): { from: string; to: string; n: number }[] {
  const n = new Map<string, number>();
  for (const m of messages) {
    if (now - m.at > WEEK || !who.some((w) => w.id === m.from.id)) continue;
    for (const w of who) if (w.id !== m.from.id && mentions(m.text, w.name)) n.set(`${m.from.id}\u0000${w.id}`, (n.get(`${m.from.id}\u0000${w.id}`) ?? 0) + 1);
  }
  return [...n].map(([k, count]) => {
    const [from, to] = k.split('\u0000') as [string, string];
    return { from, to, n: count };
  });
}

/** The chat focused on one member: their messages and the ones that @mention them. */
export const focusOn = (messages: TeamMessage[], w: Who): TeamMessage[] => messages.filter((m) => m.from.id === w.id || mentions(m.text, w.name));

/** Live runs and what waits on the people, for the header's chips. */
export function roomCounts(v: Pick<TeamView, 'messages' | 'working'>, goals: GoalView[] = []): { live: number; needs: number } {
  const items = stripItems(v, goals);
  const live = items.filter((x) => (x.kind === 'run' ? x.card.status === 'running' : x.goal?.status === 'active')).length;
  const needs = v.messages.filter((m) => (m.card?.kind === 'approval' && m.card.status === 'pending') || (m.card?.kind === 'proposal' && m.card.status === 'proposed')).length;
  return { live, needs };
}
