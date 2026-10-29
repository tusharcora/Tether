/**
 * The agent's answer is plain text, optionally ending in one ```tether JSON block: its sources, runs it proposes, questions
 * it needs answered, a comparison and the cards (report, spec, choice, diagram, timeline). The block is data: it is cut from the text and every part is checked here (files must
 * exist in the project, runs in the store, notes in the vault, workflows on disk) before the dashboard sees it.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInWorkspace } from '../code.js';
import { pipelinesDir } from '../config.js';
import { NAME_RE } from '../pipeline.js';
import type { Store } from '../store.js';
import type { Vault } from '../vault.js';
import type { AskCard, Choice, Compare, Cite, Diagram, Proposal, Report, Spec, TimelineEvent } from './types.js';

export interface Checked {
  text: string;
  cites: Cite[];
  proposals: Proposal[];
  ask?: AskCard;
  compare?: Compare;
  report?: Report;
  spec?: Spec;
  choice?: Choice;
  diagram?: Diagram;
  timeline?: TimelineEvent[];
}

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max).map((x) => obj(x) ?? {}) : []);
/** The first item per key: the cards key their rows by these. */
const uniqBy = <T>(xs: T[], key: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);

/** The cards, each checked like the rest of the block; `cites` is how many real sources the reply kept. */
export function checkCards(raw: Record<string, unknown>, cites: number): Pick<Checked, 'report' | 'spec' | 'choice' | 'diagram' | 'timeline'> {
  const out: Pick<Checked, 'report' | 'spec' | 'choice' | 'diagram' | 'timeline'> = {};
  const r = obj(raw.report);
  if (r) {
    const sections = list(r.sections, 8).flatMap((x) => {
      const heading = str(x.heading, 80);
      const summary = str(x.summary, 300);
      // a section counts only the reply's real sources, each once
      const sources = new Set((Array.isArray(x.cites) ? x.cites : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= cites)).size;
      return heading ? [{ heading, ...(summary ? { summary } : {}), sources }] : [];
    });
    if (str(r.title, 80) && sections.length) out.report = { title: str(r.title, 80), sections };
  }
  const s = obj(raw.spec);
  if (s) {
    const rows = uniqBy(
      list(s.rows, 16).flatMap((x) => (str(x.label, 40) && str(x.value, 80) ? [{ label: str(x.label, 40), value: str(x.value, 80), ...(x.emphasis === true ? { emphasis: true as const } : {}) }] : [])),
      (x) => x.label,
    );
    if (str(s.title, 80) && rows.length) out.spec = { title: str(s.title, 80), ...(str(s.subtitle, 120) ? { subtitle: str(s.subtitle, 120) } : {}), rows };
  }
  const c = obj(raw.choice);
  if (c && Array.isArray(c.traits)) {
    const traits = c.traits.slice(0, 6).map((v) => str(v, 40));
    const options = uniqBy(
      list(c.options, 3).flatMap((x) => {
        const name = str(x.name, 40);
        const own = Array.isArray(x.traits) ? x.traits : [];
        return name ? [{ name, headline: str(x.headline, 80), traits: traits.map((_, i) => (own[i] === false ? false : str(own[i], 60) || false)) }] : [];
      }),
      (x) => x.name,
    );
    const pick = str(c.pick, 40);
    if (traits.length && traits.every(Boolean) && options.length >= 2) out.choice = { traits, options, pick: options.some((o) => o.name === pick) ? pick : '', reason: str(c.reason, 240) };
  }
  const d = obj(raw.diagram);
  if (d) {
    const nodes = uniqBy(
      list(d.nodes, 12).flatMap((x) => (str(x.id, 40) ? [{ id: str(x.id, 40), label: str(x.label, 60) || str(x.id, 40) }] : [])),
      (x) => x.id,
    );
    const ids = new Set(nodes.map((n) => n.id));
    const edges = list(d.edges, 24).flatMap((x) => {
      const from = str(x.from, 40);
      const to = str(x.to, 40);
      const label = str(x.label, 40);
      return ids.has(from) && ids.has(to) && from !== to ? [{ from, to, ...(label ? { label } : {}) }] : [];
    });
    if (str(d.title, 80) && nodes.length) out.diagram = { title: str(d.title, 80), nodes, edges };
  }
  const timeline = list(raw.timeline, 12).flatMap((x): TimelineEvent[] => {
    const title = str(x.title, 100);
    const detail = str(x.detail, 200);
    return title && (x.when === 'past' || x.when === 'now' || x.when === 'future') ? [{ time: str(x.time, 16), title, ...(detail ? { detail } : {}), when: x.when }] : [];
  });
  if (timeline.length) out.timeline = timeline;
  return out;
}

