#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { installExamples, loadConfig, resolveHome, writePipeline, makeRegistry, readPipeline, listPipelines, type Config } from './config.js';
import { loadPipelineFile, preflight } from './pipeline.js';
import { openContext, serveTether, type Ctx } from './serve.js';
import type { Store } from './store.js';
import { httpCommand } from './http/cli.js';
import type { Answer, Pipeline, Question, RunState, StoredEvent } from './types.js';
import { answerFromInput, parseTeamArgs } from './team.js';
import { Vault } from './vault.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const examplesDir = resolve(here, '../examples/pipelines');
const webDir = resolve(here, '../web/dist');

import { link, loadBindings, unlink } from './bindings.js';
import { runTui } from './tui.js';
import { compose, DEFAULT_PROBE_TASKS, getProposal, listProposals, MAX_PROBE_TASKS, probe, proposeFor, renderProbe, renderProposal, saveProbe } from './evolve.js';
import { baselinePersona, currentHarness, diffHarness, getVersion, listVersions, peekHarness, readChangelog, type HarnessEdit } from './harness.js';
import { adopt, decline, EvolveOpError, findBot, harnessView, keptOf, loadProposal, proposalsFor, proposalView, revert, scrubPaths, versionArg, type ProposalView } from './evolveops.js';
import { loadLessons, type Lesson } from './lessons.js';
import { composePipeline, detectTestCommand, diagnoseFailure } from './composer.js';
import { aorchSkills, claudeSkillPipeline, claudeSkills, eccSkillPipeline, eccSkills, findSkill, skillPipeline } from './skills.js';
import { supervise } from './supervisor.js';
import { refreshCrew } from './bots.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { loadCrew, saveBot, removeBot, freshId, sanitizeBot, toFile, BOT_KINDS, LOOK_PARTS, PART_KEYS, BUILTIN_IDS, type BotDef } from './crew.js';
import { PACKS, findPack, parseBots, reid } from './packs.js';
import { applyEcc, discardEcc, eccInfo, gitFetch, prepareEcc, removeEcc, type Prepared } from './eccImport.js';
import { createInterface } from 'node:readline/promises';
import { ago as agoRel, refusal, reportOnce, ensureWebhookSecret, checkRuleRefs, checkWorkflow, dryRunVerdict, planRuleAdd, classifyFailure, ensureIds, explainMatch, findRule, formatTriggerLine, lastDelivery, parsePrTarget, parseRuleArgs, readDeliveries, recordDelivery, statusText, triggerStatus } from './triggers.js';
import { ghExec } from './accounts/github.js';
import { DEFAULT_EVENTS, alreadyRan, fetchPr, loadSettings, matchRule, parsePr, pipelineFor, saveSettings, startPrRun, type Rule } from './pr.js';
import { fetchUsage, spendNano, supportsUsage, usd as usdOf } from './usage.js';
import { PRESETS, updateEndpoint, addEndpoint, baseUrlOf, keyRef, providerName, listProviders, removeEndpoint } from './providers.js';
import { applyBundle, bundleFileName, exportWorkspace, parseBundle, planBundleImport, writeBundle, type Bundle } from './wsexport.js';
import { SURVEY_PROMPT, addToList, contextOf, getWorkspace, initWorkspace, listWorkspaces, removeWorkspace, resolveWorkspace, setDefaultWorkspace, updateMeta, writeNotes } from './workspace.js';
import { normalizePipeline } from './pipeline.js';
import { CREW, crewFor } from './bots.js';
import { THEMES, registerThemes, setTheme, themeName, spawnedLabel, underManagers } from './ui.js';
import { LiveBoard, renderQuestion, safeText, ago, amber, banner, bold, box, caps, clock, cyan, dim, dur, faint, glyph, gradient, green, meter, pal, paint, red, resultCard, table, typeLine, usd, vlen, BRAND } from './ui.js';

const yellow = amber;
/** --workspace <id> picks one; --no-workspace runs without project context. */
const wsOpt = (v: { workspace?: string; 'no-workspace'?: boolean }): string | false | undefined => (v['no-workspace'] ? false : v.workspace);
const padEndV = (x: string, w: number) => x + ' '.repeat(Math.max(0, w - vlen(x)));
const s0 = (t: string) => bold(t.split('\n')[0]!.slice(0, 90));

const HELP = `tether — durable orchestrator for CLI coding agents (aorch still works: same command)

Usage
  tether run <pipeline> --repo <dir> --task "<text>" [--auto-approve] [--ref <git-ref>] [--no-endpoints]
  tether run ... [--supervise [--rounds 2]]   Maestro retries, then escalates the failing step to a stronger model
  tether resume <runId> [--retry-failed]
  tether approve <runId> <node> [--reject] [--resume]
  tether feedback <runId> <node> up|down [note…]   thumbs up or down on a step's output (Evolve learns from it)
  tether evolve <bot> [--since <date>] [--agent a] [--model m] [--json]   propose edits to a bot's harness from its confident lessons (nothing is applied)
  tether evolve <bot> --probe --budget <usd> [--tasks n] [--proposal id] [--allow-commands] [--json]   replay up to n (default 3, max 8) recent read-only runs with the current harness and each proposed edit; spend capped by --budget
  tether evolve --accept <id> [--pick 1,3 | --pick kept]   accept a proposal (all edits, or the ones you pick) as the bot's next harness version
  tether evolve --reject <id>          reject a proposal; its edits are never proposed again
  tether evolve <bot> --list | --show <id>   a bot's proposals (open, accepted, rejected, superseded) · one proposal with its diff, evidence and probe results
  tether harness <bot> [show | log | diff <a> <b> | rollback <v>] [--json]   a bot's harness: current version, history, what changed, roll back (as a new version)
  tether probes [--clean]              Evolve probe replays (hidden from runs lists); --clean deletes the finished ones
  tether lessons [bot] [--json]        what the bots learned from runs: status, runs, provenance
  tether                               interactive dashboard (runs, workflows, agent sessions)
  tether orchestrate "<task>" --repo <dir> [--yes]   Maestro designs a workflow for the task and runs it
  tether team "<goal>" --repo <dir> [--mode live|autonomous] [--roster a,b] [--budget $] [--rounds n] [--yes] [--no-endpoints]   Maestro asks questions, you approve a plan, a team of bots does it
  tether answer <runId> <question> <option|"text">   answer a pending question (plan dialogue or a bot's question); option is a number or an id
  tether plan <runId> [--reject]       approve (or reject) a team run's finished plan
  tether mode <runId> live|autonomous  live asks you; autonomous lets Maestro answer for you
  tether bots [link <bot> <agent> [model] | unlink <bot>]   link crew members to Claude, Codex, OpenCode or a local model
  tether crew list [--source ecc]                                      bots with where they came from
  tether crew import ecc [--ref v2.2.3] [--from <dir>] [--update]      add ECC's agents, skills and commands (github.com/affaan-m/ECC)
  tether crew remove --source ecc                                      remove everything imported from ECC
  tether pr <link> [--workflow full-review] [--comment]               run a workflow on a GitHub PR (also: pr rules | rule add | watch | secret | map)
  tether triggers [list|add|enable|disable|remove|show|log|test|setup]   PR triggers: which PRs start which workflow, where, with which agent (add <owner/repo|*> --workflow w [--workspace id] [--agent a] [--model m] [--events …] [--labels …] [--comment] [--drafts] [--forks] [--id name] · log [id] [--limit n] · test <id> <pr> [--fire] · setup)
  tether skills [--source ecc|claude|aorch] [run <name> --task "…"]    list or run skills (Claude Code skills, aorch workflows, ECC skills and commands; ecc:<name> picks the ECC one)
  tether http ls | run <id> [--env e] | send <METHOD> <url> [-H k:v] [-d body] | import <file|-> --kind curl|openapi|postman | env ls|use|none | secret set|rm|ls   saved API requests (.aorch/http); exit 1 = a check failed, 2 = network error
  tether workspace export [id] [--out f] [--with-secrets] | import <file> [--into dir] [--yes]   move a workspace (notes, saved requests, optionally secrets) as one JSON file
  tether models [agent]                list what each agent can run (local servers included)
  tether usage [provider] [--days 7]   spend and tokens from a provider's Spend API (Experiential Labs)
  tether providers [list|add|remove]   LLM providers: see what is set up, add DeepSeek / OpenRouter / your own server
  tether theme [name]                  aurora · sunset · matrix · amber · mono
  tether runs [--all]                  list runs (--all includes Evolve probe replays)
  tether delete <runId>…               delete runs, their worktrees and chats (--keep-work keeps branch + files; 'all --finished' clears done/failed runs)
  tether show <runId>                  node table, cost, coach findings
  tether serve [--port 4177]           API + dashboard (loopback only)
  tether doctor                        which agent CLIs are installed (and which take Code Mode)
  tether codemode-mcp --session <file> the Code Mode MCP server (run_code) an agent CLI starts for one step
  tether init                          install example pipelines
  tether pipelines                     list saved pipelines
  tether vault search "<query>"        query the knowledge graph
  tether vault stats

<pipeline> is a saved name or a path to a .json/.yaml file.
Global flags: --home <dir> (default ~/.aorch, or $TETHER_HOME, then $AORCH_HOME)  --vault <dir> (default <home>/vault, or $AORCH_VAULT)
Exit codes: 0 done · 1 error/stopped · 2 paused (waiting for approval)`;

function prettyHelp(): string {
  return HELP.split('\n')
    .slice(1)
    .map((l) => {
      if (/^(Usage|Global flags|Exit codes)/.test(l)) return l.replace(/^(\w[\w ]*?)(:|$)/, (m) => bold(gradient(m, BRAND)));
      const m = l.match(/^(  tether \S+(?: \S+)?)(.*)$/);
      if (m) return `${cyan(m[1]!)}${m[2]!.replace(/(<[^>]+>)/g, (x) => paint(pal.violet, x)).replace(/(--[\w-]+)/g, (x) => amber(x)).replace(/(\s{2,}[A-Za-z].*)$/, (x) => dim(x))}`;
      return dim(l);
    })
    .join('\n');
}

function applyTheme(flag?: string) {
  const prefs = loadPrefs(resolveHome());
  registerThemes(prefs.themes);
  const name = flag ?? process.env.AORCH_THEME ?? prefs.theme;
  if (name && !setTheme(name)) {
    console.error(`unknown theme "${name}" — options: ${Object.keys(THEMES).join(', ')}`);
    process.exit(1);
  }
}

/** What a trigger points at, for validation: workspaces, agents and workflows that exist. */
function ruleRefs(cfg: Config) {
  const registry = makeRegistry(cfg);
  return {
    hasWorkspace: (id: string) => !!getWorkspace(cfg.home, id),
    workspaceRepos: (id: string) => getWorkspace(cfg.home, id)?.repos,
    hasAgent: (id: string) => registry.has(id),
    checkWorkflow: (r: Rule) => checkWorkflow(cfg.home, r),
  };
}

function fail(msg: string, code = 1): never {
  console.error(`${red('✘ error')} ${msg}`);
  process.exit(code);
}

const statusGlyph = (st: string) => glyph(st);

const open = openContext;

/** Print one line per meaningful event while a run executes in this process. */
function narrate(store: Store, runId: string, json: boolean): { off: () => void; stop: () => void; start: () => void } {
  const pipeNodes = () => store.state(runId)?.pipeline.nodes ?? [];
  const name = (id: string) => {
    const n = pipeNodes().find((x) => x.id === id);
    return n ? `${bold(n.title ?? n.role ?? n.kind)} ${faint(`(${id})`)}` : id;
  };
  const live = !json && caps.animate ? new LiveBoard(() => store.state(runId)) : undefined;
  const say = (line: string) => (live ? live.log(line) : console.log(line));
  const ts = () => faint(clock());
  live?.start();

  const off = store.onAppend((se: StoredEvent) => {
    if (se.runId !== runId) return;
    const e = se.event;
    if (json) {
      if (e.type !== 'node.chunk') console.log(JSON.stringify(se));
      return;
    }
    switch (e.type) {
      case 'setup.result':
        say(`${ts()}  ${e.ok ? green('✔') : red('✘')} ${dim('setup')} ${faint(dur(e.durationMs))}`);
        break;
      case 'node.started':
        say(`${ts()}  ${cyan('▸')} ${name(e.node)}${e.attempt > 1 ? amber(`  attempt ${e.attempt}`) : ''}`);
        break;
      case 'node.finished': {
        const ok = e.status === 'done' && e.verdict !== 'FAIL';
        const extra = [e.verdict ? (e.verdict === 'PASS' ? green('PASS') : red('FAIL')) : '', e.costUsd ? usd(e.costUsd) : '', dur(e.durationMs), e.commit ? `commit ${cyan(e.commit.slice(0, 7))}` : '']
          .filter(Boolean)
          .join(dim(' · '));
        say(`${ts()}  ${ok ? green('✔') : red('✘')} ${name(e.node)}  ${extra}${e.error ? `\n${' '.repeat(12)}${red(e.error.split('\n')[0]!.slice(0, 160))}` : ''}`);
        break;
      }
      case 'gate.result':
        say(
          `${ts()}  ${e.ok ? green('✔ gate passed') : red(`✘ gate failed`) + dim(` exit ${e.exitCode}`)} ${faint(`· ${name(e.node)}`)}${
            e.ok || !e.output.trim() ? '' : '\n' + e.output.split('\n').filter((l) => l.trim()).slice(-6).map((l) => `${' '.repeat(12)}${red('┃')} ${dim(l)}`).join('\n')
          }`,
        );
        break;
      case 'loop':
        say(`${ts()}  ${amber('↻')} ${amber(`fix loop ${e.n}`)} ${faint('·')} ${name(e.check)} ${amber('→')} ${name(e.fixNode)}`);
        break;
      case 'consult':
        say(`${ts()}  ${paint(pal.cyan, '?')} ${name(e.from)} ${dim('asks')} ${name(e.to)}${dim(':')} ${e.question.replace(/\s+/g, ' ').slice(0, 110)}\n${' '.repeat(12)}${dim('↳')} ${dim(e.answer.replace(/\s+/g, ' ').slice(0, 140))}`);
        break;
      case 'handoff':
        say(`${ts()}  ${paint(pal.cyan, '⇢')} ${name(e.from)} ${dim('→')} ${name(e.to)}${dim(':')} ${e.goal.replace(/\s+/g, ' ').slice(0, 110)}\n${' '.repeat(12)}${dim('↳')} ${dim(e.answer.startsWith('refused: ') ? e.answer.slice(0, 140) : `${name(e.to)} answered`)}`);
        break;
      case 'node.skipped':
        say(`${ts()}  ${dim('◌')} ${name(e.node)} ${dim(`skipped: ${e.reason}`)}`);
        break;
      case 'node.spawned':
        say(`${ts()}  ${cyan('↳')} ${name(e.parent)} ${dim('hands')} ${name(e.node.id)} ${dim(e.node.kind === 'approval' ? 'plan approval' : `to ${e.node.role ?? 'agent'}: ${(e.node.spawn?.contract.goal ?? '').replace(/\s+/g, ' ').slice(0, 100)}`)}`);
        break;
      case 'node.requeued':
        say(`${ts()}  ${amber('↺')} ${name(e.node)} ${dim(`queued again: ${e.reason}`)}`);
        break;
      case 'manager.cost':
        break;
      case 'approval.requested':
        say(`${ts()}  ${amber('◉')} ${name(e.node)} ${amber('waiting for approval')}`);
        break;
      case 'node.amended':
        say(e.guidance ? `${ts()}  ${amber('✎')} ${name(e.node)} ${dim('guidance added: ' + e.guidance.split('\n').pop()!.slice(0, 80))}` : `${ts()}  ${amber('⇄')} ${name(e.node)} ${dim('now runs on')} ${cyan(e.agent ?? '')}${e.model ? dim(' · ' + e.model) : ''}`);
        break;
      case 'supervisor.action':
        say(`${ts()}  ${paint(pal.violet, '◈')} ${bold(paint(pal.violet, 'Maestro'))} ${e.action === 'stop' ? amber('stops: ') : cyan(e.action + ': ')}${e.detail}`);
        break;
      case 'approval.resolved':
        say(`${ts()}  ${e.approved ? green('✔') : red('✘')} ${name(e.node)} ${e.approved ? green('approved') : red('rejected')}${e.by ? dim(` by ${e.by}`) : ''}`);
        break;
    }
  });
  return { off, stop: () => live?.stop(), start: () => live?.start() };
}

