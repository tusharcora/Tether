/** "Do it myself": a run of one step, by one bot. */
import { baseStep } from './handoff.js';
import { normalizePipeline } from './pipeline.js';
import type { Pipeline, PipelineNode } from './types.js';

export function soloPipeline(o: { task: string; bot?: string; agent?: string; model?: string }): Pipeline {
  const bot = o.bot ?? 'coder';
  // the bot's own persona and read-only setting; a lone step has nothing to loop back to
  const { maxLoops: _loops, fixNode: _fix, ...base }: Partial<PipelineNode> = baseStep(bot) ?? {};
  void [_loops, _fix];
  const title = o.task.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 70);
  return normalizePipeline({ name: 'solo', nodes: [{ ...base, id: 'work', kind: 'agent', role: base.role ?? bot, title, agent: o.agent, model: o.model }], edges: [], settings: {} });
}
