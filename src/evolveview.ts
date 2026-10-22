/**
 * The terminal's evolve view for one bot: its open and recent proposals with the diff, the cited lessons and any saved probe results,
 * plus the keys to pick edits, accept, reject (asked inline first) and go back. Pure: rendering and key handling only; the Tui does the
 * accepting and rejecting through evolveops. The view never asks the editor for a proposal (that costs money): that stays a CLI command.
 */
import type { EvolveData, ProposalView } from './evolveops.js';
import { amber, bold, clip, cyan, dim, green, red } from './ui.js';

export interface EvolveState {
  bot: string;
  /** The selected proposal's id (not a list position: the list is re-read and re-sorted while you look at it). */
  sel?: string;
  /** 0-based edits of the selected proposal picked for accepting; empty means all (refused after a probe dropped edits). */
  pick: number[];
  /** Waiting for y before rejecting this proposal. */
  confirm?: { id: string };
}

/** The selected proposal, by id. When it is gone (or nothing is selected yet), the first one, with picks and any pending reject cleared. */
export function selected(d: EvolveData, st: EvolveState): { p?: ProposalView; i: number } {
  const i = st.sel === undefined ? -1 : d.proposals.findIndex((x) => x.id === st.sel);
  if (i >= 0) return { p: d.proposals[i], i };
  const first = d.proposals[0];
  st.sel = first?.id;
  st.pick = [];
  st.confirm = undefined;
  return { p: first, i: 0 };
}
export type EvolveAct = { kind: 'accept'; id: string; pick?: number[] } | { kind: 'reject'; id: string } | { kind: 'back' };