function summary(s: RunState) {
  const extra: string[] = [];
  if (s.coach?.length) {
    extra.push('', `${amber('◆')} ${bold('coach')}`);
    for (const f of s.coach) extra.push(`  ${amber('•')} ${bold(f.title)}`, `    ${f.detail}`, `    ${dim('→ ' + f.action)}`);
  }
  if (s.status === 'paused' && s.kind === 'team' && s.pending.length) {
    extra.push('', `${amber('◉')} waiting for your answer${s.pending.length > 1 ? 's' : ''}: ${bold(s.pending.map((q) => q.id).join(', '))}`, `  ${dim('$')} ${cyan(`aorch answer ${s.id} ${s.pending[0]!.id} <option>`)}`);
  } else if (s.status === 'paused') {
    const waiting = Object.entries(s.nodes).filter(([, n]) => n.status === 'awaiting').map(([id]) => id);
    extra.push('', `${amber('◉')} waiting for approval: ${bold(waiting.join(', '))}`, `  ${dim('$')} ${cyan(`aorch approve ${s.id} ${waiting[0]} --resume`)}`);
  } else if (s.status === 'stopped' || s.status === 'error') {
    extra.push('', `${dim('$')} ${cyan(`aorch resume ${s.id}`)}${s.status === 'error' ? dim('   re-runs only the failed branch') : ''}`);
  }
  console.log('');
  console.log(resultCard(s, extra).join('\n'));
}

/** Wait for the run; a team run that stops to ask the person is answered in the terminal and carries on. */
async function waitTeam(ctx: Ctx, runId: string, view: { stop: () => void; start: () => void }, json: boolean): Promise<RunState> {
  for (;;) {
    const s = await ctx.engine.wait(runId);
    if (s.kind !== 'team' || s.status !== 'paused' || !s.pending.length || json || !canAsk()) return s;
    view.stop();
    try {
      await ctx.engine.answerUsers(runId, (await askCards(s.pending)).map((a) => ({ question: a.question, option: a.option, text: a.text })));
    } catch (e) {
      console.error(`${red('✘')} ${(e as Error).message}`);
      return ctx.store.state(runId) ?? s;
    }
    view.start();
  }
}

const exitFor = (s: RunState) => (s.status === 'done' ? 0 : s.status === 'paused' ? 2 : 1);

const canAsk = () => !!(process.stdin.isTTY && process.stdout.isTTY);

/** Ask each card in the terminal: a number picks, enter takes the recommendation, other text is the person's own words (if the card allows). */
async function askCards(cards: Question[]): Promise<Answer[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise<undefined>((r) => rl.once('close', () => r(undefined)));
  try {
    const out: Answer[] = [];
    for (const q of cards) {
      console.log('');
      console.log(renderQuestion(q, Math.min(caps.cols, process.stdout.columns || 80)).join('\n'));
      for (;;) {
        const line = await Promise.race([rl.question(`${dim('›')} `), closed]);
        if (line === undefined) throw new Error('input closed before every question was answered');
        try {
          out.push(answerFromInput(q, line));
          break;
        } catch (e) {
          console.log(`  ${amber('!')} ${(e as Error).message}`);
        }
      }
    }
    return out;
  } finally {
    rl.close();
  }
}

async function confirm(text: string, o: { defaultNo?: boolean } = {}): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await Promise.race([rl.question(`${text} ${dim(o.defaultNo ? '[y/N]' : '[Y/n]')} `), new Promise<string>((r) => rl.once('close', () => r('n')))])).trim().toLowerCase();
    return (a === '' && !o.defaultNo) || a === 'y' || a === 'yes';
  } finally {
    rl.close();
  }
}

function showPlan(s: RunState) {
  const p = s.plan;
  if (!p) return;
  const lines = [bold(safeText(p.goal)), ''];
  if (p.success.length) lines.push(dim('done when'), ...p.success.map((x) => `  ${green('✔')} ${safeText(x)}`), '');
  lines.push(dim('team'), ...p.assignments.map((a) => `  ${cyan(a.bot)} ${a.mode === 'write' ? amber('writes') : dim('reads')}  ${safeText(a.goal)}${a.why ? dim(` — why: ${safeText(a.why)}`) : ''}`), '');
  // the cap covers the whole run, planning included: show what planning spent and what is left for the team
  const cap = p.limits.maxCostUsd;
  const spend = cap !== undefined ? `up to ${usd(cap)} in all${s.costUsd > 0 ? ` (planning spent ${usd(s.costUsd)}, ${usd(Math.max(0, cap - s.costUsd))} left)` : ''}` : 'no spend cap';
  lines.push(dim('limits'), `  ${spend}${p.limits.wallClockMs ? ` · ${dur(p.limits.wallClockMs)}` : ''} · ${p.limits.allowWrites ? amber('files may be changed') : 'read-only'}`);
  console.log('');
  console.log(box(lines, { title: 'plan', width: Math.min(caps.cols + 10, process.stdout.columns || 100), border: BRAND }).join('\n'));
}

/** Answer planning cards until Maestro has a plan (interactive), or stop at the first unanswered card. */
async function planDialogue(ctx: Ctx, id: string, interactive: boolean): Promise<RunState> {
  for (let i = 0; i < 30; i++) {
    const s = ctx.store.state(id)!;
    if (!s.planning || s.status !== 'running') return s;
    if (!s.pending.length) {
      await ctx.engine.continuePlanning(id);
      continue;
    }
    if (!interactive) return s;
    await ctx.engine.answerPlan(id, await askCards(s.pending));
  }
  return ctx.store.state(id)!;
}

async function drive(ctx: Ctx, runId: string, json: boolean, sup?: { rounds: number }, after?: (s: RunState) => Promise<void>): Promise<never> {
  const view = narrate(ctx.store, runId, json);
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error(yellow('\nstopping… (Ctrl-C again to force quit; the run stays resumable)'));
    ctx.engine.stop(runId);
  });
  const bind = loadBindings(ctx.cfg.home);
  const s = sup
    ? await supervise(ctx.engine, runId, {
        maxRounds: sup.rounds,
        escalate: bind.escalate,
        diagnose: (st) => diagnoseFailure(st, { registry: makeRegistry(ctx.cfg), agent: bind.orchestrator?.agent, model: bind.orchestrator?.model }),
      })
    : await waitTeam(ctx, runId, view, json);
  view.off();
  view.stop();
  if (after) await after(s);
  if (!json) summary(s);
  else console.log(JSON.stringify({ id: s.id, status: s.status, costUsd: s.costUsd, error: s.error }));
  process.exit(exitFor(s));
}

/** `aorch evolve <bot> --probe --budget <usd> [--tasks n] [--proposal id] [--json]`: probe a proposal (the newest open one, or a fresh one) and compose it. */
async function evolveProbe(botId: string, v: { budget?: string; tasks?: string; proposal?: string; json?: boolean; 'allow-commands'?: boolean; home?: string; vault?: string; agent?: string; model?: string; since?: string }): Promise<void> {
  if (v.budget === undefined) return fail('--probe needs --budget <usd>: a probe replays runs and spends money', 2);
  const budget = Number(v.budget);
  if (!/^\s*(\d+(\.\d*)?|\.\d+)\s*$/.test(v.budget) || !(budget > 0)) return fail('--budget must be a positive amount in USD written as a plain decimal, e.g. 2, 0.5 or .5 (no exponents)', 2);
  let tasks = DEFAULT_PROBE_TASKS;
  if (v.tasks !== undefined) {
    if (!/^\d{1,2}$/.test(v.tasks.trim()) || Number(v.tasks) < 1 || Number(v.tasks) > MAX_PROBE_TASKS) return fail(`--tasks must be 1 to ${MAX_PROBE_TASKS}`, 2);
    tasks = Number(v.tasks);
  }
  const ctx = open(v);
  const home = ctx.cfg.home;
  const bot = loadCrew(home).find((b) => b.id === botId) ?? fail(`no such bot: ${safeText(botId).slice(0, 40)}`);
  let editorCostUsd: number | undefined;
  let p;
  try {
    if (v.proposal) {
      p = getProposal(home, v.proposal);
      if (p.bot !== bot.id) return fail(`proposal ${safeText(p.id)} is for ${p.bot}, not ${bot.id}`);
    } else {
      const cur = currentHarness(home, bot).version;
      p = listProposals(home, bot.id, 'open').filter((x) => x.base === cur).at(-1);
    }
  } catch (e) {
    return fail(safeText(scrubPaths((e as Error).message, home)));
  }
  if (!p) {
    const r = await proposeFor({ home, bot, registry: makeRegistry(ctx.cfg), agent: v.agent, model: v.model, since: v.since });
    editorCostUsd = r.costUsd;
    if (!r.proposal) {
      if (v.json) return void console.log(JSON.stringify({ reason: r.reason ?? 'no proposal', ...(editorCostUsd !== undefined ? { editorCostUsd } : {}) }));
      console.log(`${dim('no proposal to probe:')} ${safeText(r.reason ?? 'unknown')}`);
      return;
    }
    p = r.proposal;
  }
  const ac = new AbortController();
  const onInt = () => ac.abort();
  process.once('SIGINT', onInt);
  let out;
  try {
    out = await probe({ home, bot, proposal: p, budgetUsd: budget, tasks, engine: ctx.engine, signal: ac.signal, allowCommands: v['allow-commands'] === true });
  } catch (e) {
    return fail(safeText(scrubPaths((e as Error).message, home)));
  } finally {
    process.off('SIGINT', onInt);
  }
  if (out.results.length || out.spentUsd > 0) {
    try {
      saveProbe(home, p.id, { ...out, budgetUsd: budget });
    } catch {
      /* the outcome is still printed */
    }
  }
  const composed = compose(p, out.results);
  // there is no cheap judge to wire in yet: say what the comparison rests on
  const judgeNote = 'no judge: steps without gates or reviewer checks are compared on failures, redos and cost only';
  const cmdNote = v['allow-commands']
    ? 'replays re-run the original runs\' gate and setup commands (in a throwaway clone)'
    : 'runs with gate or setup commands were skipped: pass --allow-commands to replay them (their commands re-run in a throwaway clone)';
  if (v.json) return void console.log(JSON.stringify({ proposal: p.id, ...out, budgetUsd: budget, composed, judge: 'none', ...(editorCostUsd !== undefined ? { editorCostUsd, editorCostOutsideBudget: true } : {}) }));
  for (const line of renderProbe(p, { ...out, budgetUsd: budget }, composed, baselinePersona(home, bot))) console.log(line.startsWith('-') ? red(line) : line.startsWith('+') ? green(line) : line);
  console.log(dim(judgeNote));
  console.log(dim(cmdNote));
  if (editorCostUsd !== undefined) console.log(dim(`editor cost ${usd(editorCostUsd)} (outside --budget: the probe budget covers replays only)`));
}

function printEdit(e: HarnessEdit, prefix = '  ') {
  console.log(`${prefix}${dim(`${e.field} ${e.op}`)}`);
  if (e.before !== undefined) console.log(red(`${prefix}-   ${safeText(e.before)}`));
  if (e.after !== undefined) console.log(green(`${prefix}+   ${safeText(e.after)}`));
}

const labelColour = (pv: ProposalView) => (pv.label === 'open' ? (pv.stale ? amber : green) : pv.label === 'accepted' ? cyan : dim);

/** One proposal for the terminal: status (superseded shown apart from rejected), the diff, cited lessons and the saved probe. */
function printProposal(pv: ProposalView) {
  console.log(`${bold(pv.id)} ${labelColour(pv)(pv.label === 'open' && pv.stale ? 'open (stale)' : pv.label)}${pv.note ? dim(` · ${safeText(pv.note)}`) : ''} ${dim(`· based on v${pv.base}${pv.version !== undefined ? ` · made v${pv.version}` : ''}${pv.picked ? ` · picked ${pv.picked.join(',')}` : ''}`)}`);
  if (pv.stale) console.log(amber(`  written for v${pv.base}; the harness has moved on, so it cannot be accepted: run aorch evolve ${pv.bot} again`));
  for (const e of pv.edits) {
    const tag = e.probe === 'dropped' ? red(' (dropped by the probe)') : e.probe === 'unprobed' ? amber(` (kept, not probed${e.probeNote ? `: ${safeText(e.probeNote)}` : ''})`) : e.probe === 'kept' ? green(' (kept by the probe)') : '';
    console.log(`${e.n}. ${e.roleNote ? `role note ${dim(`(added to the bot's role prompt; ${e.before !== undefined ? 'replaces the earlier role note' : 'nothing is removed'})`)}` : `${e.field} ${e.op}`}${tag}`);
    if (e.before !== undefined) console.log(red(`-   ${safeText(e.before)}`));
    if (e.after !== undefined) console.log(green(`+   ${safeText(e.after)}`));
    for (const l of e.lessons) console.log(dim(`   because ${safeText(l.id)}${l.text !== undefined ? ` (${l.polarity}, ${l.runs} runs, ${l.provenance}): ${safeText(l.text)}` : ''}`));
  }
  if (pv.probe) {
    console.log(`${bold('probe')} ${dim(`spent $${pv.probe.spentUsd.toFixed(4)} of $${pv.probe.budgetUsd.toFixed(2)}${pv.probe.stoppedBy ? ` · stopped by ${pv.probe.stoppedBy}` : ''}`)}`);
    for (const r of pv.probe.results) console.log(`  ${r.verdict.padEnd(6)} edit ${r.edit ?? 'all'} on "${safeText(r.task).slice(0, 60)}"  ${dim(`baseline: ${r.baseline}; candidate: ${r.candidate}`)}`);
    if (pv.composed) console.log(dim(`  kept ${pv.composed.kept.join(',') || 'none'} · dropped ${pv.composed.dropped.join(',') || 'none'} · not probed ${pv.composed.unprobed.join(',') || 'none'}`));
  }
  if (pv.label === 'open' && !pv.stale) console.log(dim(`accept: aorch evolve --accept ${pv.id} [--pick 1,3${pv.composed ? ' | --pick kept' : ''}]   reject: aorch evolve --reject ${pv.id}`));
}

