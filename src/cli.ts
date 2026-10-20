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
import { CREW_STYLES, crewStyle, setCrewStyle } from './bots.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { CREW, botSays, crewFor, miniBot, moodFor, renderBot, type Mood } from './bots.js';
import { THEMES, registerThemes, setTheme, themeName } from './ui.js';
import { LiveBoard, ago, amber, banner, bold, box, caps, clock, cyan, dim, dur, faint, glyph, gradient, green, meter, pal, paint, red, resultCard, table, typeLine, usd, vlen, BRAND } from './ui.js';

const yellow = amber;
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
  aorch skills [run <name> --task "…"]                                list or run skills (Claude Code skills + aorch workflows)
  aorch models [agent]                list what each agent can run (local servers included)
  aorch crew [classic|pebble]         bot style: classic, or minimal pebble bots
  aorch theme [name]                  aurora · sunset · matrix · amber · mono
  aorch runs                          list runs
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
      case 'node.skipped':
        say(`${ts()}  ${dim('◌')} ${name(e.node)} ${dim(`skipped: ${e.reason}`)}`);
        break;
      case 'approval.requested':
        say(`${ts()}  ${amber('◉')} ${name(e.node)} ${amber('waiting for approval')}`);
        break;
      case 'node.amended':
        say(`${ts()}  ${amber('⇄')} ${name(e.node)} ${dim('now runs on')} ${cyan(e.agent ?? '')}${e.model ? dim(' · ' + e.model) : ''}`);
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

async function drive(ctx: Ctx, runId: string, json: boolean, sup?: { rounds: number }): Promise<never> {
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
        id = await ctx.engine.start({ pipeline: comp.pipeline, task, repo, autoApprove: v['auto-approve'] });
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
      const roleOf = (q: string) => (q.toLowerCase() === 'escalate' ? 'escalate' : undefined) ?? Object.entries(CREW).find(([k, c]) => k === q.toLowerCase() || c.name.toLowerCase() === q.toLowerCase())?.[0];
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
          id = await ctx.engine.start({ pipeline, task, repo, autoApprove: v['auto-approve'] });
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
    case 'show': {
      const id = pos[0] ?? fail('usage: aorch show <runId>');
      const { store } = open(v);
      const s = store.state(id) ?? fail(`unknown run ${id}`);
      console.log(`${gradient(s.pipeline.name, BRAND)}  ${faint(s.id)}\n${dim(s.task.split('\n')[0]!)}\n`);
      const rows = s.pipeline.nodes.map((n) => {
        const ns = s.nodes[n.id]!;
        return [
          statusGlyph(ns.status),
          bold(n.title ?? n.role ?? n.kind),
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
        id = await ctx.engine.start({ pipeline, task, repo, ref: v.ref, autoApprove: v['auto-approve'] });
      } catch (e) {
        fail((e as Error).message);
      }
      if (!v.json) {
        await banner(`${pipeline.name}  ${faint('→')}  ${repo}`);
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
