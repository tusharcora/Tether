/**
 * The agent's answer is plain text, optionally ending in one ```tether JSON block: its sources, runs it proposes, questions
 * it needs answered and a comparison. The block is data: it is cut from the text and every part is checked here (files must
 * exist in the project, runs in the store, notes in the vault, workflows on disk) before the dashboard sees it.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInWorkspace } from '../code.js';
import { pipelinesDir } from '../config.js';
import { NAME_RE } from '../pipeline.js';
import type { Store } from '../store.js';
import type { Vault } from '../vault.js';
import type { AskCard, Compare, Cite, Proposal } from './types.js';

export interface Checked {
  text: string;
  cites: Cite[];
  proposals: Proposal[];
  ask?: AskCard;
  compare?: Compare;
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
  return { text, cites, proposals, ...(questions.length ? { ask: { id: uid('a'), questions, status: 'pending' as const } } : {}), ...(compare ? { compare } : {}) };
}