/** `aorch evolve <bot> --list`. */
function evolveList(botId: string, v: { json?: boolean; home?: string; vault?: string }) {
  const cfg = loadConfig(v);
  try {
    const bot = findBot(cfg.home, botId);
    const cur = peekHarness(cfg.home, bot).version;
    const lessons = loadLessons(cfg.home, bot.id);
    const views = proposalsFor(cfg.home, bot.id, 20).map((p) => proposalView(cfg.home, p, lessons, cur));
    if (v.json) return void console.log(JSON.stringify({ bot: bot.id, version: cur, proposals: views }));
    if (!views.length) return void console.log(dim(`no proposals for ${bot.id}: aorch evolve ${bot.id} makes one (one model call)`));
    console.log(dim(`${bot.id} harness v${cur}`));
    for (const pv of views) console.log(`${labelColour(pv)((pv.label === 'open' && pv.stale ? 'open (stale)' : pv.label).padEnd(12))} ${cyan(pv.id)} ${dim(`${pv.edits.length} edit${pv.edits.length === 1 ? '' : 's'} · based on v${pv.base} · ${pv.createdAt.slice(0, 16)}${pv.probe ? ' · probed' : ''}${pv.note ? ` · ${safeText(pv.note)}` : ''}`)}`);
  } catch (e) {
    fail(safeText(scrubPaths((e as Error).message, cfg.home)));
  }
}

/** `aorch evolve --accept <id> [--pick 1,3|kept]`, `--reject <id>`, `--show <id>`. Accept and reject never call a model. */
async function evolveDecide(v: { accept?: string; reject?: boolean; show?: string; pick?: string; json?: boolean; home?: string; vault?: string }, pos: string[]) {
  const n = [v.accept !== undefined, !!v.reject, v.show !== undefined].filter(Boolean).length;
  if (n > 1) return fail('use one of --accept <id>, --reject <id> or --show <id>', 2);
  const id = v.accept ?? v.show ?? pos[0];
  if (!id) return fail('usage: aorch evolve --reject <id>', 2);
  if (v.pick !== undefined && v.accept === undefined) return fail('--pick goes with --accept', 2);
  const cfg = loadConfig(v);
  const lessonsOf = (bot: string) => {
    try {
      return loadLessons(cfg.home, bot);
    } catch {
      return [];
    }
  };
  try {
    if (v.show !== undefined) {
      const p = loadProposal(cfg.home, id);
      const pv = proposalView(cfg.home, p, lessonsOf(p.bot));
      if (v.json) return void console.log(JSON.stringify({ proposal: pv }));
      return printProposal(pv);
    }
    if (v.reject) {
      const p = decline(cfg.home, id);
      if (v.json) return void console.log(JSON.stringify({ proposal: proposalView(cfg.home, p, []) }));
      return void console.log(`${red('rejected')} ${id}: its ${p.edits.length} edit${p.edits.length === 1 ? '' : 's'} will not be proposed again`);
    }
    // never pick for the person: when the saved probe dropped an edit, accepting "all" needs to be said out loud
    const p = loadProposal(cfg.home, id);
    const c = keptOf(p);
    if (v.pick === undefined && c?.dropped.length) {
      return fail(`the probe dropped edit${c.dropped.length > 1 ? 's' : ''} ${c.dropped.map((i) => i + 1).join(',')} of ${id}: say which edits to accept with --pick (--pick kept takes ${c.kept.map((i) => i + 1).join(',') || 'none'}; --pick ${p.edits.map((_, i) => i + 1).join(',')} takes them all). See them with aorch evolve --show ${id}`, 2);
    }
    const r = await adopt(cfg.home, id, v.pick, new Vault(cfg.vault));
    if (v.json) return void console.log(JSON.stringify({ harness: r.harness, proposal: proposalView(cfg.home, r.proposal, lessonsOf(r.proposal.bot), r.harness.version) }));
    const picked = (r.proposal.picked ?? p.edits.map((_, i) => i)).map((i) => i + 1);
    console.log(`${green('accepted')} ${id}: ${r.proposal.bot} harness is now v${r.harness.version} (edit${picked.length === 1 ? '' : 's'} ${picked.join(',')} of ${p.edits.length}); the next run uses it`);
    console.log(dim(`undo: aorch harness ${r.proposal.bot} rollback ${p.base}${r.vaultNote ? ` · noted in the vault: ${r.vaultNote}` : ''}`));
  } catch (e) {
    const code = e instanceof EvolveOpError && e.code === 'invalid' ? 2 : 1;
    fail(safeText(scrubPaths((e as Error).message, cfg.home)), code);
  }
}

const CREW_MOVED = 'crew styles moved to the web dashboard (aorch serve, Crew tab)';

