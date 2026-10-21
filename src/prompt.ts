import { ancestorsOf, childrenOf, parentsOf } from './pipeline.js';
import { askable } from './consult.js';
import { rosterOf } from './handoff.js';
import type { Pipeline, PipelineNode, RunState } from './types.js';

export const DEFAULT_ROLE_PROMPTS: Record<string, string> = {
  manager:
    'You coordinate: you split the task into pieces and hand each to the right bot, then judge what comes back. ' +
    'Never edit files or run commands that change anything. Reply ONLY with the JSON the engine asks for, with no ' +
    'other text: for a plan {"tasks":[…]}; for a review {"decision":"accept"}, {"redo":[…]} or {"more":[…]}.',
  planner:
    'Analyse the task and the repository, then write a concrete, ordered implementation plan: files to change, ' +
    'approach, risks, and how to verify. Do not modify any files.',
  architect:
    'Review the plan against the existing code. Decide structure, interfaces, and data flow, and call out anything ' +
    'in the plan that will not work. Do not modify any files.',
  coder:
    'Implement the plan in the working tree. Keep changes minimal and consistent with the codebase. Add or update ' +
    'tests. Run the project\'s tests if you can.',
  reviewer:
    'Review the diff critically for correctness, missing tests, security problems and scope creep. Run commands ' +
    'to verify claims where you can. Do not modify files. Finish with exactly one line: `VERDICT: PASS` or ' +
    '`VERDICT: FAIL`, and if FAIL, list the specific problems above it.',
  tester: 'Write and run tests for the change. Report exactly what you ran and what it printed.',
};

const label = (n: PipelineNode) => `${n.role ?? n.kind} (${n.id})`;
const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, Math.floor(max / 2))}\n[... ${s.length - max} chars omitted ...]\n${s.slice(-Math.floor(max / 2))}`;

/** A card is an ordinary agent session and knows nothing of the graph it sits in; tell it. */
export function briefing(p: Pipeline, node: PipelineNode, canAsk: PipelineNode[] = [], canHand?: string[]): string {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const lines = p.nodes.map((n) => {
    const from = parentsOf(p, n.id).map((i) => label(byId.get(i)!)).join(', ') || '—';
    const to = childrenOf(p, n.id).map((i) => label(byId.get(i)!)).join(', ') || '—';
    return `- ${label(n)}${n.id === node.id ? '  ← YOU' : ''} · receives: ${from} · feeds: ${to}`;
  });
  const next = childrenOf(p, node.id);
  return [
    `You are one step in an automated software-development pipeline ("${p.name}"). The steps:`,
    ...lines,
    '',
    'Rules: do your own role\'s part and stop; do not redo upstream work; no person is available to answer ' +
      'questions, so state your assumptions instead of asking; ' +
      (next.length ? 'write for the next step, not for a human.' : 'you are the last step, so your output is the run\'s answer.'),
    ...(canAsk.length
      ? [
          '',
          'You may consult a step that has already finished when its reasoning would change your work (why it did something, a bug it may have caused, a detail it left out). ' +
            'End your answer with a line `@ASK <step-id>: <your question>` (up to two such lines) and stop; the answer comes back and you then finish. ' +
            'Ask only when it is essential; otherwise state your assumptions. Steps you can ask: ' + canAsk.map((n) => `${n.id} (${n.role ?? n.kind})`).join(', ') + '.',
        ]
      : []),
    ...(canHand?.length
      ? [
          '',
          'You may hand part of your work to a teammate bot. End your answer with a line `@HAND <bot>: <goal> | expect: <expected> | context: <ids>` ' +
            '(`expect` and `context` are optional; context lists ids of finished steps whose output the bot needs; up to two such lines) and stop. ' +
            'The bot works read-only; if it must change files, write `@HAND!` instead. The result comes back and you then finish. ' +
            'Hand off only what is clearly worth delegating. Bots you can hand to: ' + canHand.join(', ') + '.',
        ]
      : []),
  ].join('\n');
}

export interface PromptInput {
  pipeline: Pipeline;
  node: PipelineNode;
  state: RunState;
  vaultContext?: string;
  diff?: string;
  /** Failure text from a check that sent us back here. */
  failure?: { check: string; output: string };
  resumed?: boolean;
}

export function buildPrompt(i: PromptInput): string {
  const { pipeline: p, node, state } = i;
  const canAsk = node.kind === 'agent' && (p.settings.consult ?? 0) > 0 ? askable(state, node) : [];
  const canHand = node.kind === 'agent' && !node.manager && (p.settings.handoff ?? 0) > 0 ? rosterOf(node) : undefined;
  const parts: string[] = [`# Pipeline briefing\n${briefing(p, node, canAsk, canHand)}`];

  const role = node.prompt ?? DEFAULT_ROLE_PROMPTS[node.role ?? ''] ?? '';
  if (role) parts.push(`# Your role\n${role}`);
  const c = node.spawn?.contract;
  if (node.spawn && c) {
    const lines = [`Goal: ${c.goal}`];
    if (c.expected) lines.push(`Expected output: ${c.expected}`);
    lines.push(`Handed to you by ${node.spawn.parent}.`);
    parts.push(`# Your assignment\n${lines.join('\n')}`);
  }
  if (node.guidance) parts.push(`# Guidance from the person in charge (follow it)\n${node.guidance}`);
  if (node.verdict && !/VERDICT:/.test(role)) {
    parts.push('End your answer with exactly one line: `VERDICT: PASS` or `VERDICT: FAIL`.');
  }

  if (state.workspace?.context) parts.push(`# Project context (what you are working on)\n${state.workspace.context}`);

  parts.push(`# Task\n${state.task}`);

  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const upstream = node.spawn ? node.spawn.contract.context : p.settings.pipeMode === 'direct' ? parentsOf(p, node.id) : ancestorsOf(p, node.id);
  const blocks: string[] = [];
  for (const id of upstream) {
    const un = byId.get(id);
    const out = state.nodes[id]?.output;
    if (un?.kind === 'agent' && out) blocks.push(`## ${label(un)}\n${clip(out, 12_000)}`);
  }
  if (blocks.length) parts.push(`# Upstream output\n${blocks.join('\n\n')}`);

  if (i.vaultContext) parts.push(`# Knowledge graph context (from the team's Obsidian vault)\n${i.vaultContext}`);
  if (i.diff !== undefined) parts.push(`# Current diff against the base commit\n\`\`\`diff\n${clip(i.diff || '(no changes yet)', 30_000)}\n\`\`\``);
  if (i.failure) {
    parts.push(
      `# A check failed — fix it\nThe check "${i.failure.check}" rejected the previous attempt. Fix the cause in the working tree ` +
        `(do not weaken or delete the check). Its output:\n\`\`\`\n${clip(i.failure.output, 8000)}\n\`\`\``,
    );
  }
  if (i.resumed) {
    parts.push(
      '# Note\nThe run around you was interrupted and has resumed. Nothing you produced was discarded; continue from where you were rather than starting over.',
    );
  }
  return parts.join('\n\n');
}
