import type { Pipeline, PipelineNode } from '../../../src/types';
import { SortableList, SortableListGroup, SortableListHandle, SortableListItem, SortableListItemContent } from '../components/beui/motion/sortable-list';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { stepTitle } from './stepText';

/** The steps in the order a straight chain runs them (each step has at most one before it and one after), or undefined when the workflow is a graph. */
export function chainOrder(pl: Pick<Pipeline, 'nodes' | 'edges' | 'mode'>): string[] | undefined {
  const { nodes, edges } = pl;
  if (pl.mode !== 'pipeline' || nodes.length < 2 || edges.length !== nodes.length - 1) return undefined;
  const next = new Map<string, string>();
  const hasPrev = new Set<string>();
  for (const e of edges) {
    if (next.has(e.from) || hasPrev.has(e.to) || e.from === e.to) return undefined;
    next.set(e.from, e.to);
    hasPrev.add(e.to);
  }
  const heads = nodes.filter((n) => !hasPrev.has(n.id));
  if (heads.length !== 1) return undefined;
  const order: string[] = [];
  for (let id: string | undefined = heads[0]!.id; id && order.length <= nodes.length; id = next.get(id)) order.push(id);
  return order.length === nodes.length && new Set(order).size === nodes.length ? order : undefined;
}

/** The same steps chained in `order`: new edges, and each step moved to its place along the row (its height kept). */
export function rechain(pl: Pipeline, order: string[]): void {
  const byId = new Map(pl.nodes.map((n) => [n.id, n]));
  pl.edges = order.slice(1).map((id, i) => ({ from: order[i]!, to: id }));
  const x0 = Math.min(...pl.nodes.map((n) => n.x));
  order.forEach((id, i) => {
    const n = byId.get(id);
    if (n) n.x = x0 + i * 260;
  });
  pl.nodes = order.map((id) => byId.get(id)).filter((n): n is PipelineNode => !!n);
}

/**
 * "Step order": a workflow that is a straight chain lists its steps in run order, and a step can be dragged (or moved with its
 * handle's arrow keys) to run earlier or later; the connections and the canvas follow. A workflow with branches is a graph
 * with no single order, so the list says so and the canvas stays the place to change it.
 */
export function StepOrder({ pl, mut }: { pl: Pipeline; mut: (fn: (p: Pipeline) => void) => void }) {
  const order = chainOrder(pl);
  if (pl.nodes.length < 2) return null;
  if (!order) {
    return (
      <div className="bl-order">
        <SectionHeading title="Step order" />
        <p className="bl-help">These steps are connected as a graph, so there is no single order to arrange. Drag from a port on the canvas to change what runs after what.</p>
      </div>
    );
  }
  const byId = new Map(pl.nodes.map((n) => [n.id, n]));
  const items = order.map((id) => ({ id, node: byId.get(id)! }));
  return (
    <div className="bl-order">
      <SectionHeading title="Step order" count={items.length} />
      <SortableList items={items} label="Step order" getItemLabel={(x) => stepTitle(x.node)} showUndo={false} className="max-w-none" onItemsChange={(next) => mut((p) => rechain(p, next.map((x) => x.id)))}>
        {(rows) => (
          <SortableListGroup className="bl-order-list space-y-0">
            {rows.map((x, i) => (
              <SortableListItem key={x.id} id={x.id} className="rounded-lg p-2">
                <SortableListHandle />
                <SortableListItemContent>
                  <span className="bl-order-n">{i + 1}</span> <span className="bl-order-name">{stepTitle(x.node)}</span> <code className="bl-order-id">{x.id}</code>
                </SortableListItemContent>
              </SortableListItem>
            ))}
          </SortableListGroup>
        )}
      </SortableList>
    </div>
  );
}
