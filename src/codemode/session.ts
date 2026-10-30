/**
 * One step's Code Mode session: its connectors (repo, tether, github, http, mcp.*), the rules they run under, and the
 * `run_code` entry every agent reaches (over MCP for CLI agents, natively in the OpenAI-compatible loop). It counts
 * run_code executions and connector calls for the step's metrics, and collects what the step's answer must carry back to
 * the engine: questions for the person, approvals to ask for, hand-offs.
 */
import { ghExec } from '../accounts/github.js';
import type { Exec } from '../exec.js';
import type { Db } from '../http/history.js';
import type { Store } from '../store.js';
import type { Answer, Question } from '../types.js';
import type { Vault } from '../vault.js';
import { Catalog } from './catalog.js';
import { githubConnector } from './connectors/github.js';
import { httpConnector } from './connectors/http.js';
import { mcpConnector } from './connectors/mcp.js';
import { repoConnector } from './connectors/repo.js';
import { tetherConnector, type Ask } from './connectors/tether.js';
import type { McpServer } from './mcpServers.js';
import { execute, LIMITS, type Limits } from './sandbox.js';
import { spillText, sweepSpills } from './spill.js';
import type { Connector, RunCodeOutput } from './types.js';

export interface SessionInfo {
  home: string;
  runId: string;
  nodeId: string;
  /** The bot's display name (approval questions name it). */
  bot: string;
  workdir: string;
  writable: boolean;
  /** The run's base commit: repo.diff() shows the run's changes since. */
  base?: string;
  kind: 'team' | 'workflow';
  /** Outside-world calls are already approved: an approved approval step comes before this one, or the run auto-approves. */
  approved: boolean;
  /** Calls the person allowed in the Inbox for this step (their descriptions). */
  grants: string[];
  /** The step may hand work to teammates. */
  handoff: boolean;
  /** The workspace whose environments and secrets saved requests use. */
  workspace?: string;
}

export interface SessionDeps {
  store?: Store;
  vault?: Vault;
  /** The HTTP history database: present, the `http` connector is too. */
  db?: Db;
  exec?: Exec;
  mcpServers?: McpServer[];
  onNote?: (text: string) => void;
  limits?: Limits;
  /** More connectors (tests). */
  connectors?: Connector[];
}

/** The Inbox question an outside-world call becomes in a team run. */
export const approvalQuestion = (bot: string, what: string): string => `Allow ${bot} to ${what}?`;

/** The calls the person allowed for a step: its answered approval questions whose answer is Allow. */
export function grantsFrom(asks: { node: string; question: Question; answer?: Answer }[] | undefined, node: string, bot: string): string[] {
  const prefix = `Allow ${bot} to `;
  return (asks ?? [])
    .filter((a) => a.node === node && a.question.ask.startsWith(prefix) && a.question.ask.endsWith('?') && a.question.options.find((o) => o.id === a.answer?.option)?.label === 'Allow')
    .map((a) => a.question.ask.slice(prefix.length, -1));
}

const clean = (s: string) => s.replace(/[|\n\r]+/g, ' ').trim();

export class CodeSession {
  readonly metrics = { runCode: 0, connectorCalls: 0 };
  readonly asks: Ask[] = [];
  readonly approvals: string[] = [];
  readonly hands: { to: string; goal: string; expect?: string }[] = [];
  readonly catalog: Catalog;
  private readonly limits: Limits;

  constructor(
    readonly info: SessionInfo,
    deps: SessionDeps = {},
  ) {
    this.limits = deps.limits ?? LIMITS;
    this.catalog = new Catalog([
      repoConnector({ workdir: info.workdir, writable: info.writable, base: info.base }),
      tetherConnector({
        kind: info.kind,
        handoff: info.handoff,
        writable: info.writable,
        store: deps.store,
        vault: deps.vault,
        hooks: { ask: (a) => this.asks.push(a), hand: (h) => this.hands.push(h), note: (t) => deps.onNote?.(t) },
      }),
      githubConnector(deps.exec ?? ghExec(info.home)),
      ...(deps.db ? [httpConnector({ home: info.home, db: deps.db, workdir: info.workdir, workspace: info.workspace, runId: info.runId })] : []),
      ...(deps.mcpServers ?? []).map((s) => mcpConnector(s)),
      ...(deps.connectors ?? []),
    ]);
  }

