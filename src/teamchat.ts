/**
 * Team runs in the chat: question cards, their keys, and the lines Tether says about a team run.
 * Everything here is pure (state in, lines out) so the terminal and its tests share it.
 */
import { CREW, crewFor } from './bots.js';
import type { Engine } from './engine.js';
import { planWaiting, type Answer, type PipelineNode, type Question, type RunState, type TeamMode } from './types.js';
import { bold, cyan, dim, renderQuestion, usd } from './ui.js';

export const MODE_HELP = 'live: Tether reports as the team works. autonomous: Tether answers for you and only reports at the end.';

export function parseModeArg(v: string | undefined): TeamMode | undefined {
  const t = v?.trim().toLowerCase();
  return t === 'live' || t === 'autonomous' ? t : undefined;
}

/** A run that is going (or paused) with a question waiting for the person: the face shows "waiting" for it. */
export function runNeedsYou(r: { status: string; pending?: number; planReady?: boolean }): boolean {
  return (r.status === 'running' || r.status === 'paused') && ((r.pending ?? 0) > 0 || !!r.planReady);
}

export { planWaiting };

/** The pending cards as chat lines. The first card is the one the keys answer; the rest wait their turn. */
export function cardLines(pending: Question[], width: number, focus = true): string[] {
  if (!pending.length) return [];
  const w = Math.max(20, width);
  const out: string[] = [];
  const first = pending[0]!;
  out.push(bold(pending.length > 1 ? `Tether has ${pending.length} questions (question 1 of ${pending.length})` : 'Tether has a question'));
  out.push(...renderQuestion(first, w - 2));
  if (!focus) out.push(`${cyan('enter')} ${dim('answer it, or type to chat')}`);
  else {
    const keys = [`${cyan('1-' + first.options.length)} ${dim('pick')}`, `${cyan('enter')} ${dim('recommended')}`];
    if (first.allowOther) keys.push(`${cyan('o')} ${dim('type your own')}`);
    out.push(keys.join('  '));
  }
  for (const [i, q] of pending.slice(1).entries()) out.push(dim(`next (${i + 2} of ${pending.length}): ${q.ask}`.slice(0, w - 2)));
  return out;
}

export type CardKey = { answer: Answer } | { other: true } | undefined;

/** What a key does to the first pending card: pick an option, accept the recommendation, or start free text. */
export function cardKey(q: Question, key: string): CardKey {
  if (key === 'enter') return { answer: { question: q.id, option: q.recommended, by: 'user' } };
  if (/^[1-9]$/.test(key)) {
    const o = q.options[Number(key) - 1];
    return o ? { answer: { question: q.id, option: o.id, by: 'user' } } : undefined;
  }
  if (key === 'o' && q.allowOther) return { other: true };
  return undefined;
}

const MILESTONES = [90, 75, 50, 25];
const nameOf = (n: PipelineNode | undefined, id: string) => (n ? (n.title ?? CREW[crewFor(n)]?.name ?? n.role ?? id) : id);

/**
 * New things worth telling the person about a team run, once each (`seen` remembers). Only a live run speaks;
 * an autonomous run still marks what happened, so switching to live does not replay it. Workflow runs have none.
 */
export function progressLines(st: RunState, seen: string[]): string[] {
  if (st.kind !== 'team') return [];
  const lines: string[] = [];
  const fresh = (key: string) => (seen.includes(key) ? false : (seen.push(key), true));
  const name = (id: string) => nameOf(st.pipeline.nodes.find((n) => n.id === id), id);
  for (const n of st.pipeline.nodes) {
    const ns = st.nodes[n.id];
    if (!ns) continue;
    // a step that carries on after the person's answer is not a redo; a manager re-queued after any answer says nothing
    if (ns.status === 'running' && ns.attempts > 1) {
      if (ns.resumedWithAnswer) {
        if (fresh(`${n.id}:answer:${ns.attempts}`)) lines.push(`${name(n.id)} carries on with your answer`);
      } else if (!n.manager && fresh(`${n.id}:redo:${ns.attempts}`)) lines.push(`${name(n.id)} is working on it again (attempt ${ns.attempts})`);
    }
    if ((ns.status === 'running' || ns.status === 'done') && fresh(`${n.id}:start`)) lines.push(`${name(n.id)} started`);
    if (ns.status === 'done' && fresh(`${n.id}:done:${ns.attempts}`)) lines.push(`${name(n.id)} finished${ns.verdict ? `: ${ns.verdict}` : ''}`);
  }
  (st.talk ?? []).forEach((t, i) => {
    if (fresh(`talk:${i}`)) lines.push(`${name(t.from)} → ${name(t.to)}: ${t.question.split('\n')[0]!.slice(0, 100)}`);
  });
  const budget = st.plan?.limits.maxCostUsd ?? st.pipeline.settings.maxCostUsd;
  if (budget && budget > 0) {
    const pct = (st.costUsd / budget) * 100;
    const crossed = MILESTONES.filter((m) => pct >= m);
    const newly = crossed.filter((m) => fresh(`cost:${m}`));
    if (newly.length) lines.push(`spend passed ${Math.max(...newly)}% of the ${usd(budget)} budget (${usd(st.costUsd)} so far)`);
  }
  return st.mode === 'live' ? lines : [];
}

const why0 = (st: RunState) => (st.status === 'error' && st.error ? ` Stopped because: ${st.error.split('\n')[0]!.slice(0, 160)}.` : '');

