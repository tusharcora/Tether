import { runProcess } from '../proc.js';
import type { AgentAdapter, AgentRequest, AgentResult } from '../types.js';

export interface CliSpec {
  id: string;
  bin: string;
  versionArgs?: string[];
  /** Command whose stdout lists models, one per line (best effort). */
  modelsArgs?: string[];
  /** How to reopen the agent's interactive session in the run's worktree. */
  attach?(sessionId?: string): { cmd: string; args: string[] } | undefined;
  reportsCost?: boolean;
  supportsResume?: boolean;
  /** How the prompt reaches the CLI. argv prompts are length-capped (OS arg limit). */
  promptVia: 'stdin' | 'argv';
  buildArgs(req: AgentRequest, prompt: string): string[];
  /** Optional parser for structured stdout. Default: stdout is the answer. */
  parse?(stdout: string, onChunk: (t: string) => void): { output: string; costUsd?: number; sessionId?: string } | undefined;
}

const ARGV_PROMPT_MAX = 100_000;

/** Keep the head and tail of an oversized prompt; the middle (older upstream output) goes first. */
export function capPrompt(prompt: string, max = ARGV_PROMPT_MAX): string {
  if (prompt.length <= max) return prompt;
  const keep = Math.floor((max - 80) / 2);
  return `${prompt.slice(0, keep)}\n\n[... ${prompt.length - 2 * keep} characters omitted to fit the CLI argument limit ...]\n\n${prompt.slice(-keep)}`;
}

export async function detectBin(bin: string, versionArgs: string[] = ['--version']) {
  const r = await runProcess({ cmd: bin, args: versionArgs, cwd: process.cwd(), signal: AbortSignal.timeout(8000) });
  if (r.spawnError) return { ok: false, detail: r.spawnError.includes('ENOENT') ? `${bin} not found on PATH` : r.spawnError };
  if (r.code !== 0) return { ok: false, detail: (r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.code}` };
  return { ok: true, version: (r.stdout || r.stderr).trim().split('\n')[0] };
}

export class CliAdapter implements AgentAdapter {
  readonly id: string;
  readonly reportsCost: boolean;
  readonly supportsResume: boolean;
  constructor(private spec: CliSpec) {
    this.id = spec.id;
    this.reportsCost = !!spec.reportsCost;
    this.supportsResume = !!spec.supportsResume;
  }

  detect() {
    return detectBin(this.spec.bin, this.spec.versionArgs);
  }

  attachCommand(sessionId?: string) {
    return this.spec.attach?.(sessionId);
  }

  async listModels(): Promise<string[]> {
    if (!this.spec.modelsArgs) return [];
    const r = await runProcess({ cmd: this.spec.bin, args: this.spec.modelsArgs, cwd: process.cwd(), signal: AbortSignal.timeout(6000) });
    if (r.spawnError || r.code !== 0) return [];
    return r.stdout.split('\n').map((l) => l.trim()).filter((l) => /^[\w.:/-]+$/.test(l)).slice(0, 200);
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    const prompt = this.spec.promptVia === 'argv' ? capPrompt(req.prompt) : req.prompt;
    const args = this.spec.buildArgs(req, prompt);
    const r = await runProcess({
      cmd: this.spec.bin,
      args,
      cwd: req.cwd,
      stdin: this.spec.promptVia === 'stdin' ? prompt : undefined,
      signal: req.signal,
      onStdoutLine: (line) => req.onChunk(line + '\n'),
    });
    if (r.spawnError) return { output: '', exitCode: 127, error: `${this.spec.bin}: ${r.spawnError}` };
    const parsed = this.spec.parse?.(r.stdout, req.onChunk);
    const output = (parsed?.output ?? r.stdout).trim();
    const exitCode = r.aborted ? 130 : (r.code ?? 1);
    return {
      output,
      exitCode,
      costUsd: parsed?.costUsd,
      sessionId: parsed?.sessionId,
      error: exitCode === 0 ? undefined : (r.stderr.trim().slice(-2000) || `${this.spec.bin} exited with ${exitCode}`),
    };
  }
}

// ---- built-in specs for the two CLIs without a structured-output parser yet ----

/**
 * Codex CLI: `codex exec` is the non-interactive entry point; `-` reads the prompt from stdin.
 * NOTE: flags below follow Codex's documented `exec` interface but have NOT been exercised
 * against an installed binary in this build — run `aorch doctor` and override via aorch.config.json
 * if your version differs.
 */
export const codexSpec: CliSpec = {
  id: 'codex',
  bin: 'codex',
  promptVia: 'stdin',
  // Not verified against an installed Codex: reopen the most recent session. Every run has its own worktree,
  // so "most recent in this directory" is the step's session. Override with `attach` in aorch.config.json if your version differs.
  attach: () => ({ cmd: 'codex', args: ['resume', '--last'] }),
  buildArgs: (req) => [
    'exec',
    '--sandbox',
    req.readOnly ? 'read-only' : 'workspace-write',
    ...(req.model ? ['--model', req.model] : []),
    '-',
  ],
};

/** OpenCode: `opencode run <message>`. Same caveat as Codex: not exercised against a live binary here. */
export const opencodeSpec: CliSpec = {
  id: 'opencode',
  bin: 'opencode',
  modelsArgs: ['models'],
  // Not verified against an installed OpenCode: continue the last session in this directory.
  attach: () => ({ cmd: 'opencode', args: ['--continue'] }),
  promptVia: 'argv',
  buildArgs: (req, prompt) => ['run', ...(req.model ? ['--model', req.model] : []), prompt],
};

export interface CustomAdapterConfig {
  command: string;
  /** Arg templates. {prompt} {model} {cwd} are substituted; if {prompt} is absent the prompt goes to stdin. */
  args?: string[];
  versionArgs?: string[];
  /** Reopen a session: args templates with {session}. Omit if the agent has no resumable session. */
  attach?: { args: string[] };
}

export function customSpec(id: string, c: CustomAdapterConfig): CliSpec {
  const args = c.args ?? [];
  const usesArgv = args.some((a) => a.includes('{prompt}'));
  return {
    id,
    bin: c.command,
    versionArgs: c.versionArgs,
    attach: c.attach
      ? (sid) => (c.attach!.args.some((a) => a.includes('{session}')) && !sid ? undefined : { cmd: c.command, args: c.attach!.args.map((a) => a.replaceAll('{session}', sid ?? '')) })
      : undefined,
    promptVia: usesArgv ? 'argv' : 'stdin',
    buildArgs: (req, prompt) =>
      args.map((a) => a.replaceAll('{prompt}', prompt).replaceAll('{model}', req.model ?? '').replaceAll('{cwd}', req.cwd)),
  };
}