  /** The run_code tool's description: what it does, the connectors by name, how to discover methods, the limits. */
  description(): string {
    const l = this.limits;
    return [
      "Run a short JavaScript program in Tether's local sandbox and get back its return value and console.log output.",
      'Write the body of an async function: use await, loops and Promise.all to compose several reads, searches and connector calls in ONE script, and return only what you need.',
      'Connectors (typed async methods, e.g. `await repo.read("src/a.ts", { from: 1, to: 40 })`):',
      this.catalog.summary(),
      'Discover methods: `await codemode.search("pull request comments")` gives [{ name, summary }]; `await codemode.describe("repo")` (a connector) or `codemode.describe("github.pr")` (a method) gives TypeScript signatures.',
      `Limits per run: ${l.wallMs / 1000} s, ${Math.round(l.memoryBytes / 1024 / 1024)} MB, ${l.maxCalls} connector calls, a ${l.maxResultBytes / 1024} KB result. No network, files, process or timers except through connectors.`,
    ].join('\n');
  }

  private allowed(what: string): boolean {
    return this.info.approved || this.info.grants.includes(what);
  }

  /** One host call from the sandbox: discovery, or a connector method under the step's rules. */
  private async call(path: string, args: unknown[]): Promise<unknown> {
    if (path === 'codemode.search') return this.catalog.search(String(args[0] ?? ''), typeof args[1] === 'number' ? args[1] : undefined);
    if (path === 'codemode.describe') return this.catalog.describe(String(args[0] ?? ''));
    const found = await this.catalog.find(path);
    if (!found) throw new Error(`there is no ${path}(); find methods with codemode.search("…") or codemode.describe("<connector>")`);
    const m = found.method;
    this.metrics.connectorCalls++;
    if (m.write && !this.info.writable) throw new Error(`${path} changes files, and this step is read-only`);
    const what = m.outside?.(args);
    if (what && !this.allowed(what)) {
      if (this.info.kind !== 'team') throw new Error(`${path} needs approval ("${what}"): in a workflow it comes from an approval step before this one, or a run started with auto-approve`);
      if (!this.approvals.includes(what)) this.approvals.push(what);
      throw new Error(`${path} needs the person's approval ("${what}"). It is now in their Inbox: finish your answer, and this step runs again once they decide`);
    }
    return m.run(args);
  }

  /** Run one script; a result (return value, then logs) over the limit is spilled to a file the model can read, else cut with a note. */
  async runCode(code: string): Promise<RunCodeOutput> {
    if (typeof code !== 'string' || !code.trim()) return { text: 'run_code needs a script in "code".', isError: true };
    this.metrics.runCode++;
    const roots = [...new Set(this.catalog.connectors.map((c) => c.name.split('.')[0]!))];
    const r = await execute(code, roots, (path, args) => this.call(path, args), this.limits);
    const parts: string[] = [];
    if (r.error) parts.push(/^\w*Error\b/.test(r.error) ? r.error : `Error: ${r.error}`);
    else parts.push(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 1));
    if (r.logs.length) parts.push(`console:\n${r.logs.join('\n')}`);
    if (this.asks.length || this.approvals.length) parts.push('(The person has been asked: end your answer now; this step runs again with their decision.)');
    let text = parts.join('\n\n');
    const max = this.limits.maxResultBytes;
    if (text.length > max) text = (await spillText(this.info.workdir, text, max)) ?? `${text.slice(0, max)}\n[... cut: ${text.length - max} more characters. Return less: filter, slice or summarise inside the script.]`;
    return { text, isError: !!r.error };
  }

  /** What the step's answer gains so the engine acts on it: `@ASK user:` lines (questions, approvals) and `@HAND` lines. */
  followUps(): string {
    const asks = this.asks.map((a) => `@ASK user: ${clean(a.question)}${a.options?.length ? ` | options: ${a.options.map(clean).join('; ')}` : ''}${a.recommended ? ` | recommended: ${clean(a.recommended)}` : ''}${a.why ? ` | why: ${clean(a.why)}` : ''}`);
    const approvals = this.approvals.map((w) => `@ASK user: ${clean(approvalQuestion(this.info.bot, w))} | options: Allow; Deny | recommended: Deny | why: a Code Mode call that changes something outside the repository`);
    const hands = this.hands.map((h) => `@HAND ${h.to}: ${clean(h.goal)}${h.expect ? ` | expect: ${clean(h.expect)}` : ''}`);
    return [...asks, ...approvals, ...hands].join('\n');
  }

  async close(): Promise<void> {
    await this.catalog.close();
    await sweepSpills(this.info.workdir);
  }
}