/** The one message every team run ends with, live or autonomous. */
export function finalSummary(st: RunState): string {
  const total = st.pipeline.nodes.length;
  const done = st.pipeline.nodes.filter((n) => st.nodes[n.id]?.status === 'done').length;
  if (!total) return `Team ${st.status === 'done' ? 'finished' : st.status === 'stopped' ? 'stopped' : 'failed'} before any work started.${why0(st)}`;
  const head = st.status === 'done' ? 'Team finished' : st.status === 'stopped' ? 'Team stopped' : 'Team run failed';
  const why = why0(st);
  return `${head}: ${done} of ${total} steps done · ${usd(st.costUsd)}.${why} The work is on branch ${st.branch}; /open to review it.`;
}

type CardEngine = Pick<Engine, 'recordPlanAnswers' | 'continuePlanningInBackground' | 'answerUser'>;

/**
 * Keys for the pending team card of the conversation's own run. The card takes keys only while it has focus: with a card
 * shown and nothing typed, enter gives it focus; then 1-9 pick, enter takes the recommendation, `o` starts free text
 * and esc hands the keys back to the chat. Any other key leaves card mode and types into the chat as usual, so a
 * message that starts with a digit or an "o" never answers a card by accident.
 * In free-text mode (after `o`) it only takes enter (send; empty is a no-op) and esc; the chat must not send that text.
 */
export class CardInput {
  /** The card being answered in the person's own words. */
  other?: string;
  /** The card has the keys (card mode). */
  focus = false;
  private runId?: string;
  private answering = new Set<string>();

  /** Back to chat mode, e.g. when the conversation moves to another run. */
  reset(): void {
    this.focus = false;
    this.other = undefined;
  }

  key(engine: CardEngine, runId: string, st: RunState, k: string, typed: string, onError: (m: string) => void): { used: boolean; clearText?: boolean } {
    if (runId !== this.runId) {
      this.reset();
      this.runId = runId;
    }
    const q0 = st.pending[0];
    if (!q0) {
      this.reset();
      return { used: false };
    }
    if (this.other) {
      const q = st.pending.find((x) => x.id === this.other);
      if (!q) {
        this.other = undefined;
        return { used: false };
      }
      if (k === 'esc') {
        this.other = undefined;
        return { used: true, clearText: true };
      }
      if (k !== 'enter') return { used: false };
      const text = typed.replace(/\r\n?/g, '\n').trim().slice(0, 2000);
      if (!text) return { used: true };
      this.answer(engine, runId, st, { question: q.id, text, by: 'user' }, onError);
      return { used: true, clearText: true };
    }
    if (typed) {
      this.focus = false;
      return { used: false };
    }
    if (!this.focus) {
      if (k !== 'enter') return { used: false };
      this.focus = true;
      return { used: true };
    }
    if (k === 'esc') {
      this.focus = false;
      return { used: true };
    }
    const r = cardKey(q0, k);
    if (!r) {
      // anything else is the start of a chat message
      this.focus = false;
      return { used: false };
    }
    if ('other' in r) {
      this.other = q0.id;
      return { used: true };
    }
    this.answer(engine, runId, st, r.answer, onError);
    return { used: true };
  }

  private answer(engine: CardEngine, runId: string, st: RunState, a: Answer, onError: (m: string) => void) {
    if (this.answering.has(a.question)) return;
    this.other = undefined;
    const fail = (e: Error) => onError(e.message.split('\n')[0]!);
    if (st.userAsks?.some((x) => x.question.id === a.question)) {
      this.answering.add(a.question);
      engine.answerUser(runId, a.question, { option: a.option, text: a.text }).catch(fail).finally(() => this.answering.delete(a.question));
      return;
    }
    try {
      if (engine.recordPlanAnswers(runId, [a])) engine.continuePlanningInBackground(runId);
    } catch (e) {
      fail(e as Error);
    }
  }
}

/** `/mode [live|autonomous]` on a run: changes the mode through the engine and returns what to tell the person. */
export function modeCommand(engine: Pick<Engine, 'setMode'>, id: string, st: RunState | undefined, arg: string | undefined): string {
  if (!st || st.kind !== 'team') return '/mode applies to a team run: open one first (/chat or /sessions)';
  const mode = parseModeArg(arg);
  if (!mode) return `mode is ${st.mode}. /mode live | autonomous  (${MODE_HELP})`;
  try {
    engine.setMode(id, mode);
  } catch (e) {
    return (e as Error).message.split('\n')[0]!;
  }
  return mode === 'live' ? 'live: I will report as the team works' : 'autonomous: I will answer for you and report at the end; I come to you if I am blocked or a limit is hit';
}

/** /approve or /reject on a ready plan. */
export function planDecision(engine: Pick<Engine, 'approveTeamPlan'>, id: string, approved: boolean): Promise<string> {
  return engine.approveTeamPlan(id, approved).then(() => (approved ? 'plan approved: the team is starting' : 'plan rejected'));
}

/** `/swap <n> <bot>`: give plan assignment n (1-based) to another bot. */
export function parseSwap(line: string): { assignment: number; bot: string } | undefined {
  const m = /^\/swap\s+(\d+)\s+([a-z][a-z0-9_-]{0,23})\s*$/.exec(line.trim());
  const n = m ? Number(m[1]) : 0;
  return m && n >= 1 ? { assignment: n - 1, bot: m[2]! } : undefined;
}
