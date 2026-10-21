#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { installExamples, loadConfig, resolveHome, writePipeline, makeRegistry, readPipeline, listPipelines, type Config } from './config.js';
import { Engine } from './engine.js';
import { loadPipelineFile, preflight } from './pipeline.js';
import { startServer } from './server.js';
import { Store } from './store.js';
import type { Pipeline, RunState, StoredEvent } from './types.js';
import { Vault } from './vault.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const examplesDir = resolve(here, '../examples/pipelines');
const webDir = resolve(here, '../web/dist');

import { link, loadBindings, unlink } from './bindings.js';
import { runTui } from './tui.js';
import { composePipeline, detectTestCommand, diagnoseFailure } from './composer.js';
import { aorchSkills, claudeSkillPipeline, claudeSkills, skillPipeline } from './skills.js';
import { supervise } from './supervisor.js';
import { CREW_STYLES, crewStyle, refreshCrew, setCrewStyle } from './bots.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { loadCrew, saveBot, removeBot, freshId, sanitizeBot, toFile, BOT_KINDS, LOOK_PARTS, PART_KEYS, BUILTIN_IDS, type BotDef } from './crew.js';
import { PACKS, findPack, parseBots, reid } from './packs.js';
import { createInterface } from 'node:readline/promises';
import { renderLook } from './bots.js';
import { ago as agoRel, refusal, reportOnce, ensureWebhookSecret, checkRuleRefs, checkWorkflow, dryRunVerdict, planRuleAdd, classifyFailure, ensureIds, explainMatch, findRule, formatTriggerLine, lastDelivery, parsePrTarget, parseRuleArgs, readDeliveries, recordDelivery, statusText, triggerStatus } from './triggers.js';
import { DEFAULT_EVENTS, alreadyRan, defaultExec, fetchPr, loadSettings, matchRule, parsePr, pipelineFor, saveSettings, startPrRun, type Rule } from './pr.js';
import { fetchUsage, spendNano, supportsUsage, usd as usdOf } from './usage.js';
import { PRESETS, updateEndpoint, addEndpoint, baseUrlOf, keyRef, providerName, listProviders, removeEndpoint } from './providers.js';
import { SURVEY_PROMPT, addToList, contextOf, getWorkspace, initWorkspace, listWorkspaces, removeWorkspace, resolveWorkspace, setDefaultWorkspace, updateMeta, writeNotes } from './workspace.js';
import { normalizePipeline } from './pipeline.js';
import { CREW, botSays, crewFor, miniBot, moodFor, renderBot, type Mood } from './bots.js';
import { THEMES, registerThemes, setTheme, themeName, spawnedLabel, underManagers } from './ui.js';
import { LiveBoard, ago, amber, banner, bold, box, caps, clock, cyan, dim, dur, faint, glyph, gradient, green, meter, pal, paint, red, resultCard, table, typeLine, usd, vlen, BRAND } from './ui.js';

const yellow = amber;
/** --workspace <id> picks one; --no-workspace runs without project context. */
const wsOpt = (v: { workspace?: string; 'no-workspace'?: boolean }): string | false | undefined => (v['no-workspace'] ? false : v.workspace);
const padEndV = (x: string, w: number) => x + ' '.repeat(Math.max(0, w - vlen(x)));
const s0 = (t: string) => bold(t.split('\n')[0]!.slice(0, 90));

