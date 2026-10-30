import type { RunView } from '../api';

/** Every gate and how it went: "npm test passed · tsc failed". */
export function gateSummary(r: RunView): string {
  const gates = r.pipeline.nodes.filter((n) => n.kind === 'gate');
  if (!gates.length) return 'No gates in this run';
  return gates
    .map((n) => {
      const s = r.nodes[n.id];
      const word = s?.status === 'error' || s?.gate?.ok === false ? 'failed' : s?.status === 'done' ? 'passed' : 'not run';
      return `${n.command ?? n.id} ${word}`;
    })
    .join(' · ');
}
