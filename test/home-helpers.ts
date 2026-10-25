import type { Store } from '../src/store.js';
import { DEFAULT_SETTINGS, type Pipeline, type PipelineNode } from '../src/types.js';
import { pipe } from './helpers.js';

/** Start a run in the event log without the engine: a chained pipeline of `nodes` (default: one coder step titled Implement). */
export function seedRun(store: Store, id: string, o: { kind?: 'workflow' | 'team'; nodes?: Partial<PipelineNode>[]; task?: string; probe?: boolean; name?: string } = {}): void {
  const nodes = o.nodes ?? (o.kind === 'team' ? [] : [{ id: 'code', role: 'coder', title: 'Implement' }]);
  const pipeline: Pipeline = nodes.length
    ? { ...pipe(nodes, nodes.slice(1).map((n, i) => [nodes[i]!.id!, n.id!] as [string, string])), name: o.name ?? 'flow' }
    : { name: o.kind === 'team' ? 'team' : (o.name ?? 'flow'), version: 1, mode: 'pipeline', nodes: [], edges: [], settings: { ...DEFAULT_SETTINGS } };
  store.append(id, {
    type: 'run.started',
    pipeline,
    task: o.task ?? 'a task',
    repo: '/repo',
    workdir: '/wt',
    baseSha: 'abc',
    branch: `aorch/${id}`,
    ...(o.kind ? { kind: o.kind } : {}),
    ...(o.probe ? { probe: { proposal: 'p1', side: 'baseline' as const } } : {}),
  });
}