const HELP = `aorch — durable orchestrator for CLI coding agents

Usage
  aorch run <pipeline> --repo <dir> --task "<text>" [--auto-approve] [--ref <git-ref>]
  aorch run ... [--supervise [--rounds 2]]   Maestro retries, then escalates the failing step to a stronger model
  aorch resume <runId> [--retry-failed]
  aorch approve <runId> <node> [--reject] [--resume]
  aorch                               interactive dashboard (runs, workflows, agent sessions)
  aorch orchestrate "<task>" --repo <dir> [--yes]   Maestro designs a workflow for the task and runs it
  aorch bots [link <bot> <agent> [model] | unlink <bot> | gallery]   link crew members to Claude, Codex, OpenCode or a local model
  aorch pr <link> [--workflow full-review] [--comment]               run a workflow on a GitHub PR (also: pr rules | rule add | watch | secret | map)
  aorch triggers [list|add|enable|disable|remove|show|log|test|setup]   PR triggers: which PRs start which workflow, where, with which agent (add <owner/repo|*> --workflow w [--workspace id] [--agent a] [--model m] [--events …] [--labels …] [--comment] [--drafts] [--forks] [--id name] · log [id] [--limit n] · test <id> <pr> [--fire] · setup)
  aorch skills [run <name> --task "…"]                                list or run skills (Claude Code skills + aorch workflows)
  aorch models [agent]                list what each agent can run (local servers included)
  aorch crew [style]                  bot style: pebble · classic · sigil · tile · ticker · orbit
  aorch usage [provider] [--days 7]   spend and tokens from a provider's Spend API (Experiential Labs)
  aorch providers [list|add|remove]   LLM providers: see what is set up, add DeepSeek / OpenRouter / your own server
  aorch theme [name]                  aurora · sunset · matrix · amber · mono
  aorch runs                          list runs
  aorch delete <runId>…               delete runs, their worktrees and chats (--keep-work keeps branch + files; 'all --finished' clears done/failed runs)
  aorch show <runId>                  node table, cost, coach findings
  aorch serve [--port 4177]           API + dashboard (loopback only)
  aorch doctor                        which agent CLIs are installed
  aorch init                          install example pipelines
  aorch pipelines                     list saved pipelines
  aorch vault search "<query>"        query the knowledge graph
  aorch vault stats

<pipeline> is a saved name or a path to a .json/.yaml file.
Global flags: --home <dir> (default ~/.aorch, or $AORCH_HOME)  --vault <dir> (default <home>/vault, or $AORCH_VAULT)
Exit codes: 0 done · 1 error/stopped · 2 paused (waiting for approval)`;

function prettyHelp(): string {
  return HELP.split('\n')
    .slice(1)
    .map((l) => {
      if (/^(Usage|Global flags|Exit codes)/.test(l)) return l.replace(/^(\w[\w ]*?)(:|$)/, (m) => bold(gradient(m, BRAND)));
      const m = l.match(/^(  aorch \S+(?: \S+)?)(.*)$/);
      if (m) return `${cyan(m[1]!)}${m[2]!.replace(/(<[^>]+>)/g, (x) => paint(pal.violet, x)).replace(/(--[\w-]+)/g, (x) => amber(x)).replace(/(\s{2,}[A-Za-z].*)$/, (x) => dim(x))}`;
      return dim(l);
    })
    .join('\n');
}

function applyTheme(flag?: string, crewFlag?: string) {
  const prefs = loadPrefs(resolveHome());
  registerThemes(prefs.themes);
  const name = flag ?? process.env.AORCH_THEME ?? prefs.theme;
  if (name && !setTheme(name)) {
    console.error(`unknown theme "${name}" — options: ${Object.keys(THEMES).join(', ')}`);
    process.exit(1);
  }
  const crew = crewFlag ?? process.env.AORCH_CREW ?? prefs.crew;
  if (crew && !setCrewStyle(crew)) {
    console.error(`unknown crew style "${crew}" — options: ${Object.keys(CREW_STYLES).join(', ')}`);
    process.exit(1);
  }
}

