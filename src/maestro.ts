/**
 * Talking to Maestro. One chat turn = one read-only agent call that answers in a sentence or two and may
 * propose a workflow to save, an improved version of an existing one, or a run to start. The agent never
 * writes anything itself: a proposal is validated here and only saved or run when the person confirms.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterRegistry } from './adapters/index.js';
import { blankPipeline, customBot, detectTestCommand, extractJson, makeStep, relink, proposableSteps, type StepType } from './composer.js';
import { listPipelines, pipelinesDir, readPipeline, writePipeline } from './config.js';
import { CREW } from './bots.js';
import { BUILTIN_IDS } from './crew.js';
import { NAME_RE, normalizePipeline, preflight } from './pipeline.js';
import type { Proposal, Turn } from './sessions.js';
import type { Pipeline } from './types.js';
import { contextOf, resolveWorkspace } from './workspace.js';

export type { Proposal, Turn };

export interface Reply {
  text: string;
  proposal?: Proposal;
  /** A shell command Maestro wants to run. Only ever shown to the person; it runs if they allow it. */
  command?: { command: string; why?: string };
  warnings: string[];
}

export interface ChatOpts {
  home: string;
  repo: string;
  registry: AdapterRegistry;
  agent?: string;
  model?: string;
  history?: Turn[];
  /** The workflow the person is looking at right now, if any. */
  current?: string;
  /** One line per recent run, so Maestro can say what the crew is doing. */
  runs?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const STEP_LINE = (p: Pipeline) => p.nodes.map((n) => (n.kind === 'gate' ? 'tester' : n.kind === 'approval' ? 'approval' : n.role ?? 'coder')).join(' → ');

export const stepsOf = STEP_LINE;

function crewLines(): string {
  return Object.values(CREW)
    .flatMap((c) => (c.def && !BUILTIN_IDS.has(c.def.id) && c.def.kind !== 'orchestrator' ? [c.def] : []))
    .map((d) => `- ${d.id} (${d.kind}) ${d.title}`)
    .join('\n');
}

function prompt(message: string, o: ChatOpts, tests: string | undefined): string {
  const flows = listPipelines(o.home);
  const ws = resolveWorkspace(o.home, { repo: o.repo });
  const lines = flows.map((f) => {
    try {
      return `- ${f.name}: ${STEP_LINE(readPipeline(o.home, f.name))}`;
    } catch {
      return `- ${f.name}`;
    }
  });
  const hist = (o.history ?? []).slice(-6).map((t) => `${t.who === 'you' ? 'User' : 'Maestro'}: ${t.text.slice(0, 400)}`).join('\n');
  return `You are Maestro, the orchestrator of a team of coding agents. Talk with the user in one to three plain sentences. You can also design, improve and save workflows (linear pipelines of steps), or start one. Do NOT do any coding task yourself and do not modify any files.

${ws ? contextOf(ws).slice(0, 2500) + '\n' : ''}Saved workflows:
${lines.join('\n') || '(none yet)'}
${o.current ? `The user is looking at: ${o.current}\n` : ''}${o.runs ? `Recent runs (newest first):\n${o.runs}\n` : ''}Test command detected in the repo: ${tests ?? 'none'}

Allowed step types (1 to 8 steps, in order): planner, architect, coder, tester (a gate that runs the test command; only if one exists), reviewer, approval (human sign-off).
${crewLines() ? 'Custom crew you may also use:\n' + crewLines() + '\n' : ''}
${hist ? 'Conversation so far:\n' + hist + '\n' : ''}
User: ${message}

Reply with ONLY a JSON object, no prose, no code fences:
{"reply":"what you say to the user",
 "intent":"answer" | "save" | "optimize" | "run" | "team",
 "name":"workflow-name (letters, digits, . _ -)",
 "steps":[ "planner", {"type":"coder","prompt":"optional extra instructions for this step"} ],
 "maxCostUsd": 5,
 "task":"what to do (only for run and team)",
 "mode":"live" | "autonomous" (only for team),
 "command":{"command":"one shell command","why":"what it tells us"}}
"command" is optional and at most one: use it only when you need to look at or change something on disk to help (prefer read-only ones such as git status, ls, cat, npm test). The person must approve it first, so say what it is for. Never anything destructive.
Use "answer" for questions and advice (leave out the other fields). Use "save" to create a new workflow from the user's needs. Use "optimize" to improve a saved workflow (name = that workflow; the steps are the improved version, and your reply says what changed and why). Use "run" to start a saved workflow (name + task). Use "team" (task, optional mode) when the work is open-ended or the user asks to "use a team": a team of bots plans the work with the user, asking questions first, instead of following a fixed pipeline. "live" means Maestro reports as the team works; "autonomous" means Maestro answers for the user and reports at the end. Prefer a saved workflow when the steps are already known. Prefer few steps; always put a coder before tester or reviewer; add approval for risky or user-facing changes.
Evolve: when the recent runs show the same bot sent back or redone again and again (or the user says a bot keeps making the same mistake), you may offer to run \`aorch evolve <bot>\`, which asks a model (one call, a small cost) to propose edits to that bot's guidance from the lessons learned; nothing changes until the user accepts the proposal. Only offer it: say so in your reply, or put it in "command" so the user can approve it. Never run it yourself and never claim it has run.`;
}

/** Turn the model's step list into a checked pipeline. Throws with a short reason when it is not usable. */
export function pipelineFromReply(raw: { name?: unknown; steps?: unknown; maxCostUsd?: unknown }, o: { repo: string; registry: AdapterRegistry; base?: Pipeline }, warnings: string[]): Pipeline {
  const name = String(raw.name ?? '').trim();
  if (!NAME_RE.test(name)) throw new Error(`"${name}" is not a usable workflow name`);
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 8) throw new Error('a workflow needs 1 to 8 steps');
  const tests = detectTestCommand(o.repo);
  const allowed = new Set(proposableSteps()); // managers are authored by hand, not proposed by Maestro
  const p = blankPipeline(name);
  if (o.base) p.settings = { ...o.base.settings };
  for (const s of raw.steps) {
    const type = String(typeof s === 'string' ? s : (s as { type?: unknown })?.type ?? '').toLowerCase();
    if (!allowed.has(type)) throw new Error(`unknown step type "${type}"`);
    if ((type === 'tester' || customBot(type)?.kind === 'gate') && !tests) {
      warnings.push('dropped a test gate: no test command found in the repo');
      continue;
    }
    const step = makeStep(type, p, undefined, tests);
    const extra = typeof s === 'object' && s ? (s as { prompt?: unknown }).prompt : undefined;
    if (typeof extra === 'string' && extra.trim() && step.kind === 'agent') step.prompt = extra.trim().slice(0, 600);
    p.nodes.push(step);
  }
  if (!p.nodes.length) throw new Error('empty workflow');
  const cap = Number(raw.maxCostUsd);
  if (Number.isFinite(cap) && cap > 0) p.settings.maxCostUsd = Math.min(50, cap);
  relink(p);
  const checked = normalizePipeline(p);
  const errs = preflight(checked, o.registry).filter((i) => i.level === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return checked;
}

/** One chat turn. Never throws: a failure comes back as a reply the person can read. */
export async function chat(message: string, o: ChatOpts): Promise<Reply> {
  const warnings: string[] = [];
  const agent = o.agent ?? 'claude';
  if (!o.registry.has(agent)) return { text: `I can't think without an agent: "${agent}" is not set up. Link a model to me in the Crew tab.`, warnings };
  try {
    let text = '';
    const res = await o.registry.get(agent).run({
      runId: 'maestro',
      nodeId: 'chat',
      prompt: prompt(message, o, detectTestCommand(o.repo)),
      cwd: o.repo,
      model: o.model,
      readOnly: true,
      attempt: 1,
      timeoutMs: o.timeoutMs ?? 120_000,
      signal: o.signal ?? new AbortController().signal,
      onChunk: (t) => (text += t),
      onSession: () => {},
    });
    if (res.exitCode !== 0 || res.error) throw new Error(res.error ?? `agent exited ${res.exitCode}`);
    return interpret(res.output || text, o, warnings);
  } catch (e) {
    return { text: `I could not answer (${(e as Error).message.split('\n')[0]!.slice(0, 140)}).`, warnings };
  }
}

/** Read the agent's JSON. If it answered in plain prose, that prose is the reply. */
export function interpret(output: string, o: Pick<ChatOpts, 'home' | 'repo' | 'registry'>, warnings: string[] = []): Reply {
  let raw: { command?: unknown; reply?: unknown; intent?: unknown; name?: unknown; steps?: unknown; maxCostUsd?: unknown; task?: unknown; mode?: unknown };
  try {
    raw = extractJson(output) as typeof raw;
  } catch {
    return { text: output.trim().slice(0, 600) || 'I have nothing to say to that.', warnings };
  }
  const text = typeof raw.reply === 'string' && raw.reply.trim() ? raw.reply.trim().slice(0, 600) : 'Done.';
  const cmd = (raw.command ?? undefined) as { command?: unknown; why?: unknown } | undefined;
  const command = cmd && typeof cmd.command === 'string' && cmd.command.trim() ? { command: cmd.command.trim().slice(0, 600), ...(typeof cmd.why === 'string' ? { why: cmd.why.slice(0, 200) } : {}) } : undefined;
  const intent = String(raw.intent ?? 'answer');
  try {
    if (intent === 'save' || intent === 'optimize') {
      const existing = existsSync(join(pipelinesDir(o.home), `${String(raw.name)}.json`)) ? readPipeline(o.home, String(raw.name)) : undefined;
      if (intent === 'optimize' && !existing) throw new Error(`there is no saved workflow called "${String(raw.name)}" to improve`);
      const pipeline = pipelineFromReply(raw, { repo: o.repo, registry: o.registry, base: existing }, warnings);
      if (existing) return { text, warnings, proposal: { kind: 'optimize', pipeline, overwrite: true, before: [STEP_LINE(existing)] } };
      return { text, warnings, proposal: { kind: 'save', pipeline, overwrite: false } };
    }
    if (intent === 'team') {
      const task = typeof raw.task === 'string' ? raw.task.trim() : '';
      if (!task) throw new Error('a team needs a task');
      const mode = raw.mode === 'live' || raw.mode === 'autonomous' ? raw.mode : undefined;
      return { text, warnings, proposal: { kind: 'team', task: task.slice(0, 2000), ...(mode ? { mode } : {}) } };
    }
    if (intent === 'run') {
      const workflow = String(raw.name ?? '');
      if (!NAME_RE.test(workflow) || !existsSync(join(pipelinesDir(o.home), `${workflow}.json`))) throw new Error(`there is no saved workflow called "${workflow}"`);
      const task = typeof raw.task === 'string' ? raw.task.trim() : '';
      if (!task) throw new Error('a run needs a task');
      return { text, warnings, proposal: { kind: 'run', workflow, task: task.slice(0, 2000) } };
    }
  } catch (e) {
    return { text: `${text} (I could not use that: ${(e as Error).message.slice(0, 140)})`, warnings };
  }
  return { text, warnings, ...(command ? { command } : {}) };
}

/** Save a confirmed workflow. An existing file is copied to pipelines/.backup first. Returns the backup path, if any. */
export function savePipeline(home: string, p: Pipeline): string | undefined {
  const file = join(pipelinesDir(home), `${p.name}.json`);
  let backup: string | undefined;
  if (existsSync(file)) {
    const dir = join(pipelinesDir(home), '.backup');
    mkdirSync(dir, { recursive: true });
    backup = join(dir, `${p.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    copyFileSync(file, backup);
  }
  writePipeline(home, p);
  return backup;
}

export type { StepType };