function wrapPlain(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > w) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
    while (line.length > w) {
      out.push(line.slice(0, w));
      line = line.slice(w);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

const tone = (p: ProposalView) => (p.label === 'open' ? (p.stale ? amber : green) : p.label === 'accepted' ? cyan : dim);
const labelText = (p: ProposalView) => (p.label === 'open' && p.stale ? 'open, stale' : p.label);

export function evolveLines(d: EvolveData, st: EvolveState, width: number): string[] {
  const w = Math.max(30, width);
  const inner = w - 8;
  const out: string[] = [''];
  out.push(` ${bold(`Evolve · ${d.bot.name} (${d.bot.id})`)} ${dim(`· harness v${d.version} · lessons: ${d.confident} confident, ${d.tentative} tentative`)}`);
  out.push('');
  if (!d.evolvable) {
    out.push(`  ${dim(`${d.bot.id} cannot be evolved: its prompts are built from each step and never use a harness.`)}`);
  }
  if (!d.proposals.length) {
    out.push(`  ${dim('No proposals yet. Make one from the command line (one model call; nothing is applied until you accept):')}`);
    out.push(`  ${cyan(`aorch evolve ${d.bot.id}`)}`);
    out.push('', `  ${dim('esc back')}`);
    return out.map((l) => clip(l, w));
  }
  const sel = selected(d, st).i;
  d.proposals.forEach((p, i) => {
    const mark = i === sel ? cyan('▍') : ' ';
    out.push(`${mark} ${tone(p)(labelText(p).padEnd(12))} ${p.id}  ${dim(`${p.edits.length} edit${p.edits.length === 1 ? '' : 's'} · based on v${p.base}${p.version !== undefined ? ` · made v${p.version}` : ''}`)}`);
  });
  const p = d.proposals[sel]!;
  out.push('');
  out.push(` ${bold(p.id)} ${tone(p)(labelText(p))}${p.note ? dim(` · ${p.note}`) : ''}${p.costUsd !== undefined ? dim(` · editor cost $${p.costUsd.toFixed(4)}`) : ''}`);
  if (p.stale) out.push(`  ${amber(`written for v${p.base}, the harness is now v${d.version}: it cannot be accepted. Run aorch evolve ${d.bot.id} for a fresh proposal.`)}`);
  for (const e of p.edits) {
    const picked = st.pick.includes(e.n - 1);
    const role = e.roleNote ? ` ${dim(`(role note added to the bot's role prompt; ${e.before !== undefined ? 'replaces the earlier role note' : 'nothing is removed'})`)}` : '';
    const box = p.status === 'open' ? (picked ? green('[x]') : dim('[ ]')) : p.picked?.includes(e.n) ? cyan('[✔]') : '   ';
    const probe = e.probe === 'dropped' ? red(' dropped by the probe') : e.probe === 'unprobed' ? amber(` kept, not probed${e.probeNote ? `: ${e.probeNote}` : ''}`) : e.probe === 'kept' ? green(' kept by the probe') : '';
    out.push(`  ${box} ${bold(`${e.n}.`)} ${e.roleNote ? 'role note' : `${e.field} ${e.op}`}${role}${probe}`);
    if (e.before !== undefined) for (const l of wrapPlain(e.before, inner)) out.push(`      ${red(`- ${l}`)}`);
    if (e.after !== undefined) for (const l of wrapPlain(e.after, inner)) out.push(`      ${green(`+ ${l}`)}`);
    for (const l of e.lessons) {
      const facts = l.text !== undefined ? ` (${l.polarity}, ${l.runs} run${l.runs === 1 ? '' : 's'}, ${l.provenance}): ${l.text}` : ' (lesson no longer stored)';
      const [first, ...rest] = wrapPlain(`because ${l.id}${facts}`, inner);
      out.push(`      ${dim(first!)}`);
      for (const r of rest.slice(0, 2)) out.push(`      ${dim(r)}`);
    }
  }
  if (p.probe) {
    out.push('', `  ${bold('probe')} ${dim(`spent $${p.probe.spentUsd.toFixed(4)} of $${p.probe.budgetUsd.toFixed(2)}${p.probe.stoppedBy ? ` · stopped by ${p.probe.stoppedBy}` : ''} · ${p.probe.results.length} comparison${p.probe.results.length === 1 ? '' : 's'}`)}`);
    for (const r of p.probe.results.slice(0, 6)) out.push(`    ${(r.verdict === 'better' ? green : r.verdict === 'worse' ? red : dim)(r.verdict.padEnd(6))} ${dim(`edit ${r.edit ?? 'all'} on "${r.task.slice(0, 40)}"`)}`);
    if (p.composed) out.push(`  ${dim(`kept ${p.composed.kept.join(',') || 'none'} · dropped ${p.composed.dropped.join(',') || 'none'} · not probed ${p.composed.unprobed.join(',') || 'none'}`)}`);
  }
  out.push('');
  if (st.confirm?.id === p.id) {
    out.push(` ${amber(`Reject all ${p.edits.length} edit${p.edits.length === 1 ? '' : 's'} of ${p.id}? They will not be proposed again.`)}`);
    out.push(` ${bold('y to reject')} ${dim('· any other key cancels')}`);
  } else if (p.status === 'open' && !p.stale) {
    out.push(` ${dim(`↑↓ proposal · 1-${Math.min(9, p.edits.length)} pick edits${p.composed ? ' · K pick kept' : ''} · a accept ${st.pick.length ? 'picked' : 'all'} · r reject · esc back`)}`);
  } else out.push(` ${dim('↑↓ proposal · esc back')}`);
  return out.map((l) => clip(l, w));
}

/** Handle one key. Mutates `st`; returns what the Tui should do, or a message to show. */
export function evolveKey(d: EvolveData, st: EvolveState, k: string): { act?: EvolveAct; msg?: string } {
  const n = d.proposals.length;
  if (st.confirm) {
    const id = st.confirm.id;
    st.confirm = undefined;
    // the reject goes to the proposal that was on screen when r was pressed, and only if it is still the one selected and open
    const p = d.proposals.find((x) => x.id === id);
    if (k === 'y' && p && st.sel === id && p.status === 'open') return { act: { kind: 'reject', id } };
    return { msg: k === 'y' ? 'not rejected: the proposal changed on screen' : 'not rejected' };
  }
  const { p, i } = selected(d, st);
  if (k === 'esc') return { act: { kind: 'back' } };
  if ((k === 'up' || k === 'k' || k === 'down' || k === 'j') && n) {
    const next = d.proposals[(i + (k === 'up' || k === 'k' ? n - 1 : 1)) % n]!;
    if (next.id !== st.sel) st.pick = [];
    st.sel = next.id;
    return {};
  }
  if (!p) return k === 'a' || k === 'r' ? { msg: `no proposals: make one with aorch evolve ${d.bot.id}` } : {};
  const open = p.status === 'open';
  if (/^[1-9]$/.test(k)) {
    const i = Number(k) - 1;
    if (!open || i >= p.edits.length) return {};
    st.pick = st.pick.includes(i) ? st.pick.filter((x) => x !== i) : [...st.pick, i].sort((a, b) => a - b);
    return {};
  }
  if (k === 'K') {
    if (!open) return {};
    if (!p.composed) return { msg: 'no probe results: pick edits by number' };
    st.pick = p.composed.kept.map((x) => x - 1);
    return { msg: st.pick.length ? `picked the kept edits: ${p.composed.kept.join(', ')}` : 'the probe kept none of the edits' };
  }
  if (k === 'a' || k === 'r') {
    if (!open) return { msg: `${p.id} was already ${p.label}` };
    if (k === 'r') {
      st.confirm = { id: p.id };
      return {};
    }
    if (p.stale) return { msg: `written for v${p.base}, the harness is now v${d.version}: run aorch evolve ${d.bot.id} for a fresh proposal` };
    if (!st.pick.length && p.composed?.dropped.length) return { msg: `the probe dropped edit ${p.composed.dropped.join(',')}: tick the edits to accept (K ticks the kept ones)` };
    return { act: { kind: 'accept', id: p.id, ...(st.pick.length ? { pick: st.pick.map((x) => x + 1) } : {}) } };
  }
  return {};
}