/** Static gallery of the crew in every mood; animates for a few seconds on a TTY. */
async function gallery() {
  const roles = Object.keys(CREW);
  const moods: Mood[] = ['idle', 'working', 'happy', 'sad'];
  const draw = (tick: number) => {
    const rows: string[] = [];
    rows.push('  ' + roles.map((r) => padEndV(bold(CREW[r]!.name), 13)).join(''));
    rows.push('  ' + roles.map((r) => padEndV(dim(CREW[r]!.title), 13)).join(''));
    for (const m of moods) {
      rows.push(dim(`  ${m}`));
      const bots = roles.map((r) => renderBot(r, m, tick));
      for (let i = 0; i < 4; i++) rows.push('  ' + bots.map((b) => b[i] + '   ').join(''));
    }
    return rows;
  };
  await banner('meet the crew');
  if (!caps.animate) return console.log(draw(0).join('\n'));
  const frame0 = draw(0);
  process.stdout.write('\x1b[?25l' + frame0.join('\n') + '\n');
  for (let t = 1; t < 60; t++) {
    await new Promise((r) => setTimeout(r, 90));
    const f = draw(t);
    process.stdout.write(`\x1b[${f.length}A` + f.join('\n') + '\n');
  }
  process.stdout.write('\x1b[?25h');
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

interface Ctx {
  cfg: Config;
  store: Store;
  engine: Engine;
  vault: Vault;
}

function open(flags: { home?: string; vault?: string }): Ctx {
  const cfg = loadConfig({ home: flags.home, vault: flags.vault });
  refreshCrew(cfg.home);
  const store = Store.open(join(cfg.home, 'runs.db'));
  const vault = new Vault(cfg.vault);
  const engine = new Engine(store, { home: cfg.home, registry: makeRegistry(cfg), vault, bindings: () => loadBindings(cfg.home) });
  return { cfg, store, engine, vault };
}

/** Print one line per meaningful event while a run executes in this process. */
function narrate(store: Store, runId: string, json: boolean): { off: () => void; stop: () => void } {
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
  return { off, stop: () => live?.stop() };
}

function summary(s: RunState) {
  const extra: string[] = [];
  if (s.coach?.length) {
    extra.push('', `${amber('◆')} ${bold('coach')}`);
    for (const f of s.coach) extra.push(`  ${amber('•')} ${bold(f.title)}`, `    ${f.detail}`, `    ${dim('→ ' + f.action)}`);
  }
  if (s.status === 'paused') {
    const waiting = Object.entries(s.nodes).filter(([, n]) => n.status === 'awaiting').map(([id]) => id);
    extra.push('', `${amber('◉')} waiting for approval: ${bold(waiting.join(', '))}`, `  ${dim('$')} ${cyan(`aorch approve ${s.id} ${waiting[0]} --resume`)}`);
  } else if (s.status === 'stopped' || s.status === 'error') {
    extra.push('', `${dim('$')} ${cyan(`aorch resume ${s.id}`)}${s.status === 'error' ? dim('   re-runs only the failed branch') : ''}`);
  }
  console.log('');
  console.log(resultCard(s, extra).join('\n'));
}

const exitFor = (s: RunState) => (s.status === 'done' ? 0 : s.status === 'paused' ? 2 : 1);

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
    : await ctx.engine.wait(runId);
  view.off();
  view.stop();
  if (after) await after(s);
  if (!json) summary(s);
  else console.log(JSON.stringify({ id: s.id, status: s.status, costUsd: s.costUsd, error: s.error }));
  process.exit(exitFor(s));
}

