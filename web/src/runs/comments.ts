/**
 * The person's comments on a run's diff lines (board 4): held in this browser per run (spec: "held locally"), listed in
 * the decision banner, and sent back to the step as its rework note; sent ones stay, marked sent.
 */
import { useCallback, useState } from 'react';
import type { RunView } from '../api';
import { stepOrder } from './graphModel';

export interface LineComment {
  id: string;
  /** The step whose diff it is on. */
  node: string;
  file: string;
  /** The diff line's id (parseDiff) and its text, so the note can quote it. */
  line: string;
  quote: string;
  text: string;
  at: number;
  sent?: boolean;
}

/** A note's limit: the server keeps a step's guidance to this. */
export const NOTE_MAX = 1000;
const KEY = (run: string) => `tether.run.comments.${run}`;

export function loadComments(run: string): LineComment[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(run)) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as LineComment[]) : [];
  } catch {
    return [];
  }
}
function saveComments(run: string, list: LineComment[]): void {
  try {
    if (list.length) localStorage.setItem(KEY(run), JSON.stringify(list));
    else localStorage.removeItem(KEY(run));
  } catch {
    /* storage unavailable: they last as long as the page */
  }
}

/** The rework note: the reason, then each comment with the file and the line it is on; cut to NOTE_MAX. */
export function sendBackNote(comments: LineComment[], reason: string): string {
  const lines = comments.map((c) => `- ${c.file}: "${c.quote.trim().slice(0, 120)}": ${c.text.trim()}`);
  return [reason.trim(), lines.length ? `Comments on the diff:\n${lines.join('\n')}` : ''].filter(Boolean).join('\n\n').slice(0, NOTE_MAX);
}

/** The step a Send back reruns: the earliest step the comments are on (all after it rerun too), else the open step, else the last that wrote. */
export function sendBackTarget(r: RunView, comments: LineComment[], open?: string): string | undefined {
  const agent = (id?: string) => !!id && r.pipeline.nodes.some((n) => n.id === id && n.kind === 'agent');
  const order = stepOrder(r.pipeline.nodes, r.pipeline.edges);
  const on = order.find((id) => comments.some((c) => c.node === id) && agent(id));
  if (on) return on;
  if (agent(open)) return open;
  return [...order].reverse().find((id) => agent(id) && !!r.nodes[id]?.commit) ?? order.find(agent);
}

/** The run's comments, kept in this browser. */
export function useComments(run: string) {
  const [list, setList] = useState(() => loadComments(run));
  const change = useCallback((f: (l: LineComment[]) => LineComment[]) => setList((cur) => {
    const next = f(cur);
    saveComments(run, next);
    return next;
  }), [run]);
  return {
    list,
    add: (c: Omit<LineComment, 'id' | 'at'>) => change((l) => [...l, { ...c, id: `c${Date.now().toString(36)}${l.length}`, at: Date.now() }]),
    remove: (id: string) => change((l) => l.filter((c) => c.id !== id)),
    markSent: (ids: string[]) => change((l) => l.map((c) => (ids.includes(c.id) ? { ...c, sent: true } : c))),
  };
}
