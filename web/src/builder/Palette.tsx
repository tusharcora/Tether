import { GitPullRequest, Globe, Plus, Webhook } from 'lucide-react';
import type { PipelineNode } from '../../../src/types';
import { CommandPalette, type CommandItem } from '../components/beui/motion/command-palette';
import { FloatBar } from '../ui/studio/ToolFrame';

export type EccSkill = { name: string; description: string; source: string; kind?: string };

/** The six built-in step kinds. */
export const PALETTE: { label: string; hint: string; make: () => Partial<PipelineNode> }[] = [
  { label: 'Planner', hint: 'read-only: plans the change', make: () => ({ kind: 'agent', role: 'planner', readOnly: true }) },
  { label: 'Architect', hint: 'read-only: reviews the plan', make: () => ({ kind: 'agent', role: 'architect', readOnly: true }) },
  { label: 'Coder', hint: 'edits files; each attempt is committed', make: () => ({ kind: 'agent', role: 'coder' }) },
  { label: 'Reviewer', hint: 'sees the diff; ends with VERDICT', make: () => ({ kind: 'agent', role: 'reviewer', readOnly: true, verdict: true, includeDiff: true }) },
  { label: 'Gate', hint: 'a command or saved request that must pass', make: () => ({ kind: 'gate', title: 'tests', command: 'npm test', maxLoops: 2 }) },
  { label: 'Approval', hint: 'pauses until a person signs off', make: () => ({ kind: 'approval', title: 'approve' }) },
];

/**
 * Ready-made steps that reach outside the run, each a step the engine already runs: GitHub is an agent that works through
 * Code Mode's github connector, an HTTP request is a gate that sends one of the workspace's saved requests, and a webhook is a
 * gate that posts to a Slack-style incoming webhook (the URL comes from the WEBHOOK_URL environment variable of the run).
 */
export const INTEGRATIONS: { label: string; hint: string; icon: typeof GitPullRequest; make: () => Partial<PipelineNode> }[] = [
  {
    label: 'GitHub',
    hint: 'an agent that reads or comments on issues and PRs',
    icon: GitPullRequest,
    make: () => ({ kind: 'agent', role: 'coder', title: 'GitHub', readOnly: true, prompt: 'Use run_code with the github.* connector to look up what this task needs (issues, pull requests, review comments), then report what you found. Do not change anything on GitHub unless the task says so.' }),
  },
  { label: 'HTTP request', hint: 'a saved API request that must succeed', icon: Globe, make: () => ({ kind: 'gate', title: 'request', http: { run: '' }, maxLoops: 2 }) },
  {
    label: 'Webhook',
    hint: 'posts a message to a Slack-style webhook',
    icon: Webhook,
    make: () => ({ kind: 'gate', title: 'notify', command: 'curl -fsS -X POST -H "Content-Type: application/json" -d \'{"text":"Workflow step finished"}\' "$WEBHOOK_URL"', maxLoops: 1 }),
  },
];

const make = (from: { label: string; make: () => Partial<PipelineNode> }[], label: string) => from.find((x) => x.label === label)!.make;

/** The add-step bar's quick kinds (mockup .cmd): each adds its step at once; Skill opens the menu, where the skills are. */
export const QUICK: { label: 'Agent' | 'Gate' | 'Approval' | 'Skill' | 'HTTP' | 'Webhook'; make?: () => Partial<PipelineNode> }[] = [
  { label: 'Agent', make: make(PALETTE, 'Coder') },
  { label: 'Gate', make: make(PALETTE, 'Gate') },
  { label: 'Approval', make: make(PALETTE, 'Approval') },
  { label: 'Skill' },
  { label: 'HTTP', make: make(INTEGRATIONS, 'HTTP request') },
  { label: 'Webhook', make: make(INTEGRATIONS, 'Webhook') },
];

/** Floats at the bottom of the canvas: "+ Add step" opens the menu ("/" does too), a quick kind adds its step. */
export function AddStepBar(p: { onMenu: () => void; onAdd: (make: () => Partial<PipelineNode>) => void }) {
  return (
    <FloatBar at="bottom" className="bl-add">
      <button type="button" className="bl-add-main" onClick={p.onMenu}>
        <Plus size={14} aria-hidden="true" />
        Add step
        <kbd className="bl-add-kbd">/</kbd>
      </button>
      {QUICK.map((q) => (
        <button key={q.label} type="button" className="bl-add-quick" onClick={() => (q.make ? p.onAdd(q.make) : p.onMenu())}>
          {q.label}
        </button>
      ))}
    </FloatBar>
  );
}

/**
 * Every step there is to add, searchable: the built-in kinds, the integrations (also after the selected step), and the
 * ECC skills and commands. A pick adds the step and chains it onto the last one (or the selected one).
 */
export function AddStepMenu(p: { open: boolean; onOpenChange: (o: boolean) => void; selected?: string; skills: EccSkill[]; onAdd: (make: () => Partial<PipelineNode>, after?: string) => void; onSkill: (s: EccSkill) => void }) {
  const sel = p.selected;
  const items: CommandItem[] = [
    ...PALETTE.map((x) => ({ id: `step:${x.label}`, label: x.label, group: 'Steps', description: x.hint, onSelect: () => p.onAdd(x.make) })),
    ...INTEGRATIONS.map((x) => ({ id: `int:${x.label}`, label: x.label, group: 'Integrations', description: x.hint, icon: x.icon, onSelect: () => p.onAdd(x.make) })),
    ...(sel ? INTEGRATIONS.map((x) => ({ id: `after:${x.label}`, label: `${x.label} after ${sel}`, group: `After ${sel}`, icon: x.icon, onSelect: () => p.onAdd(x.make, sel) })) : []),
    ...p.skills.map((s) => ({ id: `skill:${s.name}`, label: s.name, group: 'Skills', description: `${s.kind === 'command' ? 'ECC command' : 'ECC skill'} · ${s.description}`, onSelect: () => p.onSkill(s) })),
  ];
  return <CommandPalette items={items} open={p.open} onOpenChange={p.onOpenChange} shortcut={null} label="Add a step" placeholder="Find a step, integration or skill" emptyMessage="No step matches." />;
}