async function main() {
  const argv = process.argv.slice(2);
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
      crew: { type: 'string' },
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
    },
  });
  applyTheme(v.theme, v.crew);

  switch (cmd) {
    case 'tui': {
      const ctx = open(v);
      installExamples(ctx.cfg.home, examplesDir);
      await ctx.vault.ensure();
      await runTui({ cfg: ctx.cfg, store: ctx.store, engine: ctx.engine });
      process.exit(0);
    }
    case 'orchestrate': {
      const task = pos.join(' ').trim() || v.task || fail('usage: aorch orchestrate "<what you want done>" --repo <dir> [--yes] [--rules-only]');
      const repo = resolve(v.repo ?? '.');
      const ctx = open(v);
      await banner('orchestrator bot');
      const think = botSays('orchestrator', 'Reading your task and designing a workflow…', 'working', 0, 70);
      if (caps.animate) console.log(think.join('\n'));
      const maestro = loadBindings(ctx.cfg.home).orchestrator;
      const comp = await composePipeline(task, { repo, registry: makeRegistry(ctx.cfg), heuristicOnly: v['rules-only'], agent: maestro?.agent, model: maestro?.model });
      if (caps.animate) process.stdout.write(`\x1b[${think.length}A\x1b[J`);
      console.log(botSays('orchestrator', comp.rationale, 'happy', 0, 76).join('\n'));
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
    case 'bots': {
      const sub = pos[0];
      if (sub === 'gallery') return gallery();
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
          for (const row of renderLook(b.look, 'idle', 0)) console.log('  ' + row);
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
        return [miniBot(role, 'idle', 0), bold(paint(c.color(), c.name)), dim(c.title), bd ? `${cyan(agent)}${bd.model ? dim(' · ' + bd.model) : ''}` : dim('claude (default)'), role === 'approval' ? '' : det[agent] ? green('✔ ready') : red('✘ unavailable')];
      });
      const esc = b.escalate;
      rows.push([dim('  ⇧  '), bold(paint(pal.amber, 'escalate')), dim('on repeat failure'), esc ? `${cyan(esc.agent)}${esc.model ? dim(' · ' + esc.model) : ''}` : dim('claude · opus (default)'), '']);
      console.log(box(table(rows), { title: 'crew ↔ models', width: caps.cols, border: BRAND }).join('\n'));
      console.log(dim(`\n  aorch bots link <bot> <agent> [model]   ·   aorch bots unlink <bot>   ·   aorch models   ·   aorch bots gallery`));
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
    case 'crew': {
      const cfg = loadConfig(v);
      const pick = pos[0];
      if (pick) {
        if (!setCrewStyle(pick)) fail(`unknown crew style "${pick}" — options: ${Object.keys(CREW_STYLES).join(', ')}`);
        savePrefs(cfg.home, { crew: pick });
      }
      await banner(`crew style: ${crewStyle}`);
      const keep = crewStyle;
      for (const [n, label] of Object.entries(CREW_STYLES)) {
        setCrewStyle(n);
        const row = Object.keys(CREW).map((r) => renderBot(r, 'idle', 0));
        console.log(`  ${n === keep ? green('●') : dim('○')} ${bold(n)}  ${dim(label)}`);
        for (let i = 0; i < 4; i++) console.log('    ' + row.map((b) => b[i] + '  ').join(''));
        console.log('');
      }
      setCrewStyle(keep);
      console.log(dim('  switch with: aorch crew <name>   or per run: --crew <name> / AORCH_CREW   (c in the dashboard)'));
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
      fail('usage: aorch workspace [list | init [dir] | add [dir] | show [id] | context [id] | set [id] --summary … | survey [id] | use <id> | remove <id>]');
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
            const list = await defaultExec('gh', ['pr', 'list', '-R', r.repo, '--state', 'open', '--limit', '30', '--json', 'number,headRefOid,isDraft,isCrossRepository,labels']);
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
      const all = [...aorchSkills(cfg.home), ...claudeSkills(resolve(v.repo ?? '.'))];
      if (sub === 'run') {
        const name = pos[1] ?? fail('usage: aorch skills run <name> --task "<text>" [--repo <dir>]');
        const task = v.task ?? fail('--task is required');
        const repo = resolve(v.repo ?? '.');
        const skill = all.find((k) => k.name === name) ?? fail(`unknown skill "${name}" — see: aorch skills`);
        const pipeline = skill.source === 'aorch' ? skillPipeline(skill, detectTestCommand(repo)) : claudeSkillPipeline(skill);
        const ctx = open(v);
        let id: string;
        try {
          id = await ctx.engine.start({ pipeline, task, repo, autoApprove: v['auto-approve'], workspace: wsOpt(v) });
        } catch (e) {
          fail((e as Error).message);
        }
        return drive(ctx, id, !!v.json);
      }
      if (sub) fail('usage: aorch skills [run <name> --task "<text>"] [--json]');
      if (v.json) return console.log(JSON.stringify(all.map((k) => ({ name: k.name, source: k.source, description: k.description, steps: k.steps?.map((x) => x.role) }))));
      await banner('skills');
      for (const k of all) console.log(`  ${padEndV(bold(k.name), 22)} ${dim(padEndV(k.source === 'aorch' ? 'workflow' : k.source === 'project' ? 'claude·project' : 'claude', 15))} ${dim(k.description)}${k.steps ? '  ' + faint(k.steps.map((x) => x.role).join(' → ')) : ''}`);
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
          d.ok ? dim(`cost ${a.reportsCost ? green('reported') : amber('unknown')}  ·  resume ${a.supportsResume ? green('yes') : dim('no')}`) : '',
        ]);
      }
      console.log(box(table(rows), { title: 'agents', width: caps.cols, border: BRAND }).join('\n'));
      console.log(`\n${dim('home ')} ${cfg.home}\n${dim('vault')} ${cfg.vault}`);
      return;
    }
    case 'runs': {
      const { store } = open(v);
      const rows = store.list();
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
        id = await ctx.engine.start({ pipeline, task, repo, ref: v.ref, autoApprove: v['auto-approve'], workspace: wsOpt(v) });
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
      const ctx = open(v);
      installExamples(ctx.cfg.home, examplesDir);
      await ctx.vault.ensure();
      const { url } = await startServer({
        engine: ctx.engine,
        store: ctx.store,
        vault: ctx.vault,
        registry: makeRegistry(ctx.cfg),
        cfg: ctx.cfg,
        host: v.host,
        port: v.port ? Number(v.port) : 4177,
        webDir,
      });
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
        for (const r of ctx.store.list()) if (ctx.engine.isLive(r.id)) ctx.engine.stop(r.id);
        setTimeout(() => process.exit(0), 1500).unref();
      });
      return;
    }
    default:
      fail(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main().catch((e) => fail((e as Error).message));
