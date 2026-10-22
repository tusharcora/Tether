/** A made-up run used to preview themes. Never written anywhere. */
import type { RunState } from './types.js';

export function sampleRun(now = Date.now()): RunState {
  const nodes = [
    { id: 'plan', kind: 'agent', role: 'planner', x: 0, y: 0, agent: 'claude' },
    { id: 'review', kind: 'agent', role: 'architect', x: 0, y: 0, agent: 'claude' },
    { id: 'code', kind: 'agent', role: 'coder', x: 0, y: 0, agent: 'ollama', model: 'qwen2.5-coder' },
    { id: 'tests', kind: 'gate', title: 'tests', x: 0, y: 0, command: 'npm test' },
    { id: 'lens', kind: 'agent', role: 'reviewer', x: 0, y: 0, agent: 'codex' },
  ] as RunState['pipeline']['nodes'];
  const st = (status: RunState['nodes'][string]['status'], over: Partial<RunState['nodes'][string]> = {}) => ({ status, attempts: 1, costUsd: 0, loops: 0, ...over });
  return {
    id: 'sample',
    status: 'running',
    pipeline: { name: 'add rate limiting', version: 1, mode: 'pipeline', nodes, edges: [], settings: { parallel: 2, nodeTimeoutMs: 60_000, pipeMode: 'ancestors', maxCostUsd: 3 } },
    task: 'sample',
    repo: '.',
    workdir: '.',
    baseSha: '0',
    branch: 'aorch/sample',
    autoApprove: false,
    kind: 'workflow',
    mode: 'live',
    planning: false,
    round: 0,
    pending: [],
    answers: [],
    setupDone: true,
    setupArtifacts: [],
    nodes: {
      plan: st('done', { startedAt: now - 140_000, finishedAt: now - 99_000, costUsd: 0.12 }),
      review: st('done', { startedAt: now - 99_000, finishedAt: now - 77_000, costUsd: 0.08, verdict: 'PASS', commit: '3fa9c21' }),
      code: st('running', { startedAt: now - 77_000, attempts: 2, costUsd: 0.41, live: '[tool] Edit src/limiter.ts\n' }),
      tests: st('queued'),
      lens: st('queued'),
    },
    spawned: 0,
    costUsd: 0.61,
    startedAt: now - 140_000,
    notes: [],
    actions: [],
  };
}
