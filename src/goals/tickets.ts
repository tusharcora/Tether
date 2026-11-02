/**
 * Tickets (spec 2026-10-30-squads-tickets §2.5) as pure functions: the status a ticket moves to on a run or loop event,
 * its key, its acceptance criteria and why it waits on a person. Every goal is a ticket: the loop engine keeps the goal's
 * `status`, a ticket's `stage` is what people see and move.
 */
import type { Criterion, Goal, GoalItem, GoalStatus, Member, Stage } from './types.js';

/** The migration's map (and a loop's, live): what the loop engine's state means as a ticket status. */
export function stageOfStatus(status: GoalStatus, started: boolean): Stage {
  if (status === 'paused') return started ? 'backlog' : 'todo';
  if (status === 'active') return 'in_progress';
  if (status === 'needs_you') return 'in_review';
  if (status === 'met') return 'done';
  return 'canceled';
}

/** Something that happened to a ticket's work. `what` of an approval: the plan (Tight squads) or the ship. */
export type TicketEvent =
  | { kind: 'started' }
  | { kind: 'asked'; what: 'plan' | 'ship' }
  | { kind: 'answered'; approved: boolean }
  | { kind: 'pr'; merged: boolean }
  | { kind: 'loop'; status: GoalStatus; started: boolean }
  /** A run ended with nothing left to ship (a read-only task, or no changes). */
  | { kind: 'finished' };

/**
 * The status after an event (spec §2.5 Flow): starting work → In progress; a ready PR or a ship that waits on approval →
 * In review; sent back → In progress; merge → Done. A loop's state maps as the migration does, except that a met loop
 * with a PR still open is In review, not Done. A plan approval leaves the status alone (the ticket says it needs you).
 */
export function nextStage(cur: Stage, ev: TicketEvent, t: { openPr: boolean }): Stage {
  switch (ev.kind) {
    case 'started':
      return 'in_progress';
    case 'asked':
      return ev.what === 'ship' ? 'in_review' : cur;
    case 'answered':
      return ev.approved ? cur : 'in_progress';
    case 'pr':
      return ev.merged ? 'done' : 'in_review';
    case 'finished':
      return t.openPr ? 'in_review' : cur === 'in_progress' ? 'done' : cur;
    case 'loop': {
      const s = stageOfStatus(ev.status, ev.started);
      return s === 'done' && t.openPr ? 'in_review' : s;
    }
  }
}

/** The key prefix from a project's name: its last word, letters and digits, upper-cased, at most 4 (`acme-web` → `WEB`). */
export function prefixFrom(name: string): string {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const w = [...words].reverse().find((x) => /[A-Z]/.test(x)) ?? words.at(-1) ?? '';
  return w.slice(0, 4) || 'T';
}
export const PREFIX_RE = /^[A-Z][A-Z0-9]{0,5}$/;
export const keyOf = (prefix: string, num: number | undefined): string => `${prefix}-${num ?? 0}`;

/** The criteria: the auto-checked one (the goal's finish check) first, then the manual items people tick. */
export function criteriaOf(g: Pick<Goal, 'check' | 'lastCheck'>, items: GoalItem[]): Criterion[] {
  const auto: Criterion[] = g.check ? [{ id: 'check', text: `${g.check.command}${g.check.kind === 'number' ? ` ${g.check.target ?? ''}`.trimEnd() : ' passes'}`, done: !!g.lastCheck?.ok, auto: true }] : [];
  return [...auto, ...items.filter((i) => i.kind === 'manual').map((i) => ({ id: `i${i.id}`, text: i.text, done: i.done, item: i.id }))];
}

/** Assignee and reviewer from a goal's assignees (spec §2.6): the loop's agent first, then the agents in order. */
export function membersOf(g: Pick<Goal, 'agent' | 'assignees'>): { assignee?: Member; reviewer?: Member } {
  const ids = [...new Set([...(g.agent ? [g.agent] : []), ...(g.assignees ?? []).filter((a) => a.kind === 'agent').map((a) => a.id)])];
  return { ...(ids[0] ? { assignee: { kind: 'agent' as const, id: ids[0] } } : {}), ...(ids[1] ? { reviewer: { kind: 'agent' as const, id: ids[1] } } : {}) };
}

/** The stored stage, else what the loop state says (a goal from before tickets, or one made without one). */
export const stageOf = (g: Pick<Goal, 'stage' | 'status' | 'startedAt'>): Stage => g.stage ?? stageOfStatus(g.status, !!g.startedAt);
export const openPr = (g: Pick<Goal, 'prs'>): boolean => !!g.prs?.some((p) => !p.merged);