const FENCE = /```tether\s*([\s\S]*?)(?:```|$)/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function checkReply(output: string, o: { home: string; repo?: string; store: Store; vault?: Vault }): Promise<Checked> {
  const m = FENCE.exec(output);
  const text = (m ? output.slice(0, m.index) : output).trim();
  let raw: Record<string, unknown> = {};
  if (m) {
    try {
      const v = JSON.parse(m[1]!);
      if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Record<string, unknown>;
    } catch {
      /* a malformed block: the text still stands */
    }
  }
  const cites: Cite[] = [];
  const seen = new Set<string>();
  for (const s of (Array.isArray(raw.sources) ? raw.sources : []).slice(0, 12)) {
    const x = (s ?? {}) as Record<string, unknown>;
    let c: Cite | undefined;
    try {
      if (typeof x.file === 'string' && o.repo) {
        const { abs, rel } = resolveInWorkspace(o.repo, x.file);
        if (existsSync(abs) && statSync(abs).isFile()) {
          const line = Number.isInteger(x.line) && (x.line as number) > 0 ? (x.line as number) : undefined;
          c = { n: 0, label: str(x.label, 60) || rel.split('/').pop()!, kind: 'file', path: rel, ...(line ? { line } : {}) };
        }
      } else if (typeof x.run === 'string' && o.store.state(x.run)) c = { n: 0, label: str(x.label, 60) || `run ${x.run}`, kind: 'run', id: x.run };
      else if (typeof x.note === 'string' && o.vault && (await o.vault.read(x.note))) c = { n: 0, label: str(x.label, 60) || x.note, kind: 'note', path: x.note };
    } catch {
      /* a path outside the project or a bad id: dropped */
    }
    const key = c && JSON.stringify([c.kind, (c as { path?: string }).path, (c as { id?: string }).id, (c as { line?: number }).line]);
    if (c && key && !seen.has(key)) (seen.add(key), cites.push({ ...c, n: cites.length + 1 }));
  }
  const proposals: Proposal[] = [];
  for (const p of (Array.isArray(raw.proposals) ? raw.proposals : []).slice(0, 3)) {
    const x = (p ?? {}) as Record<string, unknown>;
    const task = str(x.task, 2000);
    if (!task) continue;
    const why = str(x.why, 200) || undefined;
    if (x.kind === 'workflow') {
      const workflow = str(x.workflow, 64);
      if (!NAME_RE.test(workflow) || !existsSync(join(pipelinesDir(o.home), `${workflow}.json`))) continue;
      proposals.push({ id: uid('p'), kind: 'workflow', workflow, task, ...(why ? { why } : {}), status: 'proposed' });
    } else if (x.kind === 'team') {
      proposals.push({ id: uid('p'), kind: 'team', task, ...(x.mode === 'live' || x.mode === 'autonomous' ? { mode: x.mode } : {}), ...(why ? { why } : {}), status: 'proposed' });
    }
  }
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 4).flatMap((q, i) => {
    const x = (q ?? {}) as Record<string, unknown>;
    const options = (Array.isArray(x.options) ? x.options : []).slice(0, 6).flatMap((op, j) => {
      const label = str((op as Record<string, unknown>)?.label, 80);
      const desc = str((op as Record<string, unknown>)?.desc, 160);
      return label ? [{ id: `o${j + 1}`, label, ...(desc ? { desc } : {}) }] : [];
    });
    const title = str(x.title, 140);
    return title && options.length ? [{ id: `q${i + 1}`, title, ...(x.multi === true ? { multi: true } : {}), options }] : [];
  });
  let compare: Compare | undefined;
  const c = raw.compare as Record<string, unknown> | undefined;
  if (c && Array.isArray(c.columns) && Array.isArray(c.rows)) {
    const columns = c.columns.slice(0, 5).map((v) => str(v, 40));
    const rows = c.rows.slice(0, 12).flatMap((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const label = str(x.label, 60);
      return label && Array.isArray(x.cells) ? [{ label, cells: columns.map((_, i) => str((x.cells as unknown[])[i], 60)) }] : [];
    });
    if (columns.length && rows.length) compare = { ...(str(c.title, 80) ? { title: str(c.title, 80) } : {}), columns, rows };
  }
  return { text, cites, proposals, ...(questions.length ? { ask: { id: uid('a'), questions, status: 'pending' as const } } : {}), ...(compare ? { compare } : {}), ...checkCards(raw, cites.length) };
}
