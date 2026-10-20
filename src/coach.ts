import type { CoachFinding, RunState } from './types.js';

/**
 * Deterministic audit of a run: how far to trust what it reports. Not a model — it reads the
 * event-derived state only, costs nothing, and gives the same answer every time.
 * A finding appears only when the record has the evidence.
 */
export function computeCoach(s: RunState): CoachFinding[] {
  const out: CoachFinding[] = [];
  const nodes = s.pipeline.nodes;

  const gates = nodes.filter((n) => n.kind === 'gate');
  if (!gates.length) {
    out.push({
      id: 'no-gate',
      title: 'Nothing independent verified this run',
      detail: 'The pipeline has no gate node, so every pass is an agent grading its own work.',
      action: 'Add a gate node that runs your tests, linter or type-checker, and point its fixNode at the coder.',
    });
  }

  const trivial = gates.filter((g) => /^\s*(true|:|exit\s+0)\s*$/.test(g.command ?? ''));
  for (const g of trivial) {
    out.push({
      id: `trivial-gate:${g.id}`,
      title: `Gate "${g.id}" cannot fail`,
      detail: `Its command (${g.command}) always exits 0, so passing it proves nothing.`,
      action: 'Replace it with a real check such as your test command.',
    });
  }

  const silent = nodes.filter(
    (n) => n.kind === 'agent' && !n.readOnly && !n.verdict && s.nodes[n.id]?.status === 'done' && !s.nodes[n.id]?.commit,
  );
  for (const n of silent) {
    out.push({
      id: `no-change:${n.id}`,
      title: `"${n.id}" finished without changing any files`,
      detail: 'It reported success but left the working tree untouched, so downstream steps are judging an unchanged tree.',
      action: 'Open its output; if it only described a change, re-run it with a stronger model or a more explicit prompt.',
    });
  }

  if (s.pipeline.settings.maxCostUsd !== undefined && s.costUsd === 0 && s.status !== 'stopped') {
    out.push({
      id: 'cost-unenforced',
      title: 'Spend cap was not enforced',
      detail: `maxCostUsd is set but no step reported any cost, so the cap had nothing to measure.`,
      action: 'Use an adapter that reports cost (claude does), or rely on the per-node timeout.',
    });
  }

  return out.slice(0, 3);
}