async function main() {
  const argv = process.argv.slice(2);
  // crew styles moved to the web dashboard: accept the old flag, env var and command, say so once, and carry on
  const ci = argv.findIndex((a) => a === '--crew' || a.startsWith('--crew='));
  if (ci >= 0) argv.splice(ci, argv[ci] === '--crew' ? 2 : 1);
  if (ci >= 0 || process.env.AORCH_CREW) console.error(dim(CREW_MOVED));
  const cmd = argv[0];
  if (!cmd && process.stdout.isTTY && process.stdin.isTTY) {
    applyTheme();
    const ctx = open({});
    installExamples(ctx.cfg.home, examplesDir);
    await ctx.vault.ensure();
    await runTui({ cfg: ctx.cfg, store: ctx.store, engine: ctx.engine });
    process.exit(0);
  }
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    await banner('durable orchestrator for CLI coding agents');
    return console.log(prettyHelp());
  }

  // the Code Mode MCP server an agent CLI starts for one step (stdio): it only needs its session file
  if (cmd === 'codemode-mcp') {
    const at = argv.indexOf('--session');
    const file = at > 0 ? argv[at + 1] : undefined;
    if (!file) fail('usage: tether codemode-mcp --session <file>');
    const { serveCodeModeMcp } = await import('./codemode/mcpMain.js');
    return serveCodeModeMcp(file);
  }

  const { values: v, positionals: pos } = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    options: {
      home: { type: 'string' },
      vault: { type: 'string' },
      repo: { type: 'string' },
      task: { type: 'string' },
      ref: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'auto-approve': { type: 'boolean' },
      'retry-failed': { type: 'boolean' },
      'keep-work': { type: 'boolean' },
      finished: { type: 'boolean' },
      reject: { type: 'boolean' },
      resume: { type: 'boolean' },
      json: { type: 'boolean' },
      theme: { type: 'string' },
      yes: { type: 'boolean' },
      supervise: { type: 'boolean' },
      'no-supervise': { type: 'boolean' },
      rounds: { type: 'string' },
      'rules-only': { type: 'boolean' },
      name: { type: 'string' },
      url: { type: 'string' },
      days: { type: 'string' },
      by: { type: 'string' },
      'key-env': { type: 'string' },
      title: { type: 'string' },
      kind: { type: 'string' },
      persona: { type: 'string' },
      color: { type: 'string' },
      accent: { type: 'string' },
      body: { type: 'string' },
      eyes: { type: 'string' },
      mouth: { type: 'string' },
      top: { type: 'string' },
      side: { type: 'string' },
      pattern: { type: 'string' },
      'read-only': { type: 'boolean' },
      bot: { type: 'string' },
      workflow: { type: 'string' },
      labels: { type: 'string' },
      events: { type: 'string' },
      comment: { type: 'boolean' },
      'trust-code': { type: 'boolean' },
      drafts: { type: 'boolean' },
      forks: { type: 'boolean' },
      generate: { type: 'boolean' },
      interval: { type: 'string' },
      workspace: { type: 'string' },
      id: { type: 'string' },
      agent: { type: 'string' },
      model: { type: 'string' },
      summary: { type: 'string' },
      setup: { type: 'string' },
      build: { type: 'string' },
      test: { type: 'string' },
      goal: { type: 'string', multiple: true },
      convention: { type: 'string', multiple: true },
      avoid: { type: 'string', multiple: true },
      survey: { type: 'boolean' },
      force: { type: 'boolean' },
      fire: { type: 'boolean' },
      limit: { type: 'string' },
      'no-workspace': { type: 'boolean' },
      mode: { type: 'string' },
      roster: { type: 'string' },
      budget: { type: 'string' },
      since: { type: 'string' },
      probe: { type: 'boolean' },
      'allow-commands': { type: 'boolean' },
      tasks: { type: 'string' },
      proposal: { type: 'string' },
      accept: { type: 'string' },
      pick: { type: 'string' },
      show: { type: 'string' },
      list: { type: 'boolean' },
      all: { type: 'boolean' },
      clean: { type: 'boolean' },
      source: { type: 'string' },
      from: { type: 'string' },
      update: { type: 'boolean' },
      env: { type: 'string' },
      into: { type: 'string' },
      out: { type: 'string' },
      'with-secrets': { type: 'boolean' },
      'no-endpoints': { type: 'boolean' },
      header: { type: 'string', short: 'H', multiple: true },
      data: { type: 'string', short: 'd' },
    },
  });
  applyTheme(v.theme);

  switch (cmd) {
    case 'tui': {
      const ctx = open(v);
      installExamples(ctx.cfg.home, examplesDir);
      await ctx.vault.ensure();
      await runTui({ cfg: ctx.cfg, store: ctx.store, engine: ctx.engine });
      process.exit(0);
    }
    case 'team': {
      const goal = pos.join(' ').trim() || v.task || fail('usage: aorch team "<goal>" --repo <dir> [--mode live|autonomous] [--roster a,b] [--budget $] [--rounds n] [--yes]');
      const repo = resolve(v.repo ?? '.');
      let ta;
      try {
        ta = parseTeamArgs({ roster: v.roster, mode: v.mode, budget: v.budget, rounds: v.rounds });
      } catch (e) {
        fail((e as Error).message);
      }
      const ctx = open(v);
      let id: string;
      try {
        id = await ctx.engine.startTeam({ task: goal, repo, yes: v.yes, workspace: wsOpt(v), endpoints: v['no-endpoints'] ? false : undefined, ...ta });
      } catch (e) {
        fail((e as Error).message);
      }
      if (!v.json) {
        await banner(`team  ${faint('→')}  ${repo}`);
        await typeLine(`${dim('goal')}  ${s0(goal)}`, 6);
      }
      const interactive = canAsk() && !v.json;
      let s: RunState;
      try {
        s = await planDialogue(ctx, id, interactive);
      } catch (e) {
        fail(`${(e as Error).message}\n  ${dim('the run is saved:')} aorch show ${id}`);
      }
      if (s.planning || !s.plan) {
        if (s.pending.length && v.json) {
          console.log(JSON.stringify({ id, status: 'waiting', pending: s.pending }));
          process.exit(2);
        }
        if (s.pending.length) {
          console.log(`\n${amber('◉')} Maestro has ${s.pending.length} question${s.pending.length > 1 ? 's' : ''} for you`);
          for (const q of s.pending) console.log(renderQuestion(q, Math.min(caps.cols, process.stdout.columns || 80)).join('\n') + '\n');
          console.log(`${dim('$')} ${cyan(`aorch answer ${id} ${s.pending[0]!.id} <option>`)}`);
          process.exit(2);
        }
        fail(s.error ? `planning ended without a plan: ${s.error}` : `planning ended without a plan (${s.status})`);
      }
      if (!v.json) showPlan(s);
      let go = !!v.yes;
      if (!go) {
        if (!interactive) {
          if (v.json) console.log(JSON.stringify({ id, status: 'plan-ready', plan: s.plan }));
          else console.log(`\n${dim('$')} ${cyan(`aorch plan ${id}`)}${dim('   approve and start')}`);
          process.exit(2);
        }
        go = await confirm('\nApprove this plan?');
      }
      try {
        await ctx.engine.approveTeamPlan(id, go);
      } catch (e) {
        fail((e as Error).message);
      }
      if (!go) return console.log(v.json ? JSON.stringify({ id, status: 'stopped' }) : `${red('rejected')} the plan; the run is stopped`);
      return drive(ctx, id, !!v.json);
    }
    case 'plan': {
      const id = pos[0] ?? fail('usage: aorch plan <runId> [--reject]');
      const ctx = open(v);
      const s = ctx.store.state(id) ?? fail(`unknown run ${id}`);
      if (s.kind !== 'team') fail('not a team run');
      if (s.plan && !s.pipeline.nodes.length && !v.json && !v.reject) showPlan(s);
      try {
        await ctx.engine.approveTeamPlan(id, !v.reject);
      } catch (e) {
        fail((e as Error).message);
      }
      if (v.reject) return console.log(v.json ? JSON.stringify({ id, status: 'stopped' }) : `${red('rejected')} the plan; the run is stopped`);
      if (!v.json) console.log(`${green('approved')} the plan`);
      return drive(ctx, id, !!v.json);
    }
    case 'answer': {
      const [id, qid, ...rest] = pos;
      const input = rest.join(' ');
      if (!id || !qid || !input.trim()) fail('usage: aorch answer <runId> <question> <option|"your own words">');
      const ctx = open(v);
      const s = ctx.store.state(id) ?? fail(`unknown run ${id}`);
      if (s.kind !== 'team') fail('not a team run');
      const q = s.pending.find((x) => x.id === qid) ?? fail(s.answers.some((a) => a.question === qid) || s.userAsks?.some((a) => a.question.id === qid && a.answer) ? `already answered: ${qid}` : `unknown question: ${qid} (pending: ${s.pending.map((x) => x.id).join(', ') || 'none'})`);
      let a: Answer;
      try {
        a = answerFromInput(q, input);
      } catch (e) {
        fail((e as Error).message);
      }
      try {
        if (s.userAsks?.some((x) => x.question.id === qid)) await ctx.engine.answerUser(id, qid, { option: a.option, text: a.text });
        else await ctx.engine.answerPlan(id, [a]);
      } catch (e) {
        fail((e as Error).message);
      }
      const now = ctx.store.state(id)!;
      if (v.json && !ctx.engine.isLive(id)) return console.log(JSON.stringify({ id, answered: qid, status: now.status, planning: now.planning, pending: now.pending, plan: now.plan }));
      if (!v.json) console.log(`${green('✔')} answered ${qid}${a.option ? ` ${dim('→')} ${a.option}` : ''}`);
      if (ctx.engine.isLive(id)) return drive(ctx, id, !!v.json);
      if (now.pending.length) {
        console.log(`${amber('◉')} still waiting on: ${bold(now.pending.map((x) => x.id).join(', '))}`);
        for (const x of now.pending) console.log(renderQuestion(x, Math.min(caps.cols, process.stdout.columns || 80)).join('\n') + '\n');
      } else if (now.plan && !now.planning && !now.pipeline.nodes.length) {
        showPlan(now);
        console.log(`\n${dim('$')} ${cyan(`aorch plan ${id}`)}${dim('   approve and start')}`);
      }
      return;
    }
    case 'mode': {
      const [id, mode] = pos;
      if (!id || !mode) fail('usage: aorch mode <runId> live|autonomous');
      const ctx = open(v);
      try {
        ctx.engine.setMode(id, mode as 'live');
      } catch (e) {
        fail((e as Error).message);
      }
      return console.log(v.json ? JSON.stringify({ id, mode }) : `${green('✔')} ${id} is now ${bold(mode)}`);
    }
    case 'orchestrate': {
      const task = pos.join(' ').trim() || v.task || fail('usage: aorch orchestrate "<what you want done>" --repo <dir> [--yes] [--rules-only]');
      const repo = resolve(v.repo ?? '.');
      const ctx = open(v);
      await banner('orchestrator bot');
      if (caps.animate) console.log(dim('  Reading your task and designing a workflow…'));
      const maestro = loadBindings(ctx.cfg.home).orchestrator;
      const comp = await composePipeline(task, { repo, registry: makeRegistry(ctx.cfg), heuristicOnly: v['rules-only'], agent: maestro?.agent, model: maestro?.model, home: ctx.cfg.home });
      if (caps.animate) process.stdout.write('\x1b[1A\x1b[J');
      console.log(`  ${comp.rationale}`);
      console.log('');
      console.log(`  ${comp.pipeline.nodes.map((n) => paint(CREW[crewFor(n)]!.color(), `${CREW[crewFor(n)]!.name}`) + dim(` ${n.title ?? n.role ?? n.kind}`)).join(dim('  →  '))}`);
      for (const w of comp.warnings) console.log(`  ${amber('!')} ${dim(w)}`);
      console.log(dim(`\n  workflow ${comp.pipeline.name} · ${comp.source === 'bot' ? 'designed by the bot' : 'chosen by rules'}\n`));
      if (v.json) return console.log(JSON.stringify(comp.pipeline, null, 2));
      if (!v.yes) {
        console.log(`  run it:  ${cyan(`aorch orchestrate ${JSON.stringify(task)} --repo ${repo} --yes`)}`);
        console.log(dim('  (the workflow is saved either way; edit it with `aorch`, then run it from the Workflows tab)'));
        writePipeline(ctx.cfg.home, comp.pipeline);
        return;
      }
      writePipeline(ctx.cfg.home, comp.pipeline);
      let id: string;
      try {
        id = await ctx.engine.start({ pipeline: comp.pipeline, task, repo, autoApprove: v['auto-approve'], workspace: wsOpt(v) });
      } catch (e) {
        fail((e as Error).message);
      }
      return drive(ctx, id, false);
    }
    case 'crew': {
      // bare `aorch crew` used to open the terminal crew-style picker
      if (pos.length === 0) {
        if (ci < 0 && !process.env.AORCH_CREW) console.error(dim(CREW_MOVED));
        return;
      }
      const sub = pos[0];
      const cfg = loadConfig(v);
      const srcOf = (b: BotDef) => b.source ?? (b.builtin ? 'built-in' : 'yours');
      if (sub === 'list') {
        const bots = loadCrew(cfg.home).filter((b) => !v.source || b.source?.startsWith(`${v.source}@`));
        if (v.json) return console.log(JSON.stringify(bots.map((b) => ({ id: b.id, name: b.name, kind: b.kind, source: srcOf(b), whenToUse: b.whenToUse }))));
        for (const b of bots) console.log(`${bold(b.id.padEnd(24))} ${b.kind.padEnd(8)} ${dim(srcOf(b))}`);
        return;
      }
      if (sub === 'import') {
        if (pos[1] !== 'ecc') fail('usage: aorch crew import ecc [--ref <tag>] [--from <dir>] [--update] [--yes]', 2);
        let p: Prepared;
        try {
          p = await prepareEcc(cfg.home, { ref: v.ref, from: v.from ? resolve(v.from) : undefined, fetch: gitFetch });
        } catch (e) {
          fail(safeText((e as Error).message));
        }
        const d = p.diff;
        console.log(`ECC ${d.ref}: ${d.added.length} added, ${d.updated.length} updated, ${d.removed.length} removed, ${d.skills} skills, ${d.commands} commands`);
        for (const id of d.added) console.log(green(`  + ${id}`));
        for (const id of d.removed) console.log(`  - ${id}`);
        for (const s of [...d.skipped, ...d.notes]) console.log(dim(`  ${s}`));
        const was = eccInfo(cfg.home);
        if ((v.update || was) && !v.yes) {
          if (!process.stdin.isTTY) {
            discardEcc(p);
            fail('re-run with --yes to apply this update', 2);
          }
          if (!(await confirm(`Apply ECC ${d.ref}${was ? ` (now ${was.ref})` : ''}?`))) {
            discardEcc(p);
            return console.log(dim('nothing changed'));
          }
        }
        let done;
        try {
          done = applyEcc(cfg.home, p);
        } catch (e) {
          discardEcc(p);
          fail(safeText((e as Error).message));
        }
        for (const s of done.skipped.filter((x) => !d.skipped.includes(x))) console.log(dim(`  ${s}`));
        console.log(green(`✔ ECC ${done.ref} imported into the crew: ${done.added.length} added, ${done.updated.length} updated, ${done.removed.length} removed`));
        return;
      }
      if (sub === 'remove') {
        if (v.source !== 'ecc') fail('usage: aorch crew remove --source ecc [--yes]', 2);
        if (!v.yes) {
          if (!process.stdin.isTTY) fail('re-run with --yes to remove every ECC bot', 2);
          if (!(await confirm('Remove every ECC bot and the vendored checkout?', { defaultNo: true }))) return console.log(dim('nothing removed'));
        }
        console.log(green(`✔ removed ${removeEcc(cfg.home).length} ECC bots`));
        return;
      }
      fail('usage: aorch crew list [--source ecc] | crew import ecc [--ref] [--from] [--update] [--yes] | crew remove --source ecc', 2);
    }
    case 'bots': {
      const sub = pos[0];
      const cfg = loadConfig(v);
      const reg = makeRegistry(cfg);
      refreshCrew(cfg.home);
      const roleOf = (q: string) => (q.toLowerCase() === 'escalate' ? 'escalate' : undefined) ?? Object.entries(CREW).find(([k, c]) => k === q.toLowerCase() || c.name.toLowerCase() === q.toLowerCase())?.[0];
      if (sub === 'packs') {
        for (const p of PACKS) console.log(`${bold(p.id.padEnd(10))} ${p.name} ${dim('· ' + p.bots.length + ' bots · ' + p.blurb)}\n           ${dim(p.bots.map((b) => b.name).join(', '))}`);
        console.log(dim('\n  aorch bots add-pack <pack> [--yes]   ·   aorch bots import <file> [--yes]'));
        return;
      }
      const crewNow = loadCrew(cfg.home, (m) => console.error(amber(`warning: ${m}`)));
      const partFlags = () => {
        const look: Record<string, unknown> = {};
        for (const k of PART_KEYS) if (typeof v[k as keyof typeof v] === 'string') look[k] = v[k as keyof typeof v];
        if (v.color) look.color = v.color;
        if (v.accent) look.accent = v.accent;
        return look;
      };
      const badParts = (look: Record<string, unknown>) => {
        for (const k of PART_KEYS) if (look[k] !== undefined && !(LOOK_PARTS[k] as readonly string[]).includes(String(look[k]))) fail(`--${k} must be one of: ${LOOK_PARTS[k].join(', ')}`);
      };
      const confirm = async (q: string) => {
        if (v.yes) return true;
        if (!process.stdin.isTTY) fail('this needs a terminal to confirm, or pass --yes');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = (await rl.question(q + ' [y/N] ')).trim().toLowerCase();
        rl.close();
        return a === 'y' || a === 'yes';
      };
      const review = (bots: BotDef[]) => {
        for (const b of bots) {
          console.log(`  ${bold(b.name)} ${dim('· ' + (b.title || 'no title') + ' · ' + b.kind + (b.readOnly ? ' · read-only' : ''))}\n    ${dim(b.persona || '(no persona)')}`);
          if (b.kind === 'gate') console.log(`    ${amber('!')} ${dim('gate: runs your repo’s test command')}`);
        }
      };
      const install = async (bots: BotDef[], what: string) => {
        const taken = new Set(crewNow.map((b) => b.id));
        const fresh = reid(bots, taken);
        console.log(`${bold(what)} adds ${fresh.length} bot${fresh.length === 1 ? '' : 's'}. Their personas become the instructions for the steps they run:\n`);
        review(fresh);
        console.log();
        if (!(await confirm('Add them to your crew?'))) return console.log(dim('nothing added'));
        for (const b of fresh) saveBot(cfg.home, b);
        console.log(`${green('✔')} added ${fresh.map((b) => bold(b.name)).join(', ')}  ${dim('(' + join(cfg.home, 'crew') + ')')}`);
      };
      if (sub === 'add-pack') {
        const p = findPack(pos[1] ?? '') ?? fail(`usage: aorch bots add-pack <pack>   (packs: ${PACKS.map((x) => x.id).join(', ')})`);
        return install(p.bots, `${p.name} pack`);
      }
      if (sub === 'import') {
        const f = pos[1] ?? fail('usage: aorch bots import <file.json>');
        let raw: unknown;
        try { raw = JSON.parse(readFileSync(resolve(f), 'utf8')); } catch (e) { fail(`could not read ${f}: ${(e as Error).message}`); }
        const { bots, errors } = parseBots(raw);
        for (const e of errors) console.log(`${amber('!')} skipped ${e}`);
        if (!bots.length) fail('no valid bots in that file');
        return install(bots, f);
      }
      if (sub === 'export') {
        const ids = pos.slice(1);
        const pick = ids.length ? crewNow.filter((b) => ids.includes(b.id) || ids.includes(b.name.toLowerCase())) : crewNow.filter((b) => !b.builtin);
        if (!pick.length) fail('nothing to export (pass bot ids, or create some bots first)');
        console.log(JSON.stringify({ bots: pick.map(toFile) }, null, 2));
        return;
      }
      if (sub === 'new' || sub === 'edit') {
        const look0 = partFlags();
        badParts(look0);
        let base: BotDef | undefined;
        if (sub === 'edit') {
          const id = pos[1] ?? fail('usage: aorch bots edit <bot> [--name … --title … --persona … --kind … --color #hex --body … --eyes …]');
          base = crewNow.find((b) => b.id === id.toLowerCase() || b.name.toLowerCase() === id.toLowerCase()) ?? fail(`no bot "${id}" (see: aorch bots)`);
        } else if (!(pos[1] ?? v.name)) fail('usage: aorch bots new <name> [--title … --kind agent|verdict|gate|approval|orchestrator --persona … --color #hex --body … --eyes … --mouth … --top … --side … --pattern …]');
        const name = String(v.name ?? (sub === 'new' ? pos[1] : base!.name));
        const kind = (v.kind ?? base?.kind ?? 'agent') as string;
        if (!BOT_KINDS.includes(kind as never)) fail(`--kind must be one of ${BOT_KINDS.join(', ')}`);
        const cand = { id: base?.id ?? freshId(name, crewNow.map((b) => b.id)), name, title: v.title ?? base?.title ?? '', kind, persona: v.persona ?? base?.persona ?? '', readOnly: v['read-only'] ?? base?.readOnly, look: { ...(base?.look ?? {}), ...look0 } };
        const { bot, error } = sanitizeBot(cand);
        if (!bot) fail(error ?? 'invalid bot');
        saveBot(cfg.home, bot);
        console.log(`${green('✔')} ${sub === 'new' ? 'created' : 'saved'} ${bold(bot.name)} ${dim('(' + bot.id + ' · ' + bot.kind + ')')}`);
        return;
      }
      if (sub === 'remove' || sub === 'reset') {
        const id = (pos[1] ?? fail('usage: aorch bots remove <bot>')).toLowerCase();
        const bot = crewNow.find((b) => b.id === id || b.name.toLowerCase() === id) ?? fail(`no bot "${id}"`);
        const r = removeBot(cfg.home, bot.id);
        console.log(r === 'deleted' ? `${green('✔')} removed ${bold(bot.name)}` : r === 'reset' ? `${green('✔')} ${bold(bot.name)} is back to its original look` : BUILTIN_IDS.has(bot.id) ? dim(`${bot.name} is a built-in and has no edits to reset`) : dim('nothing to remove'));
        return;
      }
      if (sub === 'link') {
        const role = roleOf(pos[1] ?? '') ?? fail(`usage: aorch bots link <bot> <agent> [model]   (bots: ${Object.values(CREW).map((c) => c.name.toLowerCase()).join(', ')})`);
        const agent = pos[2] ?? fail(`usage: aorch bots link ${pos[1]} <agent> [model]   (agents: ${reg.ids().filter((i) => i !== 'mock').join(', ')})`);
        if (!reg.has(agent)) fail(`unknown agent "${agent}" (known: ${reg.ids().join(', ')})`);
        link(cfg.home, role, { agent, model: pos[3] });
        console.log(`${green('✔')} ${bold(CREW[role]?.name ?? 'escalation')} is now linked to ${cyan(agent)}${pos[3] ? ` · ${pos[3]}` : ''}${role === 'escalate' ? dim('  (what Maestro moves a repeatedly failing step to)') : ''}`);
        const d = await reg.get(agent).detect();
        if (!d.ok) console.log(`  ${amber('!')} ${dim(`${agent} is not available right now: ${d.detail ?? 'unavailable'}`)}`);
        return;
      }
      if (sub === 'unlink') {
        const role = roleOf(pos[1] ?? '') ?? fail('usage: aorch bots unlink <bot>');
        unlink(cfg.home, role);
        console.log(`${green('✔')} ${bold(CREW[role]!.name)} follows the default again (claude)`);
        return;
      }
      await banner('the crew');
      const b = loadBindings(cfg.home);
      const det: Record<string, boolean> = {};
      await Promise.all(reg.ids().map(async (id) => (det[id] = (await reg.get(id).detect()).ok)));
      const rows = Object.entries(CREW).map(([role, c]) => {
        const bd = b[role];
        const agent = bd?.agent ?? 'claude';
        return [paint(c.color(), '●'), bold(paint(c.color(), c.name)), dim(c.title), bd ? `${cyan(agent)}${bd.model ? dim(' · ' + bd.model) : ''}` : dim('claude (default)'), role === 'approval' ? '' : det[agent] ? green('✔ ready') : red('✘ unavailable')];
      });
      const esc = b.escalate;
      rows.push([dim('⇧'), bold(paint(pal.amber, 'escalate')), dim('on repeat failure'), esc ? `${cyan(esc.agent)}${esc.model ? dim(' · ' + esc.model) : ''}` : dim('claude · opus (default)'), '']);
      console.log(box(table(rows), { title: 'crew ↔ models', width: caps.cols, border: BRAND }).join('\n'));
      console.log(dim(`\n  aorch bots link <bot> <agent> [model]   ·   aorch bots unlink <bot>   ·   aorch models `));
      return;
    }
    case 'models': {
      const cfg = loadConfig(v);
      const reg = makeRegistry(cfg);
      await banner('models');
      const only = pos[0];
      const ids = reg.ids().filter((i) => i !== 'mock' && (!only || i === only));
      if (only && !ids.length) fail(`unknown agent "${only}" (known: ${reg.ids().join(', ')})`);
      const lines: string[] = [];
      await Promise.all(ids.map(async (id) => {
        const a = reg.get(id);
        const d = await a.detect();
        const models = d.ok && a.listModels ? await a.listModels() : [];
        lines[ids.indexOf(id)] = `${d.ok ? green('✔') : red('✘')} ${bold(id.padEnd(10))} ${d.ok ? cyan(d.version ?? 'ready') : dim(d.detail ?? 'unavailable')}${models.length ? '\n' + models.slice(0, only ? 100 : 8).map((m) => `    ${dim('·')} ${m}`).join('\n') + (models.length > (only ? 100 : 8) ? `\n    ${dim(`… ${models.length - 8} more (aorch models ${id})`)}` : '') : d.ok ? `\n    ${dim('· this agent does not list models; pass any name it accepts')}` : ''}`;
      }));
      console.log(lines.join('\n'));
      console.log(dim(`\n  link one to a bot:  aorch bots link bolt ollama qwen2.5-coder:14b`));
      return;
    }
    case 'theme': {
      const cfg = loadConfig(v);
      const pick = pos[0];
      if (pick) {
        if (!THEMES[pick]) fail(`unknown theme "${pick}" — options: ${Object.keys(THEMES).join(', ')}`);
        savePrefs(cfg.home, { theme: pick });
        setTheme(pick);
      }
      await banner(`theme: ${themeName}`);
      for (const [n, t] of Object.entries(THEMES)) {
        setTheme(n);
        console.log(`  ${n === (pick ?? themeName) ? green('●') : dim('○')} ${padEndV(bold(n), 8)} ${gradient('████████████████', BRAND)}  ${dim(t.label)}`);
      }
      setTheme(pick ?? themeName);
      console.log(dim(`\n  switch with: aorch theme <name>   or per run: --theme <name> / AORCH_THEME`));
      return;
    }
    case 'usage': {
      const cfg = loadConfig(v);
      const names = Object.keys(cfg.endpoints).filter((n) => supportsUsage(cfg.endpoints[n]!));
      const name = pos[0] ?? names[0];
      if (!name || !cfg.endpoints[name]) return fail(names.length ? `usage: aorch usage [${names.join('|')}] [--days 7] [--by model|key|member|app]` : 'no provider with a Spend API yet. Add one: aorch providers add --name experientiallabs --url https://api.experientiallabs.ai/v1 --key-env EXPLABS_API_KEY');
      if (!supportsUsage(cfg.endpoints[name]!)) return fail(`${name} has no Spend API`);
      const u = await fetchUsage(cfg.endpoints[name]!, { days: v.days ? Number(v.days) : 7, groupBy: v.by });
      if (v.json) return console.log(JSON.stringify({ ...u, totals: { ...u.totals, paid: String(u.totals.paid), byok: String(u.totals.byok), free: String(u.totals.free) }, groups: u.groups.map((g) => ({ ...g, paid: String(g.paid), byok: String(g.byok), free: String(g.free) })) }));
      const t = u.totals;
      console.log(`${bold(name)}  last ${u.days} days   ${bold(usdOf(spendNano(t)))}  ${dim(`(paid ${usdOf(t.paid)} · BYOK ${usdOf(t.byok)} · free ${usdOf(t.free)})`)}`);
      console.log(dim(`  ${t.requests} requests · ${t.errors} errors · ${t.inputTokens.toLocaleString()} in (${t.cachedTokens.toLocaleString()} cached) · ${t.outputTokens.toLocaleString()} out`));
      for (const g of u.groups.slice(0, 15)) console.log(`  ${padEndV(g.name, 34)} ${padEndV(usdOf(spendNano(g)), 9)} ${dim(`${g.requests} req · ${g.inputTokens.toLocaleString()} in · ${g.outputTokens.toLocaleString()} out`)}`);
      if (u.provisional) console.log(amber('\n  some usage has unknown provider accounting, so money figures are provisional'));
      if (!u.complete) console.log(amber('  the report was still catching up; run again for final numbers'));
      return;
    }
    case 'providers': {
      const cfg = loadConfig(v);
      const sub = pos[0] ?? 'list';
      if (sub === 'list') {
        const rows = listProviders(cfg, makeRegistry(cfg));
        if (v.json) return console.log(JSON.stringify(rows));
        for (const r of rows) console.log(`  ${padEndV(bold(r.id), 14)} ${padEndV(dim(r.kind), 14)} ${r.where}${r.keyEnv ? '  ' + (r.keySet ? green(r.keyEnv + ' set') : amber(r.keyEnv + ' not set')) : ''}`);
        console.log(dim('\n  add one: aorch providers add deepseek   ·   aorch providers presets'));
        return;
      }
      if (sub === 'presets') {
        for (const p of PRESETS) console.log(`  ${padEndV(bold(p.id), 12)} ${padEndV(p.label, 26)} ${dim(p.baseUrl)}  key: ${p.keyEnv}`);
        return;
      }
      if (sub === 'add') {
        const preset = PRESETS.find((p) => p.id === pos[1]);
        const id = providerName(v.name ?? pos[1] ?? '');
        const url = v.url ?? preset?.baseUrl;
        if (!id || !url) fail('usage: aorch providers add <preset>   or   aorch providers add --name mybox --url https://host/v1 [--key-env MYBOX_KEY]');
        const key = keyRef(v['key-env'] ?? preset?.keyEnv ?? '');
        addEndpoint(cfg, id!, { baseUrl: baseUrlOf(url!), ...(key ? { apiKey: key } : {}) });
        console.log(`${green('✔')} added ${id}${key && !process.env[key.slice(4)] ? '  ' + amber(`(set ${key.slice(4)} in your shell before using it)`) : ''}`);
        return;
      }
      if (sub === 'usage-key' || sub === 'org-id') {
        if (!pos[1] || !pos[2]) fail(`usage: aorch providers ${sub} <name> ${sub === 'org-id' ? '<id>' : '<ENV_VAR>'}`);
        updateEndpoint(cfg, pos[1]!, sub === 'org-id' ? { orgId: pos[2] } : { usageKey: keyRef(pos[2]!) });
        console.log(`${green('✔')} ${pos[1]}: ${sub} saved`);
        return;
      }
      if (sub === 'remove' || sub === 'rm') {
        if (!pos[1]) fail('usage: aorch providers remove <name>');
        removeEndpoint(cfg, pos[1]!);
        console.log(`${green('✔')} removed ${pos[1]}`);
        return;
      }
      return fail('usage: aorch providers [list | presets | add <preset> | remove <name>]');
    }
    case 'http': {
      const cfg = loadConfig(v);
      const code = await httpCommand(cfg.home, process.cwd(), ['http', ...pos], { json: v.json, env: v.env, header: v.header, data: v.data, kind: v.kind, into: v.into, yes: v.yes, workspace: v.workspace }, {
        out: (s) => console.log(s),
        err: (s) => console.error(s),
        readStdin: () => readFileSync(0, 'utf8'),
        confirm: (q) => confirm(q, { defaultNo: true }),
        isTTY: !!process.stdin.isTTY,
      });
      // not process.exit: that drops stdout still queued for a pipe (a --json result can be megabytes)
      process.exitCode = code;
      return;
    }
    case 'workspace':
    case 'ws': {
      const cfg = loadConfig(v);
      const sub = pos[0] ?? 'list';
      const need = (id: string | undefined): ReturnType<typeof getWorkspace> & object => {
        const all = listWorkspaces(cfg.home);
        const w = id ? all.find((x) => x.id === id) : (resolveWorkspace(cfg.home, { repo: resolve('.') }) ?? all.find((x) => x.isDefault) ?? all[0]);
        return w ?? fail(id ? `no workspace "${id}" (see: aorch workspace list)` : 'no workspace here. Register this folder: aorch workspace init');
      };
      const line = (w: ReturnType<typeof need>) => `  ${w.isDefault ? green('●') : dim('○')} ${padEndV(bold(w.id), 16)} ${padEndV(w.exists ? w.name : red('folder missing'), 22)} ${dim(w.path)}${w.repos.length ? '  ' + cyan(w.repos.join(', ')) : ''}${w.described ? '' : '  ' + amber('no notes yet')}`;
      if (sub === 'list') {
        const all = listWorkspaces(cfg.home);
        if (v.json) return console.log(JSON.stringify(all.map(({ notes, ...w }) => ({ ...w, notes: notes.length }))));
        if (!all.length) return console.log(dim('no workspaces yet. In a project folder: aorch workspace init   (writes .aorch/workspace.json and .aorch/project.md)'));
        for (const w of all) console.log(line(w));
        console.log(dim('\n  every run started in one of these folders gets its context: aorch workspace context [id]'));
        return;
      }
      if (sub === 'init' || sub === 'add') {
        const dir = resolve(pos[1] ?? '.');
        let r;
        try {
          r = initWorkspace(cfg.home, dir, { name: v.name, id: v.workspace, write: sub === 'init' });
        } catch (e) {
          fail((e as Error).message);
        }
        const patch: Record<string, unknown> = { ...(v.summary ? { summary: v.summary } : {}), ...(v.setup ? { setup: v.setup } : {}), ...(v.build ? { build: v.build } : {}), ...(v.test ? { test: v.test } : {}) };
        if (Object.keys(patch).length) updateMeta(r.workspace.path, patch);
        for (const g of v.goal ?? []) addToList(r.workspace.path, 'goals', g);
        for (const c of v.convention ?? []) addToList(r.workspace.path, 'conventions', c);
        for (const a of v.avoid ?? []) addToList(r.workspace.path, 'avoid', a);
        console.log(`${green('✔')} ${r.existed ? 'already registered' : 'registered'} ${bold(r.workspace.id)} ${dim(r.workspace.path)}`);
        for (const f of r.created) console.log(`  ${green('+')} ${f} ${dim('(commit it: your team and CI get the same context)')}`);
        if (r.created.length) console.log(dim(`\n  fill in what it is and how it works, or let an agent draft it:  aorch workspace survey ${r.workspace.id}`));
        return;
      }
      if (sub === 'show' || sub === 'context') {
        const w = need(pos[1]);
        if (sub === 'context') return console.log(contextOf(w));
        if (v.json) return console.log(JSON.stringify(w));
        await banner(`workspace ${w.id}`);
        console.log(`  ${bold(w.name)}  ${dim(w.path)}\n${w.summary ? '  ' + w.summary + '\n' : ''}`);
        const kv = (k: string, val?: string) => val && console.log(`  ${dim(k.padEnd(10))} ${val}`);
        kv('setup', w.setup); kv('build', w.build); kv('test', w.test); kv('github', w.repos.join(', '));
        for (const [k, xs] of [['goals', w.goals], ['conventions', w.conventions], ['avoid', w.avoid]] as const) for (const x of xs) kv(k, x);
        console.log(`\n  ${dim('notes')}  ${w.notes ? `${w.notes.split('\n').length} lines in .aorch/project.md` : amber('empty — aorch workspace survey ' + w.id)}`);
        const triggers = (loadSettings(cfg.home).rules ?? []).filter((r) => r.workspace === w.id || w.repos.some((x) => x.toLowerCase() === r.repo.toLowerCase()));
        if (triggers.length) console.log(`  ${dim('triggers')} ${triggers.map((t) => `${t.repo} → ${t.workflow}`).join(' · ')}`);
        return;
      }
      if (sub === 'use') {
        const id = pos[1] ?? fail('usage: aorch workspace use <id>');
        if (!setDefaultWorkspace(cfg.home, id)) fail(`no workspace "${id}"`);
        return console.log(`${green('✔')} ${bold(id)} is the default workspace`);
      }
      if (sub === 'remove') {
        const id = pos[1] ?? fail('usage: aorch workspace remove <id>');
        if (!removeWorkspace(cfg.home, id)) fail(`no workspace "${id}"`);
        return console.log(`${green('✔')} forgot ${bold(id)} ${dim('(the folder and its .aorch files are untouched)')}`);
      }
      if (sub === 'set') {
        const w = need(pos[1]);
        const patch: Record<string, unknown> = { ...(v.name ? { name: v.name } : {}), ...(v.summary !== undefined ? { summary: v.summary } : {}), ...(v.setup !== undefined ? { setup: v.setup } : {}), ...(v.build !== undefined ? { build: v.build } : {}), ...(v.test !== undefined ? { test: v.test } : {}) };
        if (v.goal) patch.goals = v.goal;
        if (v.convention) patch.conventions = v.convention;
        if (v.avoid) patch.avoid = v.avoid;
        if (!Object.keys(patch).length) fail('nothing to set. Flags: --name --summary --setup --build --test --goal "…" --convention "…" --avoid "…" (lists are replaced; repeat the flag for several)');
        updateMeta(w.path, patch);
        return console.log(`${green('✔')} updated ${join(w.path, '.aorch/workspace.json')}`);
      }
      if (sub === 'survey') {
        const w = need(pos[1]);
        if (w.notes && !v.force) fail(`${w.id} already has notes (.aorch/project.md). Use --force to replace them.`);
        const ctx = open(v);
        const pipeline = normalizePipeline({
          name: 'survey',
          nodes: [{ id: 'survey', kind: 'agent', role: 'planner', title: 'Survey the project', readOnly: true, prompt: SURVEY_PROMPT }],
          edges: [],
          settings: { maxCostUsd: 2 },
        });
        await banner(`surveying ${w.name}`);
        const id = await ctx.engine.start({ pipeline, task: `Survey the project "${w.name}" and write its project notes.`, repo: w.path, workspace: false });
        const st = await ctx.engine.wait(id);
        const out = st.nodes.survey?.output?.trim();
        if (st.status !== 'done' || !out) fail(`the survey did not finish (${st.error ?? st.nodes.survey?.error ?? 'no output'})`);
        writeNotes(w.path, out);
        console.log(`${green('✔')} wrote ${join(w.path, '.aorch/project.md')} ${dim(`${out.split('\n').length} lines · $${st.costUsd.toFixed(2)}`)}\n  ${dim('read it, correct anything wrong, and commit it. Every agent in this project will see it.')}`);
        return;
      }
      // export / import print a preview or a summary first: errors set process.exitCode instead of process.exit, which drops stdout still queued for a pipe
      const stop = (msg: string, code: number) => {
        console.error(`${red('✘ error')} ${msg}`);
        process.exitCode = code;
      };
      if (sub === 'export') {
        const w = need(pos[1]);
        if (v['with-secrets']) {
          console.error(amber('warning: the export will contain secret values in plain text; keep the file private (it is written with mode 600)'));
          if (!v.yes && !(process.stdin.isTTY && (await confirm('include the secrets?', { defaultNo: true })))) return stop('not exported (add --yes to include secrets without asking)', 2);
        }
        let r: ReturnType<typeof exportWorkspace>;
        const file = resolve(v.out ?? bundleFileName(w));
        try {
          r = exportWorkspace(cfg.home, w, { withSecrets: !!v['with-secrets'] });
          writeBundle(file, r.bundle);
        } catch (e) {
          return stop(`cannot export ${w.id}: ${(e as Error).message}`, 1);
        }
        const n = Object.keys(r.bundle.http.files).length;
        const s = r.bundle.secrets ? Object.keys(r.bundle.secrets).length : 0;
        console.log(`${green('✔')} wrote ${file} ${dim(`(${n} file${n === 1 ? '' : 's'} from .aorch/http${r.bundle.secrets ? `, ${s} secret${s === 1 ? '' : 's'}, mode 600` : ''})`)}`);
        for (const k of r.skipped) console.log(`  ${amber('!')} left out ${k.path} ${dim(`(${k.reason})`)}`);
        return;
      }
      if (sub === 'import') {
        const file = pos[1];
        if (!file) return stop('usage: aorch workspace import <file> [--into <dir>] [--yes]', 2);
        const dir = resolve(v.into ?? '.');
        let bundle: Bundle;
        let plan: ReturnType<typeof planBundleImport>;
        try {
          bundle = parseBundle(JSON.parse(readFileSync(file, 'utf8')));
          plan = planBundleImport(bundle, dir, cfg.home);
        } catch (e) {
          return stop(`cannot import ${file}: ${(e as Error).message}`, 2);
        }
        console.log(`${bold('import into')} ${dir}`);
        for (const f of plan.create) console.log(`  ${green('+')} ${f}`);
        for (const f of plan.overwrite) console.log(`  ${amber('~')} ${f} ${dim('(overwritten)')}`);
        // key names only: a value is never printed
        for (const k of plan.overwriteSecrets) console.log(`  ${amber('~')} secret ${k} ${dim('(overwritten)')}`);
        if (plan.secrets.length) console.log(`  ${amber('!')} ${plan.secrets.length} secret(s) for this workspace: ${plan.secrets.join(', ')}`);
        const replaced = plan.overwrite.length + plan.overwriteSecrets.length;
        const what = [plan.overwrite.length && `${plan.overwrite.length} file(s)`, plan.overwriteSecrets.length && `${plan.overwriteSecrets.length} secret(s)`].filter(Boolean).join(' and ');
        const go = v.yes || (process.stdin.isTTY && (await confirm(replaced ? `overwrite ${what} in ${dir}?` : `import into ${dir}?`, { defaultNo: replaced > 0 })));
        if (!go) return stop('nothing written; run again with --yes to import', 2);
        try {
          const r = applyBundle(cfg.home, bundle, dir);
          console.log(`${green('✔')} imported into ${dir} as workspace ${bold(r.workspace.id)} ${dim(`(${r.written.length} files${plan.secrets.length ? `, ${plan.secrets.length} secret(s)` : ''})`)}`);
        } catch (e) {
          return stop(`cannot import ${file}: ${(e as Error).message}`, 1);
        }
        return;
      }
      fail('usage: aorch workspace [list | init [dir] | add [dir] | show [id] | context [id] | set [id] --summary … | survey [id] | use <id> | remove <id> | export [id] [--out f] [--with-secrets] | import <file> [--into dir] [--yes]]');
    }
    case 'triggers':
    case 'trigger': {
      const cfg = loadConfig(v);
      const sub = pos[0] ?? 'list';
      const settings = loadSettings(cfg.home);
      const rules = settings.rules ?? [];
      const save = (next: Rule[]) => saveSettings(cfg.home, { ...settings, rules: ensureIds(next) });
      const get = (id: string | undefined, usage: string): Rule => {
        if (!id) return fail(usage);
        try {
          return findRule(rules, id);
        } catch (e) {
          return fail((e as Error).message);
        }
      };
      const colorStatus = (st: ReturnType<typeof triggerStatus>) => ({ paused: dim, error: red, idle: dim, active: green })[st](statusText(st));
      const outcomeColor = (o: string) => (o === 'started' ? green(o) : o === 'error' ? red(o) : amber(o));
      if (sub === 'list' || sub === 'ls') {
        if (v.json) return console.log(JSON.stringify(rules.map((r) => ({ ...r, status: triggerStatus(r, cfg.home), last: lastDelivery(cfg.home, r.id!) ?? null }))));
        if (!rules.length) return console.log(dim('no triggers yet. A trigger starts a workflow when a pull request arrives.\n  Example: aorch triggers add acme/api --workflow full-review --comment\n  Then:    aorch triggers setup   (webhook) · aorch pr watch   (polling, no setup, named repos only; * triggers need the webhook)'));
        const now = Date.now();
        for (const r of rules) {
          const st = triggerStatus(r, cfg.home, now);
          const last = lastDelivery(cfg.home, r.id!);
          const who = r.agent ? `${r.agent}${r.model ? '/' + r.model : ''}` : r.model ? `default agent/${r.model}` : 'default agent';
          console.log(`  ${padEndV(bold(r.id!), 24)} ${padEndV(colorStatus(st), 8)} ${padEndV(r.repo, 22)} ${padEndV(cyan('→ ' + r.workflow), 20)} ${padEndV(dim(r.workspace ?? 'no workspace'), 14)} ${padEndV(dim(who), 18)} ${dim((r.events ?? DEFAULT_EVENTS).join(','))}  ${last ? `${dim(agoRel(last.at, now))} ${outcomeColor(last.outcome)}${last.pr ? dim(' #' + last.pr) : ''}` : dim('no deliveries')}`);
        }
        return;
      }
      if (sub === 'add') {
        const repo = pos[1] ?? fail('usage: aorch triggers add <owner/repo|*> --workflow <name> [--workspace id] [--agent a] [--model m] [--events opened,synchronize] [--labels a,b] [--comment] [--drafts] [--forks] [--id name]');
        let rule: Rule;
        try {
          rule = parseRuleArgs(repo, { ...v, workflow: v.workflow });
        } catch (e) {
          return fail((e as Error).message);
        }
        const checked = checkRuleRefs(rule, ruleRefs(cfg));
        if (checked.errors.length) fail(checked.errors.join('\n'));
        for (const w of checked.warnings) console.log(`${amber('!')} ${w}`);
        let plan;
        try {
          plan = planRuleAdd(rules, rule);
        } catch (e) {
          return fail((e as Error).message);
        }
        const { next, prev } = plan;
        save(next);
        const saved = loadSettings(cfg.home).rules!.find((r) => r.repo.toLowerCase() === rule.repo.toLowerCase() && r.workflow === rule.workflow)!;
        console.log(`${green('✔')} trigger ${bold(saved.id!)}: PRs on ${bold(repo)} will run ${cyan(rule.workflow)}${rule.workspace ? ' in workspace ' + bold(rule.workspace) : ''}${rule.agent || rule.model ? ' on ' + bold([rule.agent, rule.model].filter(Boolean).join('/')) : ''}${rule.comment ? ' and post the result as a comment' : ''}${prev ? dim(' (replaced the earlier one)') : ''}`);
        console.log(dim(`  try it without running anything: aorch triggers test ${saved.id} <pr>   ·   receive PRs: aorch triggers setup (webhook) or aorch pr watch (polling)`));
        return;
      }
      if (sub === 'enable' || sub === 'disable') {
        const r = get(pos[1], `usage: aorch triggers ${sub} <id>`);
        save(rules.map((x) => (x === r ? { ...x, enabled: sub === 'enable' ? undefined : false } : x)));
        console.log(`${green('✔')} ${bold(r.id!)} ${sub === 'enable' ? 'enabled' : 'paused (kept, but PRs are ignored until you enable it)'}`);
        return;
      }
      if (sub === 'remove' || sub === 'rm') {
        const r = get(pos[1], 'usage: aorch triggers remove <id>');
        save(rules.filter((x) => x !== r));
        console.log(`${green('✔')} removed ${bold(r.id!)}`);
        return;
      }
      if (sub === 'show') {
        const r = get(pos[1], 'usage: aorch triggers show <id>');
        const st = triggerStatus(r, cfg.home);
        if (v.json) return console.log(JSON.stringify({ ...r, status: st, deliveries: readDeliveries(cfg.home, { trigger: r.id, limit: 10 }) }));
        const row = (k: string, val: string) => console.log(`  ${dim(k.padEnd(11))} ${val}`);
        console.log(`  ${bold(r.id!)}  ${colorStatus(st)}`);
        row('source', `GitHub pull requests on ${r.repo === '*' ? 'any repo (webhook only; aorch pr watch skips * triggers)' : r.repo}`);
        row('events', (r.events ?? DEFAULT_EVENTS).join(', '));
        row('workflow', cyan(r.workflow));
        row('workspace', r.workspace ?? dim('none'));
        row('agent/model', r.agent || r.model ? [r.agent ?? 'default', r.model].filter(Boolean).join('/') : dim("crew defaults"));
        row('filters', [r.labels?.length ? 'labels: ' + r.labels.join(', ') : '', r.drafts ? 'drafts' : 'no drafts', r.forks ? 'forks' : 'no forks'].filter(Boolean).join(' · '));
        row('comment', r.comment ? 'posts the result on the PR' : 'no');
        const recent = readDeliveries(cfg.home, { trigger: r.id, limit: 5 });
        console.log(`\n  ${dim('recent deliveries')}${recent.length ? '' : '  ' + dim('none yet')}`);
        for (const d of recent) console.log(`  ${dim(agoRel(d.at).padEnd(10))} ${padEndV(outcomeColor(d.outcome), 8)} ${dim(d.source.padEnd(7))} ${d.repo}${d.pr ? '#' + d.pr : ''} ${dim(d.reason ?? d.runId ?? '')}`);
        return;
      }
      if (sub === 'log') {
        const id = pos[1];
        if (id) get(id, '');
        const limit = Math.max(1, Math.min(500, Number(v.limit ?? 20) || 20));
        const ds = readDeliveries(cfg.home, { trigger: id, limit });
        if (v.json) return console.log(JSON.stringify(ds));
        if (!ds.length) return console.log(dim(id ? `nothing has arrived for ${id} yet` : 'no deliveries yet. Webhooks and polling record every PR they see, including the ones they ignore.'));
        for (const d of ds) console.log(`  ${dim(agoRel(d.at).padEnd(10))} ${padEndV(outcomeColor(d.outcome), 8)} ${dim(d.source.padEnd(7))} ${padEndV(dim(d.trigger ?? '-'), 22)} ${d.repo}${d.pr ? '#' + d.pr : ''} ${dim(d.reason ?? d.runId ?? '')}`);
        return;
      }
      if (sub === 'test') {
        const r = get(pos[1], 'usage: aorch triggers test <id> <pr-link-or-number> [--fire]');
        if (!pos[2]) fail('usage: aorch triggers test <id> <pr-link-or-number> [--fire]');
        let ref;
        try {
          ref = parsePrTarget(pos[2]!, r);
        } catch (e) {
          return fail((e as Error).message);
        }
        let info;
        try {
          info = await fetchPr(ref);
        } catch (e) {
          return fail((e as Error).message);
        }
        const prevRun = alreadyRan(cfg.home, ref, info.headSha);
        const verdict = dryRunVerdict(r, { repo: ref.repo, labels: info.labels, draft: info.draft, fork: info.fork }, prevRun ? { sha: info.headSha, runId: prevRun } : undefined);
        const target = `${ref.repo}#${ref.number} ${dim('"' + info.title.slice(0, 60) + '"')}`;
        const where = `${cyan(r.workflow)}${r.workspace ? ' on workspace ' + bold(r.workspace) : ''} with ${bold(r.agent || r.model ? [r.agent ?? 'default agent', r.model].filter(Boolean).join('/') : 'the crew defaults')}`;
        if (!verdict.matches) {
          console.log(`${amber('○')} would be ignored: ${verdict.why}\n  ${target}`);
          return;
        }
        if (!v.fire) {
          console.log(`${green('✔')} would start ${where}\n  ${target}\n  ${dim('dry run, nothing started. Add --fire to start it for real.')}\n  ${dim('events are not checked in a dry run (GitHub supplies the action when a real PR event arrives).')}`);
          return;
        }
        const ctx = open(v);
        const at = () => new Date().toISOString();
        let started;
        try {
          started = await startPrRun({ home: cfg.home, engine: ctx.engine }, ref, { workflow: r.workflow, comment: r.comment, workspace: r.workspace, agent: r.agent, model: r.model, onComment: (e) => console.log(e ? `${red('✘')} ${e.message}` : `${green('✔')} posted the review on ${ref.url}`) });
        } catch (e) {
          const msg = (e as Error).message;
          recordDelivery(cfg.home, { at: at(), trigger: r.id, source: 'test', repo: ref.repo, pr: ref.number, outcome: classifyFailure(msg), reason: msg.slice(0, 300) });
          return fail(msg);
        }
        recordDelivery(cfg.home, { at: at(), trigger: r.id, source: 'test', repo: ref.repo, pr: ref.number, outcome: 'started', runId: started.runId });
        console.log(`${cyan('▶')} started ${where}\n  ${target} ${dim('run ' + started.runId)}`);
        return drive(ctx, started.runId, !!v.json, undefined, async () => { await started.done; });
      }
      if (sub === 'setup') {
        const { secret, created } = ensureWebhookSecret(cfg.home, v.generate);
        const port = Number(v.port ?? 4177);
        let up = false;
        try {
          await fetch(`http://127.0.0.1:${port}/api/webhooks/github`, { method: 'GET', signal: AbortSignal.timeout(1000) });
          up = true;
        } catch {
          up = false;
        }
        if (created) console.log(`${green('✔')} new webhook secret saved to ${join(cfg.home, 'pr.json')}`);
        console.log(`\n  ${dim('GitHub → repo → Settings → Webhooks → Add webhook')}\n  payload URL  ${dim('https://<your tunnel>/api/webhooks/github')}\n  content type ${bold('application/json')}\n  secret       ${bold(secret)}\n  events       ${bold('Let me select individual events → Pull requests')}\n`);
        console.log(`  local server ${up ? green(`reachable on http://127.0.0.1:${port}`) : amber(`not running on port ${port}`) + dim('  (start it: aorch serve)')}`);
        console.log(dim('\n  aorch serve listens on this machine only. Expose just the webhook with a tunnel:\n    cloudflared tunnel --url http://127.0.0.1:' + port + '\n    ngrok http ' + port + '\n    tailscale funnel ' + port + '\n  Only the webhook path is reachable that way, and it needs this signature.\n  No tunnel? aorch pr watch polls GitHub instead.\n  Check it works: aorch triggers log'));
        return;
      }
      fail('usage: aorch triggers [list | add <owner/repo|*> --workflow w … | enable|disable|remove|show <id> | log [id] [--limit n] | test <id> <pr> [--fire] | setup]');
    }
    case 'pr': {
      const cfg = loadConfig(v);
      refreshCrew(cfg.home);
      const sub = pos[0];
      const settings = loadSettings(cfg.home);
      const ruleLine = (r: Rule) => `  ${bold(r.repo.padEnd(28))} ${cyan(r.workflow.padEnd(16))} ${dim([(r.events ?? DEFAULT_EVENTS).join(','), r.labels?.length ? 'labels:' + r.labels.join('|') : '', r.comment ? 'comments back' : 'no comment', r.drafts ? 'drafts' : '', r.forks ? 'forks' : ''].filter(Boolean).join(' · '))}`;
      if (sub === 'rules' || sub === undefined) {
        if (sub === undefined) {
          console.log(`usage: aorch pr <link> [--workflow full-review] [--comment]   ·   aorch pr rules   ·   aorch pr rule add <owner/repo> --workflow <name> [--comment]\n       aorch pr watch   ·   aorch pr secret   ·   aorch pr map <owner/repo> <folder>`);
          return;
        }
        const rs = settings.rules ?? [];
        if (!rs.length) console.log(dim('no rules yet. Example: aorch pr rule add acme/api --workflow full-review --comment'));
        for (const r of rs) console.log(ruleLine(r));
        return;
      }
      if (sub === 'rule') {
        const act = pos[1];
        const repo = pos[2] ?? fail('usage: aorch pr rule add <owner/repo|*> --workflow <name> [--comment] [--labels a,b] [--events opened,synchronize] [--drafts] [--forks] [--workspace id] [--agent a] [--model m] [--id name]   ·   aorch pr rule remove <owner/repo> [--workflow <name>]');
        const rules = [...(settings.rules ?? [])];
        if (act === 'add') {
          let rule: Rule;
          try {
            rule = parseRuleArgs(repo, v);
          } catch (e) {
            return fail((e as Error).message);
          }
          const checked = checkRuleRefs(rule, ruleRefs(cfg));
          if (checked.errors.length) fail(checked.errors.join('\n'));
          for (const w of checked.warnings) console.log(`${amber('!')} ${w}`);
          const workflow = rule.workflow;
          let next: Rule[];
          try {
            next = planRuleAdd(rules, rule).next;
          } catch (e) {
            return fail((e as Error).message);
          }
          saveSettings(cfg.home, { ...settings, rules: ensureIds(next) });
          console.log(`${green('✔')} PRs on ${bold(repo)} will run ${cyan(workflow)}${rule.comment ? ' and post the result as a comment' : ''}`);
          console.log(dim('  start listening: aorch pr watch   (polls, no setup)  ·  or point a GitHub webhook at /api/webhooks/github (see: aorch pr secret)'));
          return;
        }
        if (act === 'remove') {
          const next = rules.filter((r) => !(r.repo === repo && (!v.workflow || r.workflow === v.workflow)));
          if (next.length === rules.length) fail(`no rule for ${repo}`);
          saveSettings(cfg.home, { ...settings, rules: next });
          console.log(`${green('✔')} removed ${rules.length - next.length} rule${rules.length - next.length === 1 ? '' : 's'} for ${bold(repo)}`);
          return;
        }
        fail('usage: aorch pr rule add|remove <owner/repo> …');
      }
      if (sub === 'map') {
        const repo = pos[1] ?? fail('usage: aorch pr map <owner/repo> <folder>');
        const dir = resolve(pos[2] ?? '.');
        if (!existsSync(join(dir, '.git'))) fail(`${dir} is not a git checkout`);
        saveSettings(cfg.home, { ...settings, repos: { ...(settings.repos ?? {}), [repo.toLowerCase()]: dir } });
        console.log(`${green('✔')} ${bold(repo)} → ${dir}`);
        return;
      }
      if (sub === 'secret') {
        const { secret: sec, created } = ensureWebhookSecret(cfg.home, v.generate);
        if (created) console.log(`${green('✔')} new webhook secret saved to ${join(cfg.home, 'pr.json')}`);
        console.log(`\n  secret      ${bold(sec)}\n  payload URL ${dim('https://<your tunnel>/api/webhooks/github')}   ${dim('(content type: application/json, event: Pull requests)')}\n`);
        console.log(dim('  aorch serve listens on this machine only. To receive GitHub webhooks, expose it with a tunnel (cloudflared, ngrok, tailscale funnel).\n  Only the webhook path is reachable that way and it needs this signature; the rest of the API still refuses outside hosts.\n  No tunnel? aorch pr watch polls GitHub instead.'));
        return;
      }
      const ctx = open(v);
      if (sub === 'watch') {
        const polled = () => (loadSettings(cfg.home).rules ?? []).filter((r) => r.repo !== '*' && r.enabled !== false);
        if (!polled().length) fail('no rules to watch. Add one: aorch pr rule add <owner/repo> --workflow full-review --comment');
        const every = Math.max(20, Number(v.interval ?? 60)) * 1000;
        await banner('watching pull requests');
        for (const r of polled()) console.log(ruleLine(r));
        let busy = 0;
        let starNote = false;
        // a failure is shown and logged once per (trigger, PR, commit, reason), not on every sweep
        const lastBad = new Map<string, string>();
        const sweep = async () => {
          // rules are re-read every sweep, so enabling, disabling, editing, adding and removing apply while it runs
          const all = loadSettings(cfg.home).rules ?? [];
          if (!starNote && all.some((r) => r.repo === '*' && r.enabled !== false)) {
            starNote = true;
            console.log(dim('  note: triggers for * (any repo) only work through the webhook; polling needs a named repo'));
          }
          for (const r of polled()) {
            const list = await ghExec(cfg.home)('gh', ['pr', 'list', '-R', r.repo, '--state', 'open', '--limit', '30', '--json', 'number,headRefOid,isDraft,isCrossRepository,labels']);
            if (list.code !== 0) { console.log(`${amber('!')} ${r.repo}: ${list.stderr.trim().split('\n')[0] || 'gh failed'}`); continue; }
            let prs: { number: number; headRefOid: string; isDraft: boolean; isCrossRepository: boolean; labels: { name: string }[] }[] = [];
            try { prs = JSON.parse(list.stdout); } catch { continue; }
            for (const p of prs) {
              const ref = { provider: 'github' as const, repo: r.repo, number: p.number, url: `https://github.com/${r.repo}/pull/${p.number}` };
              if (alreadyRan(cfg.home, ref, p.headRefOid)) continue;
              const key = `${r.id ?? r.repo}#${p.number}`;
              const hit = matchRule([r], { repo: r.repo, action: (r.events ?? DEFAULT_EVENTS).includes('synchronize') ? 'synchronize' : 'opened', labels: p.labels.map((l) => l.name), draft: p.isDraft, fork: p.isCrossRepository });
              if (!hit || busy >= 2) continue;
              try {
                busy++;
                lastBad.delete(key);
                const run = await startPrRun({ home: cfg.home, engine: ctx.engine }, ref, { workflow: hit.workflow, comment: hit.comment, workspace: hit.workspace, agent: hit.agent, model: hit.model, onComment: (e) => console.log(e ? `${red('✘')} ${r.repo}#${p.number}: ${e.message}` : `${green('✔')} commented on ${r.repo}#${p.number}`) });
                recordDelivery(cfg.home, { at: new Date().toISOString(), trigger: hit.id, source: 'poll', repo: r.repo, pr: p.number, outcome: 'started', runId: run.runId });
                console.log(`${cyan('▶')} ${r.repo}#${p.number} ${dim('→ ' + hit.workflow + ' · run ' + run.runId)}`);
                void run.done.then((st) => console.log(`${st.status === 'done' ? green('✔') : red('✘')} ${r.repo}#${p.number} ${dim(st.status + ' · $' + st.costUsd.toFixed(2))}`)).finally(() => busy--);
              } catch (e) {
                busy--;
                const msg = (e as Error).message;
                const sig = `${p.headRefOid}|${msg.slice(0, 300)}`;
                if (reportOnce(lastBad, key, sig)) {
                  recordDelivery(cfg.home, { at: new Date().toISOString(), trigger: hit.id, source: 'poll', repo: r.repo, pr: p.number, outcome: classifyFailure(msg), reason: msg.slice(0, 300) });
                  console.log(`${amber('!')} ${r.repo}#${p.number}: ${msg}`);
                }
              }
            }
          }
        };
        console.log(dim(`\n  checking every ${every / 1000}s · Ctrl-C to stop\n`));
        for (;;) {
          await sweep();
          await new Promise((r) => setTimeout(r, every));
        }
      }
      // aorch pr <link>
      const ref = (() => { try { return parsePr(sub); } catch (e) { return fail((e as Error).message); } })();
      let started;
      try {
        started = await startPrRun({ home: cfg.home, engine: ctx.engine }, ref, { workflow: v.workflow ?? 'full-review', comment: v.comment, autoApprove: v['auto-approve'], trustCode: v['trust-code'], note: v.task, repoDir: v.repo ? resolve(v.repo) : undefined, onComment: (e) => console.log(e ? `${red('✘')} ${e.message}` : `${green('✔')} posted the review on ${ref.url}`) });
      } catch (e) {
        fail((e as Error).message);
      }
      console.log(`${cyan('▶')} ${bold(started.info.title)} ${dim(`#${ref.number} by ${started.info.author} · ${started.info.files.length} files${started.info.fork ? ' · from a fork' : ''}`)}`);
      return drive(ctx, started.runId, !!v.json, undefined, async () => { await started.done; });
    }
    case 'skills': {
      const cfg = loadConfig(v);
      const sub = pos[0];
      const all = [...aorchSkills(cfg.home), ...claudeSkills(resolve(v.repo ?? '.')), ...eccSkills(cfg.home)].filter((s) => !v.source || s.source === v.source || (v.source === 'claude' && s.source === 'project'));
      if (sub === 'run') {
        const name = pos[1] ?? fail('usage: aorch skills run <name> --task "<text>" [--repo <dir>]');
        const task = v.task ?? fail('--task is required');
        const repo = resolve(v.repo ?? '.');
        const skill = findSkill(all, name) ?? fail(`unknown skill "${safeText(name).slice(0, 80)}" — see: aorch skills`);
        const pipeline = skill.source === 'aorch' ? skillPipeline(skill, detectTestCommand(repo)) : skill.source === 'ecc' ? eccSkillPipeline(skill) : claudeSkillPipeline(skill);
        const ctx = open(v);
        let id: string;
        try {
          id = await ctx.engine.start({ pipeline, task, repo, autoApprove: v['auto-approve'], workspace: wsOpt(v) });
        } catch (e) {
          fail((e as Error).message);
        }
        return drive(ctx, id, !!v.json);
      }
      if (sub) fail('usage: aorch skills [--source ecc|claude|aorch] [run <name> --task "<text>"] [--json]');
      if (v.json) return console.log(JSON.stringify(all.map((k) => ({ name: k.name, source: k.source, kind: k.kind, description: k.description, steps: k.steps?.map((x) => x.role) }))));
      await banner('skills');
      const label = (k: (typeof all)[number]) => (k.source === 'aorch' ? 'workflow' : k.source === 'project' ? 'claude·project' : k.source === 'ecc' ? `ECC ${k.kind ?? 'skill'}` : 'claude');
      for (const k of all) console.log(`  ${padEndV(bold(k.name), 22)} ${dim(padEndV(label(k), 15))} ${dim(k.description)}${k.steps ? '  ' + faint(k.steps.map((x) => x.role).join(' → ')) : ''}`);
      console.log(dim(`\n  run one: aorch skills run <name> --task "…" --repo .   ·   add your own: ${join(cfg.home, 'skills')}/<name>.json`));
      return;
    }
    case 'init': {
      const cfg = loadConfig(v);
      const w = installExamples(cfg.home, examplesDir);
      await new Vault(cfg.vault).ensure();
      await banner('init');
      console.log(w.length ? `${green('✔')} installed ${bold(w.join(', '))} ${dim(`into ${cfg.home}/pipelines`)}` : `${green('✔')} example pipelines already installed`);
      console.log(`${green('✔')} vault ready  ${dim(cfg.vault)}`);
      console.log(dim('  point it at your Obsidian vault with --vault, $AORCH_VAULT, or aorch.config.json'));
      return;
    }
    case 'pipelines': {
      const cfg = loadConfig(v);
      for (const p of listPipelines(cfg.home)) console.log(`${p.name.padEnd(28)} ${p.nodes} nodes · ${p.mode}`);
      return;
    }
    case 'doctor': {
      const cfg = loadConfig(v);
      const reg = makeRegistry(cfg);
      await banner('doctor');
      const rows: string[][] = [];
      for (const id of reg.ids()) {
        const a = reg.get(id);
        const d = await a.detect();
        rows.push([
          d.ok ? green('✔') : red('✘'),
          bold(id),
          d.ok ? cyan(d.version ?? '') : dim(d.detail ?? 'unavailable'),
          d.ok ? dim(`cost ${a.reportsCost ? green('reported') : amber('unknown')}  ·  resume ${a.supportsResume ? green('yes') : dim('no')}  ·  code mode ${a.codeMode ? green(a.codeMode) : dim('direct only')}`) : '',
        ]);
      }
      console.log(box(table(rows), { title: 'agents', width: caps.cols, border: BRAND }).join('\n'));
      console.log(`\n${dim('home ')} ${cfg.home}\n${dim('vault')} ${cfg.vault}`);
      return;
    }
    case 'runs': {
      const { store } = open(v);
      const listed = store.list();
      const rows = v.all ? listed : listed.filter((r) => !r.probe);
      const probes = listed.length - rows.length;
      if (probes) console.log(dim(`${probes} Evolve probe replay${probes > 1 ? 's' : ''} hidden: aorch runs --all shows them, aorch probes --clean deletes finished ones`));
      if (!rows.length) return console.log(dim('no runs yet — try ') + cyan('aorch run demo-mock --repo . --task "…"'));
      const t = table(
        rows.slice(0, 30).map((r) => [
          statusGlyph(r.status),
          cyan(r.id),
          bold(r.pipeline),
          paint(r.status === 'done' ? pal.green : r.status === 'error' ? pal.red : pal.amber, r.status),
          usd(r.costUsd),
          dim(ago(r.startedAt)),
          dim(r.task.split('\n')[0]!.slice(0, 50)),
        ]),
      );
      console.log(box(t, { title: `runs ${faint('·')} ${rows.length}`, width: Math.min(caps.cols + 20, process.stdout.columns || 100), border: BRAND }).join('\n'));
      return;
    }
    case 'delete':
    case 'rm': {
      const ids = pos.length ? pos : fail('usage: aorch delete <runId>… [--keep-work] [--finished]');
      const ctx = open(v);
      const targets = ids[0] === 'all' && v.finished ? ctx.store.list().filter((r) => r.status === 'done' || r.status === 'error').map((r) => r.id) : ids;
      for (const id of targets) {
        try {
          await ctx.engine.deleteRun(id, { keepWork: !!v['keep-work'] });
          console.log(`${green('✔')} deleted ${id}`);
        } catch (e) {
          console.log(`${red('✘')} ${id}: ${(e as Error).message}`);
        }
      }
      return;
    }
    case 'show': {
      const id = pos[0] ?? fail('usage: aorch show <runId>');
      const { store } = open(v);
      const s = store.state(id) ?? fail(`unknown run ${id}`);
      console.log(`${gradient(s.pipeline.name, BRAND)}  ${faint(s.id)}\n${dim(s.task.split('\n')[0]!)}\n`);
      const rows = underManagers(s.pipeline.nodes).map((n) => {
        const ns = s.nodes[n.id]!;
        return [
          statusGlyph(ns.status),
          bold(spawnedLabel(n)),
          dim(n.id),
          dim(ns.status),
          ns.attempts > 1 ? amber(`↻${ns.attempts}`) : dim(`×${ns.attempts}`),
          ns.loops ? amber(`loops ${ns.loops}`) : '',
          ns.costUsd ? usd(ns.costUsd) : '',
          ns.commit ? cyan(ns.commit.slice(0, 7)) : '',
          ns.error ? red(ns.error.split('\n')[0]!.slice(0, 60)) : '',
        ];
      });
      console.log(box(table(rows), { title: 'steps', width: Math.min(caps.cols + 10, process.stdout.columns || 100), border: BRAND }).join('\n'));
      if (s.kind === 'team') {
        const lines: string[] = [`${dim('mode')} ${bold(s.mode)}${s.team?.roster ? dim(`  ·  roster ${s.team.roster.join(', ')}`) : ''}`];
        const answerOf = (id: string) => s.answers.find((a) => a.question === id) ?? s.userAsks?.find((a) => a.question.id === id)?.answer;
        for (const q of s.cards ?? []) {
          const a = answerOf(q.id);
          const open = s.pending.some((x) => x.id === q.id);
          const label = a ? safeText(a.option ? (q.options.find((o) => o.id === a.option)?.label ?? a.option) : `"${a.text}"`) : open ? amber('waiting for you') : dim('not answered');
          lines.push('', `${cyan('?')} ${safeText(q.ask).replace(/\s+/g, ' ')}${q.from ? dim(`  (asked by ${safeText(q.from)})`) : ''}`, `  ${green('→')} ${label}${a ? dim(`  by ${a.by}`) : ''}`);
        }
        console.log(box(lines, { title: 'team dialogue', width: Math.min(caps.cols + 10, process.stdout.columns || 100), border: BRAND }).join('\n'));
        if (s.plan) showPlan(s);
      }
      return summary(s);
    }
    case 'run': {
      const spec = pos[0] ?? fail('usage: aorch run <pipeline> --repo <dir> --task "<text>"');
      const task = v.task ?? fail('--task is required');
      const repo = resolve(v.repo ?? '.');
      const ctx = open(v);
      let pipeline: Pipeline;
      try {
        pipeline = existsSync(spec) ? loadPipelineFile(spec) : readPipeline(ctx.cfg.home, spec);
      } catch (e) {
        fail(`cannot load pipeline "${spec}": ${(e as Error).message}${listPipelines(ctx.cfg.home).length ? '' : ' (run `aorch init` to install examples)'}`);
      }
      for (const i of preflight(ctx.engine.resolve(pipeline), makeRegistry(ctx.cfg))) if (i.level === 'warn') console.error(yellow(`warning: ${i.node ? `[${i.node}] ` : ''}${i.message}`));
      let id: string;
      try {
        id = await ctx.engine.start({ pipeline, task, repo, ref: v.ref, autoApprove: v['auto-approve'], workspace: wsOpt(v), endpoints: v['no-endpoints'] ? false : undefined });
      } catch (e) {
        fail((e as Error).message);
      }
      if (!v.json) {
        await banner(`${pipeline.name}  ${faint('→')}  ${repo}`);
        const wsn = ctx.store.state(id)?.workspace;
        if (wsn) console.log(`${dim('project')}  ${bold(wsn.name)} ${faint('(' + wsn.id + ') — its context goes to every agent')}`);
        await typeLine(`${dim('task')}  ${s0(task)}`, 6);
        console.log('');
      }
      return drive(ctx, id, !!v.json, v.supervise ? { rounds: Number(v.rounds) || 2 } : undefined);
    }
    case 'resume': {
      const id = pos[0] ?? fail('usage: aorch resume <runId>');
      const ctx = open(v);
      try {
        await ctx.engine.resume(id, { retryFailed: v['retry-failed'] });
      } catch (e) {
        fail((e as Error).message);
      }
      console.log(`${bold('resume')} ${id}`);
      const rs = ctx.store.state(id);
      // a team run whose plan was not approved yet is planning again: there is nothing to drive, only cards or a plan
      if (rs?.kind === 'team' && !rs.pipeline.nodes.length) {
        if (rs.status !== 'running') fail(rs.error ?? `the run is ${rs.status}`);
        if (rs.pending.length) {
          for (const q of rs.pending) console.log(renderQuestion(q, Math.min(caps.cols, process.stdout.columns || 80)).join('\n') + '\n');
          console.log(`${dim('$')} ${cyan(`aorch answer ${id} ${rs.pending[0]!.id} <option>`)}`);
        } else if (rs.plan) {
          showPlan(rs);
          console.log(`\n${dim('$')} ${cyan(`aorch plan ${id}`)}${dim('   approve and start')}`);
        }
        process.exit(2);
      }
      return drive(ctx, id, !!v.json);
    }
    case 'approve': {
      const [id, node] = pos;
      if (!id || !node) fail('usage: aorch approve <runId> <node> [--reject] [--resume]');
      const ctx = open(v);
      try {
        ctx.engine.approve(id, node, !v.reject, 'cli');
      } catch (e) {
        fail((e as Error).message);
      }
      console.log(`${v.reject ? red('rejected') : green('approved')} ${node}`);
      if (v.resume) {
        await ctx.engine.resume(id);
        return drive(ctx, id, !!v.json);
      }
      console.log(dim(`continue with: aorch resume ${id}`));
      return;
    }
    case 'feedback': {
      const [id, node, rating, ...note] = pos;
      if (!id || !node || (rating !== 'up' && rating !== 'down')) fail('usage: aorch feedback <runId> <node> up|down [note…]');
      const ctx = open(v);
      try {
        ctx.engine.feedback(id, node, rating, note.join(' ') || undefined);
      } catch (e) {
        fail((e as Error).message);
      }
      console.log(`${rating === 'up' ? green('thumbs up') : red('thumbs down')} for ${node}`);
      return;
    }
    case 'lessons': {
      const cfg = loadConfig(v);
      const crew = loadCrew(cfg.home);
      const want = pos[0];
      if (want && !crew.some((b) => b.id === want)) fail(`no such bot: ${safeText(want).slice(0, 40)}`);
      const rows: Lesson[] = [];
      for (const b of crew.filter((b) => !want || b.id === want)) {
        try {
          rows.push(...loadLessons(cfg.home, b.id));
        } catch (e) {
          fail(`cannot read lessons for ${b.id}: ${(e as Error).message}`);
        }
      }
      if (v.json) return void console.log(JSON.stringify({ lessons: rows }));
      if (!rows.length) return void console.log(dim('no lessons yet: they appear after runs with rework, handoff problems or feedback'));
      for (const l of rows) {
        console.log(`${l.status === 'confident' ? green('confident') : dim('tentative')} ${bold(l.bot)} ${dim(`${l.polarity} · ${l.runs} run${l.runs === 1 ? '' : 's'} · ${l.provenance} · ${l.id}`)}`);
        console.log(`  ${safeText(l.text)}`);
      }
      return;
    }
    case 'probes': {
      const ctx = open(v);
      const probes = ctx.store.list().filter((r) => r.probe);
      const finished = probes.filter((r) => r.status !== 'running' && r.status !== 'paused' && !ctx.engine.isLive(r.id));
      if (!v.clean) {
        if (v.json) return void console.log(JSON.stringify({ probes: probes.map((r) => ({ id: r.id, status: r.status, costUsd: r.costUsd, startedAt: r.startedAt })) }));
        if (!probes.length) return void console.log(dim('no probe replays'));
        for (const r of probes.slice(0, 50)) console.log(`${statusGlyph(r.status)} ${cyan(r.id)} ${dim(r.status)} ${usd(r.costUsd)} ${dim(ago(r.startedAt))}`);
        return void console.log(dim(`${probes.length} probe replay${probes.length > 1 ? 's' : ''} · ${finished.length} finished · aorch probes --clean deletes the finished ones`));
      }
      let n = 0;
      for (const r of finished) {
        try {
          await ctx.engine.deleteRun(r.id);
          n++;
        } catch (e) {
          console.log(`${red('✘')} ${r.id}: ${safeText((e as Error).message)}`);
        }
      }
      if (v.json) return void console.log(JSON.stringify({ deleted: n, kept: probes.length - n }));
      console.log(`${green('✔')} deleted ${n} probe replay${n === 1 ? '' : 's'}${probes.length - n ? dim(` · ${probes.length - n} still running or not deletable`) : ''}`);
      return;
    }
    case 'harness': {
      const cfg = loadConfig(v);
      const [botArg, sub = 'show', a, b] = pos;
      if (!botArg) fail('usage: aorch harness <bot> [show | log | diff <a> <b> | rollback <v>] [--json]');
      try {
        const bot = findBot(cfg.home, botArg);
        if (sub === 'show') {
          const hv = harnessView(cfg.home, bot.id);
          if (v.json) return void console.log(JSON.stringify(hv));
          const h = hv.current;
          console.log(`${bold(`${safeText(bot.name)} (${bot.id})`)} ${dim(`harness v${h.version}${h.note ? ` · ${safeText(h.note)}` : ''} · ${hv.total} version${hv.total === 1 ? '' : 's'}${hv.evolvable ? '' : ' · not evolvable'}`)}`);
          console.log(`${dim('persona ')} ${safeText(h.persona)}`);
          console.log(dim('guidance'));
          for (const g of h.guidance) console.log(`  - ${safeText(g)}`);
          if (!h.guidance.length) console.log(dim('  (none)'));
          console.log(`${dim('skills  ')} ${h.skills.map(safeText).join(', ') || dim('(none)')}`);
          return;
        }
        if (sub === 'log') {
          const vs = listVersions(cfg.home, bot);
          const changes = readChangelog(cfg.home, bot.id);
          if (v.json) return void console.log(JSON.stringify({ bot: bot.id, versions: vs.map((h) => ({ version: h.version, at: h.at, note: h.note, base: h.base })), changelog: changes }));
          if (!vs.length) return void console.log(dim(`${bot.id} has no stored harness yet: v1 is made from its definition at its first run`));
          const top = vs.at(-1)!.version;
          for (const h of vs) console.log(`${h.version === top ? green('●') : dim('○')} ${bold(`v${h.version}`)} ${dim(h.at)} ${h.base !== undefined ? dim(`from v${h.base}`) : ''} ${h.note ? safeText(h.note) : ''}`);
          if (changes.length) {
            console.log(dim('changelog'));
            for (const c of changes.slice(-20)) console.log(`  ${dim(c.at)} ${c.action === 'adopted' ? green('adopted') : amber('rollback')} v${c.version} ${dim(c.action === 'adopted' ? `from v${c.base} · ${safeText(c.proposal ?? '')} · edits ${(c.picked ?? []).join(',')}` : `copy of v${c.to} (was v${c.base})`)}`);
          }
          return;
        }
        if (sub === 'diff') {
          const na = a !== undefined ? versionArg(a) : undefined;
          const nb = b !== undefined ? versionArg(b) : undefined;
          if (na === undefined || nb === undefined) fail('usage: aorch harness <bot> diff <a> <b>   (versions, like 1 3 or v1 v3)', 2);
          const ha = getVersion(cfg.home, bot, na);
          const hb = getVersion(cfg.home, bot, nb);
          if (!ha || !hb) fail(`${bot.id} has no version v${!ha ? na : nb}`);
          const d = diffHarness(ha, hb);
          if (v.json) return void console.log(JSON.stringify({ bot: bot.id, from: na, to: nb, edits: d }));
          if (!d.length) return void console.log(dim(`v${na} and v${nb} are the same`));
          for (const e of d) printEdit(e);
          return;
        }
        if (sub === 'rollback') {
          const n = a !== undefined ? versionArg(a) : undefined;
          if (n === undefined) fail('usage: aorch harness <bot> rollback <version>', 2);
          const h = revert(cfg.home, bot.id, n);
          if (v.json) return void console.log(JSON.stringify({ harness: h }));
          return void console.log(`${green('✔')} ${bot.id} harness is now v${h.version} (a copy of v${n}); the next run uses it`);
        }
        fail(`unknown harness command "${safeText(sub).slice(0, 20)}": show, log, diff <a> <b> or rollback <v>`, 2);
      } catch (e) {
        fail(safeText(scrubPaths((e as Error).message, cfg.home)));
      }
      return;
    }
    case 'evolve': {
      if (v.accept !== undefined || v.reject || v.show !== undefined) return evolveDecide(v, pos);
      const botId = pos[0] ?? fail('usage: aorch evolve <bot> [--since <date>] [--agent a] [--model m] [--json]');
      if (v.list) return evolveList(botId, v);
      if (v.probe) return evolveProbe(botId, v);
      const cfg = loadConfig(v);
      const bot = loadCrew(cfg.home).find((b) => b.id === botId) ?? fail(`no such bot: ${safeText(botId).slice(0, 40)}`);
      const r = await proposeFor({ home: cfg.home, bot, registry: makeRegistry(cfg), agent: v.agent, model: v.model, since: v.since });
      if (v.json) return void console.log(JSON.stringify({ ...(r.proposal ? { proposal: r.proposal } : {}), ...(r.reason ? { reason: r.reason } : {}), ...(r.dropped?.length ? { dropped: r.dropped.map((d) => d.reason) } : {}), ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}) }));
      if (!r.proposal) {
        console.log(`${dim('no proposal:')} ${safeText(r.reason ?? 'unknown')}`);
        for (const d of r.dropped ?? []) console.log(dim(`  dropped: ${safeText(d.reason)}`));
        if (r.costUsd !== undefined) console.log(dim(`editor cost ${usd(r.costUsd)}`));
        return;
      }
      if (r.reason) console.log(dim(safeText(r.reason)));
      for (const line of renderProposal(r.proposal, bot, loadLessons(cfg.home, bot.id), baselinePersona(cfg.home, bot))) console.log(line.startsWith('-') ? red(line) : line.startsWith('+') ? green(line) : line);
      for (const d of r.dropped ?? []) console.log(dim(`  dropped: ${safeText(d.reason)}`));
      if (r.costUsd !== undefined) console.log(dim(`editor cost ${usd(r.costUsd)}`));
      return;
    }
    case 'vault': {
      const sub = pos[0];
      const cfg = loadConfig(v);
      const vault = new Vault(cfg.vault);
      if (sub === 'search') {
        const q = pos.slice(1).join(' ') || fail('usage: aorch vault search "<query>"');
        for (const h of await vault.search(q, 10)) console.log(`${h.score.toFixed(1).padStart(5)}  ${h.note.path}${h.note.type ? dim(` (${h.note.type})`) : ''}`);
        return;
      }
      if (sub === 'stats') {
        const g = await vault.graph();
        const types = new Map<string, number>();
        for (const n of g.nodes) types.set(n.type ?? 'note', (types.get(n.type ?? 'note') ?? 0) + 1);
        console.log(`${g.nodes.length} notes · ${g.edges.length} links · ${g.unresolved} unresolved\n${[...types].map(([t, n]) => `  ${t}: ${n}`).join('\n')}\n${dim(vault.root)}`);
        return;
      }
      return fail('usage: aorch vault search "<query>" | aorch vault stats');
    }
    case 'serve': {
      const ctx = await serveTether({ home: v.home, vault: v.vault, host: v.host, port: v.port ? Number(v.port) : 4177, webDir, examplesDir });
      const { url } = ctx;
      await banner('dashboard + API');
      console.log(
        box(
          [
            `${green('●')} ${bold('listening')}  ${cyan(url)}  ${dim('loopback only')}`,
            `${dim('home ')}  ${ctx.cfg.home}`,
            `${dim('vault')}  ${ctx.cfg.vault}`,
            ...(existsSync(webDir) ? [] : [amber('dashboard not built — run `npm run build:web`')]),
          ],
          { title: 'aorch serve', width: caps.cols, border: BRAND },
        ).join('\n'),
      );
      process.on('SIGINT', () => {
        ctx.stopLive();
        setTimeout(() => process.exit(0), 1500).unref();
      });
      return;
    }
    default:
      fail(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main().catch((e) => fail((e as Error).message));
