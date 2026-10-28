import type { Pipeline, PipelineNode } from '../../../src/types';
import { stepOrder } from '../runs/graphModel';

/** What a step is called: its title, else its role, else its kind. */
export const stepTitle = (n: Pick<PipelineNode, 'title' | 'role' | 'kind'>): string => n.title ?? n.role ?? n.kind;

/** A line of what the step does: an agent's instructions, a gate's command or request, an approval's pause. */
export function stepPreview(n: PipelineNode): string {
  if (n.kind === 'gate') return n.http ? `request ${n.http.run || 'not picked yet'}` : `$ ${n.command ?? '…'}`;
  if (n.kind === 'approval') return 'Pauses until a person signs off.';
  return n.prompt?.trim() || `Default instructions for the ${n.role ?? 'step'}.`;
}

const fixOf = (n: PipelineNode, nodes: PipelineNode[]) => (n.fixNode ? nodes.find((x) => x.id === n.fixNode) : undefined);

/** The canvas label on a fix loop: "if it fails · back to coder ×2". */
export function loopLabel(n: PipelineNode, nodes: PipelineNode[]): string | undefined {
  const fix = fixOf(n, nodes);
  return fix ? `if it fails · back to ${stepTitle(fix)} ×${n.maxLoops ?? 2}` : undefined;
}

/** The outline's sentence for a fix loop. */
export function loopSentence(n: PipelineNode, nodes: PipelineNode[]): string | undefined {
  const fix = fixOf(n, nodes);
  const max = n.maxLoops ?? 2;
  return fix ? `If it fails, the output goes back to ${stepTitle(fix)}, up to ${max} time${max === 1 ? '' : 's'}.` : undefined;
}

/** The line under the outline's title (§15.3): generated from the steps, never stored. */
export function flowLine(pl: Pick<Pipeline, 'nodes' | 'edges'>, nameOf: (n: PipelineNode) => string): string {
  if (!pl.nodes.length) return 'No steps yet';
  const byId = new Map(pl.nodes.map((n) => [n.id, n]));
  const names = stepOrder(pl.nodes, pl.edges).map((id) => nameOf(byId.get(id)!));
  return `${pl.nodes.length} step${pl.nodes.length === 1 ? '' : 's'} · ${names.join(' → ')}`;
}
