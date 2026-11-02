/**
 * Squad messages as Telegram shows them (board 5), in Telegram's HTML: the speaker's name first ("<b>Bolt</b>: …", one
 * shared bot labels each agent), the agent's message in its teammate voice and one line of What I did (never the raw
 * report), cards as text with inline keyboards (Ship it / Not yet / Diff; Start run / Edit / Dismiss), a run's step track,
 * decided cards as "✓ Approved by Maya · 14:02". Pure: the bridge sends and edits what these return.
 */
import type { Card, TeamMessage, TeamView, Work } from '../types.js';

/** Telegram's limit is 4096 characters after entities; leave room for the card. */
const TEXT_MAX = 3000;
const DETAIL_MAX = 800;

export type Button = { text: string; callback_data: string };
export interface Rendered {
  text: string;
  reply_markup?: { inline_keyboard: Button[][] };
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const hhmm = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const short = (runId: string) => `R-${runId.slice(-4).toUpperCase()}`;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Callback data: an action letter and the team message id ("a|m…"), well under Telegram's 64 bytes. */
export const ACTIONS = { a: 'approve', r: 'reject', f: 'diff', s: 'start', e: 'edit', x: 'dismiss' } as const;
export type ActionKey = keyof typeof ACTIONS;
const btn = (text: string, k: ActionKey, msg: string): Button => ({ text, callback_data: `${k}|${msg}` });
export function parseAction(data: unknown): { action: (typeof ACTIONS)[ActionKey]; msg: string } | undefined {
  const m = typeof data === 'string' ? /^([arfsex])\|([A-Za-z0-9]{1,40})$/.exec(data) : null;
  return m ? { action: ACTIONS[m[1] as ActionKey], msg: m[2]! } : undefined;
}

const MARK: Record<string, string> = { done: '✓', running: '▸', awaiting: '▸', error: '✕', skipped: '–' };

function card(c: Card, msg: string, owner?: string): { lines: string[]; keys?: Button[][] } {
  const by = (who?: string) => (who === 'you' && owner ? owner : (who ?? 'someone'));
  if (c.kind === 'run') {
    const track = c.steps.map((s) => `${esc(s.title ?? s.id)}${MARK[s.status] ? ` ${MARK[s.status]}` : ''}`).join(' · ');
    return { lines: [`<b>${short(c.runId)}</b> · ${esc(cut(c.title, 80))}`, ...(track ? [track] : []), `${c.status} · ${usd(c.costUsd)}`] };
  }
  if (c.kind === 'approval') {
    const lines = [`<b>${esc(c.title)}</b>`, ...(c.detail ? [esc(cut(c.detail, DETAIL_MAX))] : []), ...(c.review ? [`${esc(c.review.by)} ${c.review.pass === undefined ? 'is reviewing' : c.review.pass ? 'approved' : 'asked for changes'}`] : [])];
    if (c.status === 'superseded') return { lines: [...lines, 'Replaced by a newer run'] };
    if (c.status !== 'pending') return { lines: [...lines, `${c.status === 'approved' ? '✓ Approved' : '✕ Sent back'} by ${esc(by(c.by))}${c.at ? ` · ${hhmm(c.at)}` : ''}${c.reason ? ` · ${esc(cut(c.reason, 200))}` : ''}`, ...(c.ship ? [shipLine(c.ship)] : [])] };
    if (c.what === 'next') return { lines, keys: [[btn('Start run', 'a', msg), btn('Skip', 'r', msg)]] };
    if (c.what === 'ship') return { lines, keys: [[btn('Ship it', 'a', msg), btn('Not yet', 'r', msg), ...(c.runId ? [btn('Diff', 'f', msg)] : [])]] };
    return { lines, keys: [[btn('Approve', 'a', msg), btn('Reject', 'r', msg)]] };
  }
  if (c.kind === 'proposal') {
    const lines = [`${c.loop ? 'Proposed loop' : 'Proposed run'}: <b>${esc(cut(c.task, 300))}</b>`];
    if (c.status === 'proposed') return { lines, keys: [[btn(c.loop ? 'Start loop' : 'Start run', 's', msg), btn('Edit', 'e', msg), btn('Dismiss', 'x', msg)]] };
    return { lines: [...lines, c.status === 'dismissed' ? 'Dismissed' : `Started${c.runId ? ` ${short(c.runId)}` : ''}${c.by ? ` by ${esc(by(c.by))}` : ''}`] };
  }
  if (c.kind === 'pr') return { lines: [`<a href="${esc(c.url)}">PR #${c.number} · ${esc(cut(c.title, 80))}</a>${c.merged ? ' · merged' : ''}`] };
  return { lines: [] };
}

const shipLine = (sh: NonNullable<Extract<Card, { kind: 'approval' }>['ship']>): string => {
  const pr = sh.pr ? `<a href="${esc(sh.pr.url)}">PR #${sh.pr.number}</a>` : 'the PR';
  return sh.state === 'merged' ? `${pr} merged` : sh.state === 'open' ? `${pr} open, merging once checks pass` : sh.state === 'failed' ? `Not shipped: ${esc(cut(sh.error ?? 'it failed', 200))}` : 'Opening the PR…';
};
/** What I did, in one line: files, size, the gates and their results. */
export const workLine = (w: Work): string => [`${w.files.length} file${w.files.length === 1 ? '' : 's'} · +${w.plus} −${w.minus}`, ...w.ran.map((r) => `${r.command} ${r.ok ? (r.summary ?? 'passed') : `failed${r.summary ? ` (${r.summary})` : ''}`}`)].join(' · ');

/** One team message, as the bot posts it. `owner`: the owner's Telegram name, for decisions made in Tether ("by you"). */
export function renderMessage(m: TeamMessage, owner?: string): Rendered {
  const body = m.pending ? '…' : esc(cut(m.text, TEXT_MAX));
  const c = m.card ? card(m.card, m.id, owner) : { lines: [] };
  const text = [`<b>${esc(m.from.name)}</b>: ${body}`, ...(m.work ? [`<i>${esc(workLine(m.work))}</i>`] : []), ...c.lines].join('\n');
  return { text, ...(c.keys ? { reply_markup: { inline_keyboard: c.keys } } : {}) };
}

/** An approval or a proposal still waiting: posted even while the team is muted. */
export const isAsk = (m: TeamMessage) => (m.card?.kind === 'approval' && m.card.status === 'pending') || (m.card?.kind === 'proposal' && m.card.status === 'proposed');

/** The pinned live status (board 5) and `/status`: the most pressing work, then counts and today's spend. */
export function renderStatus(v: TeamView, o: { mute?: number; now?: number } = {}): string {
  const top = [...v.working].sort((a, b) => Number(b.needs) - Number(a.needs))[0];
  const live = v.working.filter((w) => !w.needs).length;
  const needs = v.working.filter((w) => w.needs).length + v.messages.filter(isAsk).filter((m) => m.card?.kind === 'proposal').length;
  const head = top ? `<b>${top.needs ? 'Needs you' : 'Live'}</b> · ${esc(cut(top.title, 80))} · ${esc(top.line)}` : '<b>Nothing running</b>';
  const muted = o.mute && o.mute > (o.now ?? Date.now()) ? ` · muted until ${hhmm(o.mute)}` : '';
  return `${head}\n${live} live · ${needs} need${needs === 1 ? 's' : ''} you · ${usd(v.spend.usd)} of ${usd(v.team.limits.usdPerDay)} today${muted}`;
}
