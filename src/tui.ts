/**
 * Interactive full-screen terminal app. `aorch` with no arguments opens it.
 *
 *   dashboard  (all runs · all workflows · the crew)
 *     └─ run view      (the crew working through a run; approve, stop, resume)
 *          └─ session  (one agent's live output / events / diff; attach to its agent's own session or open a shell)
 *   workflow editor    (arrange, add, remove steps; edit step settings; save; run)
 *   orchestrator bot   (describe a task, Maestro designs the workflow, you approve it, it runs)
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyBindings, link, loadBindings, unlink, type Bindings } from './bindings.js';
import { CREW_STYLES, crewStyle, setCrewStyle } from './bots.js';
import { deleteTheme, loadPrefs, savePrefs, type Prefs } from './prefs.js';
import { recent, type Activity, type Verb } from './activity.js';
import { Pulse, costSeries, stepDurations } from './metrics.js';
import { jumpPoints, parseDiff, renderSplit, renderUnified, summary as diffSummary, type ParsedDiff } from './diffview.js';
import { contrast, nudge, parseHex, rgbToHsl, toHex } from './color.js';
import { sampleRun } from './sample.js';
import { CREW, botSays, crewFor, miniBot, moodFor, renderBot, type Mood } from './bots.js';
import { supervise } from './supervisor.js';
import { TEMPLATES, STEP_BLURB, STEP_TYPES, addStep, blankPipeline, composePipeline, diagnoseFailure, fromTemplate, moveStep, removeStep, stepType, detectTestCommand, relink, type Composition, type StepType, type Template } from './composer.js';
import { listPipelines, makeRegistry, readPipeline, writePipeline, type Config } from './config.js';
import type { Engine } from './engine.js';
import { commitDiff, diffCommitted } from './git.js';
import { NAME_RE, normalizePipeline, preflight } from './pipeline.js';
import type { Store } from './store.js';
import type { Pipeline, PipelineNode, RunState } from './types.js';
import { PAL_KEYS, THEMES, BRAND, THEME_NAME_RE, BUILTIN_THEMES, applyPalette, basePalette, registerThemes, spark, type PalKey, type RGB, ago, amber, bold, caps, clip, cyan, dim, dur, faint, glyph, gradient, green, meter, padEnd, paint, pal, red, renderBoard, setTheme, strip, themeName, usd, vlen } from './ui.js';

const ESC = '\x1b[';

// ---------- keys ----------
export function parseKeys(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  const table: Record<string, string> = {
    '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left', '[H': 'home', '[F': 'end', '[Z': 'shift-tab', '[5~': 'pgup', '[6~': 'pgdn', '[1;2C': 'shift-right', '[1;2D': 'shift-left', '[3~': 'delete', OA: 'up', OB: 'down', OC: 'right', OD: 'left',
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\x1b') {
      const rest = s.slice(i + 1);
      const hit = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((k) => rest.startsWith(k));
      if (hit) {
        out.push(table[hit]!);
        i += 1 + hit.length;
      } else {
        out.push('esc');
        i += 1;
      }
    } else if (ch === '\r' || ch === '\n') (out.push('enter'), i++);
    else if (ch === '\t') (out.push('tab'), i++);
    else if (ch === '\x7f' || ch === '\b') (out.push('backspace'), i++);
    else if (ch === '\x03') (out.push('ctrl-c'), i++);
    else if (ch === '\x15') (out.push('ctrl-u'), i++);
    else {
      const cp = String.fromCodePoint(s.codePointAt(i)!);
      out.push(cp);
      i += cp.length;
    }
  }
  return out;
}

// ---------- small layout helpers ----------
const padCenter = (s: string, w: number) => {
  const n = vlen(s);
  if (n >= w) return clip(s, w);
  const l = Math.floor((w - n) / 2);
  return ' '.repeat(l) + s + ' '.repeat(w - n - l);
};
const wrap = (text: string, w: number): string[] => {
  const out: string[] = [];
  for (const raw of strip(text).split('\n')) {
    let line = raw.replace(/\t/g, '  ');
    if (!line) out.push('');
    while (line.length > w) (out.push(line.slice(0, w)), (line = line.slice(w)));
    if (line) out.push(line);
  }
  return out;
};
const rule = (w: number, label = '') => faint('─'.repeat(2)) + (label ? ` ${dim(label)} ` : '') + faint('─'.repeat(Math.max(0, w - 4 - (label ? vlen(label) + 2 : 0))));

const VERB_COLOR: Record<Verb, RGB> = {
  get read() { return pal.blue; },
  get edit() { return pal.green; },
  get run() { return pal.amber; },
  get search() { return pal.cyan; },
  get fetch() { return pal.violet; },
  get think() { return pal.pink; },
  get say() { return pal.text; },
  get note() { return pal.gray; },
  get tool() { return pal.gray; },
};

const CELL = 13;
/** The crew laid out as a chain: one animated bot per step, with arrows between them. */
export function crewStrip(nodes: PipelineNode[], statusOf: (n: PipelineNode) => string, sel: number, tick: number, width: number, annot?: (n: PipelineNode) => string): string[] {
  const per = Math.max(1, Math.floor(width / CELL));
  const start = Math.max(0, Math.min(Math.max(0, nodes.length - per), sel - Math.floor(per / 2)));
  const view = nodes.slice(start, start + per);
  const rows: string[][] = [[], [], [], [], [], [], []];
  view.forEach((n, vi) => {
    const i = start + vi;
    const st = statusOf(n);
    const role = crewFor(n);
    const bot = renderBot(role, moodFor(st), tick + i * 5);
    const selected = i === sel;
    const last = vi === view.length - 1;
    for (let r = 0; r < 4; r++) rows[r]!.push(bot[r]! + (last ? '   ' : r === 2 ? faint(' ━▸') : '   '));
    const name = CREW[role]!.name;
    rows[4]!.push(padCenter(selected ? bold(paint(pal.cyan, `‹ ${name} ›`)) : bold(name), CELL));
    rows[5]!.push(padCenter(dim(n.title ?? n.role ?? n.kind), CELL));
    rows[6]!.push(padCenter(`${glyph(st, tick)} ${annot ? annot(n) : dim(st)}`, CELL));
  });
  const lines = rows.map((r) => r.join(''));
  if (start > 0) lines[2] = dim('◂') + lines[2]!.slice(1);
  return lines;
}

// ---------- state ----------
type Tab = 'runs' | 'workflows' | 'crew' | 'settings';
const TABS: Tab[] = ['runs', 'workflows', 'crew', 'settings'];

interface Prompt { kind: 'prompt'; title: string; hint?: string; value: string; /** value is a suggestion: the first keystroke replaces it */ fresh?: boolean; onSubmit: (v: string) => void }
interface Menu { kind: 'menu'; title: string; items: { label: string; hint?: string; value: string }[]; sel: number; onPick: (v: string) => void }
interface Confirm { kind: 'confirm'; title: string; onYes: () => void }
type Modal = Prompt | Menu | Confirm;

type Screen =
  | { kind: 'dash'; tab: Tab; sel: Record<Tab, number> }
  | { kind: 'run'; runId: string; sel: number }
  | { kind: 'session'; runId: string; nodeId: string; pane: 'output' | 'events' | 'diff'; scroll: number; follow: boolean; diff?: string; diffAll?: boolean; layout?: 'unified' | 'split'; parsed?: { src: string; p: ParsedDiff } }
  | { kind: 'theme'; prev: string; pal: Record<PalKey, RGB>; sel: number; dirty: boolean }
  | { kind: 'editor'; pipeline: Pipeline; saved: boolean; dirty: boolean; sel: number; stray?: boolean }
  | { kind: 'plan'; comp?: Composition; task: string; repo: string; error?: string };

export interface TuiDeps {
  cfg: Config;
  store: Store;
  engine: Engine;
}

export class Tui {
  private stack: Screen[] = [{ kind: 'dash', tab: 'runs', sel: { runs: 0, workflows: 0, crew: 0, settings: 0 } }];
  private prefs: Prefs;
  private readonly pulse = new Pulse();
  private unsub?: () => void;
  private metricCache?: { key: string; series: number[] };
  private modal?: Modal;
  private toast?: { text: string; tone: 'ok' | 'err'; until: number };
  private tick = 0;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private done?: () => void;
  private readonly registry: ReturnType<typeof makeRegistry>;
  private lastRender: string[] = [];
  private avail: Record<string, { ok: boolean; detail?: string; version?: string; models: string[] }> = {};
  private availAt = 0;

  constructor(private readonly d: TuiDeps, private readonly out: NodeJS.WriteStream = process.stdout) {
    this.registry = makeRegistry(d.cfg);
    this.prefs = loadPrefs(d.cfg.home);
  }

  private setPref(patch: Prefs) {
    this.prefs = savePrefs(this.d.cfg.home, patch);
  }

  private bindings(): Bindings {
    return loadBindings(this.d.cfg.home);
  }

  /** Probe every adapter (installed? server up? which models?) without blocking the UI. */
  private refreshAvail() {
    this.availAt = Date.now();
    for (const id of this.registry.ids().filter((i) => i !== 'mock')) {
      const a = this.registry.get(id);
      a.detect().then(
        async (d) => {
          const models = d.ok && a.listModels ? await a.listModels().catch(() => []) : [];
          this.avail[id] = { ok: d.ok, detail: d.detail, version: d.version, models };
        },
        () => (this.avail[id] = { ok: false, detail: 'probe failed', models: [] }),
      );
    }
  }

  private get screen(): Screen {
    return this.stack[this.stack.length - 1]!;
  }
  private get cols() {
    return Math.max(60, this.out.columns || 100);
  }
  private get rows() {
    return Math.max(20, this.out.rows || 32);
  }

  // ---------- lifecycle ----------
  async run(): Promise<void> {
    if (!process.stdin.isTTY) throw new Error('the interactive dashboard needs a terminal (TTY)');
    await new Promise<void>((resolveDone) => {
      this.done = resolveDone;
      this.enter();
      this.refreshAvail();
      process.stdin.on('data', this.onData);
      this.out.on('resize', this.draw);
      this.unsub = this.d.store.onAppend((e) => this.pulse.observe(e.runId, e.event));
      this.timer = setInterval(() => {
        if (this.prefs.animate !== false) this.tick++;
        this.draw();
      }, 100);
    });
  }

  private enter() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    this.out.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
  }
  private leave() {
    this.out.write(`${ESC}?25h${ESC}?1049l`);
    process.stdin.setRawMode(false);
  }

  private quit = () => {
    clearInterval(this.timer);
    this.unsub?.();
    process.stdin.off('data', this.onData);
    this.out.off('resize', this.draw);
    for (const r of this.d.store.list()) if (this.d.engine.isLive(r.id)) this.d.engine.stop(r.id);
    this.leave();
    process.stdin.pause();
    this.done?.();
  };

  /** Hand the terminal to a child process (a Claude session, a shell) and come back afterwards. */
  private async suspend(cmd: string, args: string[], cwd: string): Promise<number> {
    clearInterval(this.timer);
    process.stdin.off('data', this.onData);
    this.leave();
    process.stdin.pause();
    this.out.write(`${dim(`── ${cmd} ${args.join(' ')}  ·  exit to return to aorch ──`)}\n`);
    const code = await new Promise<number>((res) => {
      const c = spawn(cmd, args, { cwd, stdio: 'inherit' });
      c.on('error', (e) => {
        this.out.write(red(`could not start ${cmd}: ${e.message}\n`));
        res(127);
      });
      c.on('exit', (code) => res(code ?? 0));
    });
    this.enter();
    process.stdin.on('data', this.onData);
    this.timer = setInterval(() => {
      if (this.prefs.animate !== false) this.tick++;
      this.draw();
    }, 100);
    this.lastRender = [];
    return code;
  }

  private say(text: string, tone: 'ok' | 'err' = 'ok') {
    this.toast = { text, tone, until: Date.now() + 4500 };
  }

  // ---------- input ----------
  private onData = (chunk: string | Buffer) => {
    for (const k of parseKeys(chunk.toString())) {
      try {
        this.key(k);
      } catch (e) {
        this.say((e as Error).message.split('\n')[0]!, 'err');
      }
    }
    this.draw();
  };

  private key(k: string) {
    if (k === 'ctrl-c') return this.quit();
    if (this.modal) return this.modalKey(k);
    const s = this.screen;
    switch (s.kind) {
      case 'dash':
        return this.dashKey(s, k);
      case 'run':
        return this.runKey(s, k);
      case 'session':
        return this.sessionKey(s, k);
      case 'editor':
        return this.editorKey(s, k);
      case 'plan':
        return this.planKey(s, k);
      case 'theme':
        return this.themeKey(s, k);
    }
  }

  private modalKey(k: string) {
    const m = this.modal!;
    if (m.kind === 'prompt') {
      if (k === 'esc') this.modal = undefined;
      else if (k === 'enter') {
        const v = m.value.trim();
        this.modal = undefined;
        m.onSubmit(v);
      } else if (k === 'backspace') ((m.fresh = false), (m.value = m.value.slice(0, -1)));
      else if (k === 'ctrl-u') ((m.fresh = false), (m.value = ''));
      else if (([...k].length === 1 && k >= ' ') || (k.length > 1 && !/^[a-z-]+$/.test(k))) {
        if (m.fresh) ((m.value = ''), (m.fresh = false));
        m.value += k;
      }
    } else if (m.kind === 'menu') {
      if (k === 'esc') this.modal = undefined;
      else if (k === 'up' || k === 'k') m.sel = (m.sel + m.items.length - 1) % m.items.length;
      else if (k === 'down' || k === 'j') m.sel = (m.sel + 1) % m.items.length;
      else if (k === 'enter') {
        const v = m.items[m.sel]!.value;
        this.modal = undefined;
        m.onPick(v);
      }
    } else {
      if (k === 'y' || k === 'Y' || k === 'enter') {
        this.modal = undefined;
        m.onYes();
      } else if (k === 'n' || k === 'N' || k === 'esc') this.modal = undefined;
    }
  }

  private push(s: Screen) {
    this.stack.push(s);
  }
  private pop() {
    if (this.stack.length > 1) this.stack.pop();
  }

  private ask(title: string, onSubmit: (v: string) => void, value = '', hint?: string) {
    this.modal = { kind: 'prompt', title, value, hint, onSubmit, fresh: value !== '' };
  }
  private choose(title: string, items: Menu['items'], onPick: (v: string) => void, sel = 0) {
    this.modal = { kind: 'menu', title, items, sel, onPick };
  }

  // ---------- data ----------
  private runs() {
    return this.d.store.list();
  }
  private flows() {
    return listPipelines(this.d.cfg.home);
  }
  private state(id: string): RunState | undefined {
    return this.d.store.state(id);
  }

  /** Maestro watches the run: retry, then escalate the failing step, then stop and say why. */
  private superviseRun(id: string, rounds = 2) {
    const b = this.bindings();
    supervise(this.d.engine, id, {
      maxRounds: rounds,
      escalate: b.escalate,
      diagnose: (st) => diagnoseFailure(st, { registry: this.registry, agent: b.orchestrator?.agent, model: b.orchestrator?.model }),
      onAction: (a) => this.say(`Maestro ${a.action === 'stop' ? 'stops' : a.action}: ${a.detail}`, a.action === 'stop' ? 'err' : 'ok'),
    }).catch((e: Error) => this.say(e.message.split('\n')[0]!, 'err'));
  }

  private startRun(pipeline: Pipeline, repo: string, task: string, auto = false, watch = false) {
    const r = resolve(repo.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!existsSync(r) || !statSync(r).isDirectory()) return this.say(`not a directory: ${r}`, 'err');
    this.d.engine
      .start({ pipeline, task, repo: r, autoApprove: auto })
      .then((id) => {
        this.say(`started ${id}${watch ? '  ·  Maestro is watching' : ''}`);
        if (watch) this.superviseRun(id);
        this.stack = [this.stack[0]!, { kind: 'run', runId: id, sel: 0 }];
        (this.stack[0] as { tab: Tab; sel: Record<Tab, number> }).tab = 'runs';
      })
      .catch((e: Error) => this.say(e.message.split('\n').slice(0, 2).join(' '), 'err'));
  }

  private askRun(pipeline: Pipeline) {
    this.ask(`Run “${pipeline.name}” — what should the crew do?`, (task) => {
      if (!task) return;
      this.ask('Repository (a git repo):', (repo) => this.startRun(pipeline, repo || process.cwd(), task), process.cwd());
    });
  }

  // ---------- dashboard ----------
  private dashKey(s: Extract<Screen, { kind: 'dash' }>, k: string) {
    const list = s.tab === 'runs' ? this.runs() : s.tab === 'workflows' ? this.flows() : s.tab === 'settings' ? [] : Object.keys(CREW);
    const n = list.length;
    const sel = s.sel[s.tab];
    if (k === 'q') return this.quit();
    if (s.tab === 'settings' && k !== 'tab' && k !== 'shift-tab' && !/^[1-4]$/.test(k)) return this.settingsKey(s, k);
    if (k === 'tab' || (k === 'right' || k === 'l')) s.tab = TABS[(TABS.indexOf(s.tab) + 1) % TABS.length]!;
    else if (k === 'shift-tab' || k === 'left' || k === 'h') s.tab = TABS[(TABS.indexOf(s.tab) + TABS.length - 1) % TABS.length]!;
    else if (k === '1') s.tab = 'runs';
    else if (k === '2') s.tab = 'workflows';
    else if (k === '3') s.tab = 'crew';
    else if (k === '4') s.tab = 'settings';
    if (s.tab === 'crew' && Date.now() - this.availAt > 15_000) this.refreshAvail();
    else if ((k === 'up' || k === 'k') && n) s.sel[s.tab] = (sel + n - 1) % n;
    else if ((k === 'down' || k === 'j') && n) s.sel[s.tab] = (sel + 1) % n;
    else if (k === 'o') this.orchestrate();
    else if (k === 'n') this.newWorkflow();
    else if (k === 't') this.cycleTheme();
    else if (k === 'c') this.cycleCrew();
    else if (k === 'enter' && n && s.tab === 'crew') this.bindBot(list[sel] as string);
    else if (k === 'x' && n && s.tab === 'crew') {
      unlink(this.d.cfg.home, list[sel] as string);
      this.say(`${CREW[list[sel] as string]!.name} now follows the default (claude)`);
    } else if (k === 'enter' && n) {
      if (s.tab === 'runs') this.push({ kind: 'run', runId: (list[sel] as { id: string }).id, sel: 0 });
      else if (s.tab === 'workflows') this.openEditor((list[sel] as { name: string }).name);
    } else if (s.tab === 'workflows' && n) {
      const name = (list[sel] as { name: string }).name;
      if (k === 'r') this.askRun(readPipeline(this.d.cfg.home, name));
      else if (k === 'e') this.openEditor(name);
    } else if (s.tab === 'runs' && n) {
      const id = (list[sel] as { id: string }).id;
      if (k === 's') this.say(this.d.engine.stop(id) ? `stopping ${id}…` : 'that run is not live in this window');
      else if (k === 'u') this.resumeRun(id, false);
    }
  }

  /** Choose a model for an agent: whatever it reports, its default, or a typed name. */
  private pickModel(agent: string, current: string | undefined, done: (model: string | undefined) => void) {
    const models = (this.avail[agent]?.models ?? []).slice(0, 60);
    const items: Menu['items'] = [
      { value: '', label: '(adapter default)', hint: 'let the agent choose' },
      ...models.map((m) => ({ value: `m:${m}`, label: m, hint: m === current ? 'current' : '' })),
      { value: '?', label: 'type a model name…', hint: models.length ? '' : 'this agent does not list its models' },
    ];
    const sel = Math.max(0, items.findIndex((i) => i.value === `m:${current}`));
    this.choose(`Model for ${agent}`, items, (v) => {
      if (v === '?') this.ask(`Model name for ${agent}:`, (t) => done(t || undefined), current ?? '');
      else done(v.startsWith('m:') ? v.slice(2) : undefined);
    }, sel);
  }

  private agentItems(extra: Menu['items'] = []): Menu['items'] {
    const items = this.registry
      .ids()
      .filter((i) => i !== 'mock')
      .map((id) => {
        const a = this.avail[id];
        const local = this.d.cfg.endpoints[id] || ['ollama', 'lmstudio', 'llamacpp'].includes(id);
        return { value: id, label: id, hint: a ? (a.ok ? `✔ ${a.version ?? 'ready'}` : `✘ ${a.detail ?? 'unavailable'}`) : 'checking…', local };
      })
      .sort((x, y) => Number(!!this.avail[y.value]?.ok) - Number(!!this.avail[x.value]?.ok));
    return [...extra, ...items.map(({ local: _l, ...rest }) => rest)];
  }

  /** Link a bot to any agent and model: Claude Code, Codex, OpenCode, or a local model server. */
  private bindBot(role: string) {
    if (role === 'approval') return this.say('Gate is you: approvals are always a person, so there is no model to link', 'err');
    const cur = this.bindings()[role];
    this.refreshAvail();
    this.choose(`Link ${CREW[role]!.name} (${CREW[role]!.title}) to`, this.agentItems(), (agent) => {
      this.pickModel(agent, cur?.agent === agent ? cur.model : undefined, (model) => {
        link(this.d.cfg.home, role, { agent, model });
        const ok = this.avail[agent]?.ok;
        this.say(`${CREW[role]!.name} → ${agent}${model ? ` · ${model}` : ''}${ok === false ? '  (not available right now)' : ''}`, ok === false ? 'err' : 'ok');
      });
    }, Math.max(0, this.registry.ids().filter((i) => i !== 'mock').indexOf(cur?.agent ?? '')));
  }

  private cycleTheme() {
    const names = Object.keys(THEMES);
    const next = names[(names.indexOf(themeName) + 1) % names.length]!;
    setTheme(next);
    savePrefs(this.d.cfg.home, { theme: next });
    this.say(`theme: ${next}  ·  ${THEMES[next]!.label}`);
  }

  private cycleCrew() {
    const names = Object.keys(CREW_STYLES);
    const next = names[(names.indexOf(crewStyle) + 1) % names.length]!;
    setCrewStyle(next);
    savePrefs(this.d.cfg.home, { crew: next });
    this.say(`crew style: ${next}  ·  ${CREW_STYLES[next as keyof typeof CREW_STYLES]}`);
  }

  private newWorkflow() {
    this.choose(
      'New workflow — start from',
      [...(Object.entries(TEMPLATES) as [Template, { label: string }][]).map(([v, t]) => ({ value: v, label: v, hint: t.label.split('·')[1]?.trim() ?? '' })), { value: 'blank', label: 'blank', hint: 'start empty and add steps yourself' }],
      (v) =>
        this.ask('Name this workflow:', (name) => {
          if (!NAME_RE.test(name)) return this.say('names use letters, digits, . _ - (max 64)', 'err');
          const tests = detectTestCommand(process.cwd());
          const p = v === 'blank' ? blankPipeline(name) : fromTemplate(v as Template, name, undefined, tests ?? 'npm test');
          this.push({ kind: 'editor', pipeline: p, saved: false, dirty: true, sel: 0 });
        }),
    );
  }

  private openEditor(name: string) {
    try {
      this.push({ kind: 'editor', pipeline: readPipeline(this.d.cfg.home, name), saved: true, dirty: false, sel: 0 });
    } catch (e) {
      this.say((e as Error).message, 'err');
    }
  }

  // ---------- orchestrator bot ----------
  private orchestrate() {
    this.ask('Tell Maestro what you want done:', (task) => {
      if (!task) return;
      this.ask('Repository (a git repo):', (repo) => {
        const r = resolve(repo || process.cwd());
        const plan: Extract<Screen, { kind: 'plan' }> = { kind: 'plan', task, repo: r };
        this.push(plan);
        const ac = new AbortController();
        composePipeline(task, { repo: r, registry: this.registry, signal: ac.signal, agent: this.bindings().orchestrator?.agent, model: this.bindings().orchestrator?.model })
          .then((c) => (plan.comp = c))
          .catch((e: Error) => (plan.error = e.message));
      }, process.cwd());
    });
  }

  private planKey(s: Extract<Screen, { kind: 'plan' }>, k: string) {
    if (k === 'esc' || k === 'q') return this.pop();
    if (!s.comp) return;
    if (k === 'enter' || k === 'g') {
      try {
        const p = normalizePipeline(s.comp.pipeline);
        writePipeline(this.d.cfg.home, p);
        this.pop();
        this.startRun(p, s.repo, s.task, false, true);
      } catch (e) {
        this.say((e as Error).message, 'err');
      }
    } else if (k === 'e') {
      this.pop();
      this.push({ kind: 'editor', pipeline: s.comp.pipeline, saved: false, dirty: true, sel: 0 });
    } else if (k === 'r') {
      s.comp = undefined;
      composePipeline(s.task, { repo: s.repo, registry: this.registry, heuristicOnly: true }).then((c) => (s.comp = c));
    }
  }

  // ---------- run view ----------
  private resumeRun(id: string, retryFailed: boolean) {
    this.d.engine.resume(id, { retryFailed }).then(
      () => this.say(`resumed ${id}`),
      (e: Error) => this.say(e.message, 'err'),
    );
  }

  private runKey(s: Extract<Screen, { kind: 'run' }>, k: string) {
    const st = this.state(s.runId);
    if (k === 'esc' || k === 'q') return this.pop();
    if (!st) return;
    const nodes = st.pipeline.nodes;
    if (k === 'left' || k === 'h') s.sel = Math.max(0, s.sel - 1);
    else if (k === 'right' || k === 'l') s.sel = Math.min(nodes.length - 1, s.sel + 1);
    else if (k === 'enter' || k === 'i') this.push({ kind: 'session', runId: s.runId, nodeId: nodes[s.sel]!.id, pane: 'output', scroll: 0, follow: true });
    else if (k === 'a' || k === 'x') {
      const n = nodes[s.sel]!;
      const awaiting = st.nodes[n.id]?.status === 'awaiting' ? n.id : Object.entries(st.nodes).find(([, v]) => v.status === 'awaiting')?.[0];
      if (!awaiting) return this.say('nothing is waiting for approval');
      this.d.engine.approve(s.runId, awaiting, k === 'a');
      if (!this.d.engine.isLive(s.runId)) this.d.engine.resume(s.runId).catch(() => {});
      this.say(k === 'a' ? `approved ${awaiting}` : `rejected ${awaiting}`);
    } else if (k === 's') this.say(this.d.engine.stop(s.runId) ? 'stopping…' : 'not live in this window');
    else if (k === 'u') this.resumeRun(s.runId, false);
    else if (k === 'R') this.resumeRun(s.runId, true);
    else if (k === 'm') {
      if (st.status !== 'error') return this.say(st.status === 'running' ? 'the run is still going; Maestro steps in when it fails' : `nothing to fix: the run is ${st.status}`);
      this.superviseRun(s.runId);
    }
    else if (k === 'd') {
      const sess: Extract<Screen, { kind: 'session' }> = { kind: 'session', runId: s.runId, nodeId: nodes[s.sel]!.id, pane: 'diff', scroll: 0, follow: false };
      this.push(sess);
      this.loadDiff(sess);
    } else if (k === 'v') {
      this.setPref({ metrics: this.prefs.metrics === false });
      this.say(`metrics panel ${this.prefs.metrics === false ? 'hidden' : 'shown'}`);
    } else if (k === 'w') void this.suspend(process.env.SHELL || 'sh', [], st.workdir);
    else if (k === 't') this.cycleTheme();
  }

  // ---------- session view ----------
  private loadDiff(s: Extract<Screen, { kind: 'session' }>) {
    const st = this.state(s.runId);
    const sha = st?.nodes[s.nodeId]?.commit;
    s.pane = 'diff';
    s.scroll = 0;
    s.follow = false;
    s.diff = undefined;
    s.parsed = undefined;
    const job = !st ? Promise.resolve('') : sha && !s.diffAll ? commitDiff(st.workdir, sha) : diffCommitted(st.workdir, st.baseSha);
    job.then((d) => (s.diff = d), () => (s.diff = ''));
  }

  /** Side by side when asked for, or when the terminal is wide enough and the setting is auto. */
  private diffSplit(s: Extract<Screen, { kind: 'session' }>): boolean {
    if (this.cols < 90) return false;
    const mode = s.layout ?? this.prefs.diff ?? 'auto';
    return mode === 'split' || (mode === 'auto' && this.cols >= 130);
  }

  private sessionLines(s: Extract<Screen, { kind: 'session' }>): string[] {
    const st = this.state(s.runId);
    const ns = st?.nodes[s.nodeId];
    const w = this.cols - 2;
    if (!st || !ns) return [];
    if (s.pane === 'output') {
      const text = ns.output ?? ns.live ?? '';
      return text ? wrap(text, w) : [dim(ns.status === 'queued' ? 'This step has not started yet.' : 'No output yet…')];
    }
    if (s.pane === 'events') {
      return this.d.store
        .eventsNoChunks(s.runId)
        .filter((e) => (e.event as { node?: string }).node === s.nodeId || (e.event as { check?: string }).check === s.nodeId)
        .map((e) => {
          const ev = e.event as Record<string, unknown>;
          const bits = Object.entries(ev)
            .filter(([k]) => !['type', 'node', 'output', 'artifacts'].includes(k))
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v)}`)
            .join(' ');
          return `${faint(new Date(e.ts).toTimeString().slice(0, 8))}  ${cyan(String(ev.type))} ${dim(bits)}`;
        });
    }
    if (s.diff === undefined) return [dim('loading diff…')];
    if (!s.diff) return [dim(s.diffAll ? 'Nothing has changed since the starting commit.' : 'This step committed no changes. Press A to see the whole run.')];
    if (!s.parsed || s.parsed.src !== s.diff) s.parsed = { src: s.diff, p: parseDiff(s.diff) };
    return this.diffSplit(s) ? renderSplit(s.parsed.p, w) : renderUnified(s.parsed.p, w);
  }

  private sessionKey(s: Extract<Screen, { kind: 'session' }>, k: string) {
    const st = this.state(s.runId);
    const ns = st?.nodes[s.nodeId];
    const page = Math.max(5, this.rows - 14);
    if (k === 'esc' || k === 'q') return this.pop();
    if (s.pane === 'diff' && s.parsed && ['n', 'p', 'N', 'P', 's', 'A'].includes(k)) {
      const split = this.diffSplit(s);
      if (k === 's') s.layout = split ? 'unified' : 'split';
      else if (k === 'A') {
        s.diffAll = !s.diffAll;
        this.loadDiff(s);
        this.say(s.diffAll ? 'whole run: everything since the starting commit' : 'this step only');
      } else {
        const j = jumpPoints(s.parsed.p, split);
        const pts = k === 'n' || k === 'p' ? j.hunks : j.files;
        const at = k === 'n' || k === 'N' ? pts.find((x) => x > s.scroll) : [...pts].reverse().find((x) => x < s.scroll);
        if (at !== undefined) ((s.scroll = at), (s.follow = false));
        else this.say(k === 'n' || k === 'N' ? 'last one' : 'first one');
      }
      return;
    }
    if (k === 'up' || k === 'k') ((s.follow = false), (s.scroll = Math.max(0, s.scroll - 1)));
    else if (k === 'down' || k === 'j') s.scroll += 1;
    else if (k === 'pgup') ((s.follow = false), (s.scroll = Math.max(0, s.scroll - page)));
    else if (k === 'pgdn') s.scroll += page;
    else if (k === 'g' || k === 'home') ((s.follow = false), (s.scroll = 0));
    else if (k === 'G' || k === 'end' || k === 'f') s.follow = true;
    else if (k === '1') ((s.pane = 'output'), (s.scroll = 0), (s.follow = true));
    else if (k === '2') ((s.pane = 'events'), (s.scroll = 0), (s.follow = false));
    else if (k === '3') this.loadDiff(s);
    else if (k === 'tab') {
      const order = ['output', 'events', 'diff'] as const;
      const nx = order[(order.indexOf(s.pane) + 1) % 3]!;
      this.sessionKey(s, String(order.indexOf(nx) + 1));
    } else if (k === 'i' || k === 'enter') {
      const node = st?.pipeline.nodes.find((n) => n.id === s.nodeId);
      if (!st || !ns || !node) return;
      const cmd = this.registry.has(node.agent ?? 'claude') ? this.registry.get(node.agent ?? 'claude').attachCommand?.(ns.sessionId) : undefined;
      if (!cmd) return this.say(`${node.agent ?? 'claude'} has no session to attach to${ns.sessionId ? '' : ' (none recorded for this step)'}; press w for a shell in the worktree`, 'err');
      if (this.d.engine.isLive(s.runId) && ns.status === 'running') return this.say('this step is still running; wait for it to finish, then attach', 'err');
      void this.suspend(cmd.cmd, cmd.args, st.workdir);
    } else if (k === 'w' && st) void this.suspend(process.env.SHELL || 'sh', [], st.workdir);
  }


  // ---------- live activity and metrics ----------
  private actLine(a: Activity, w: number): string {
    return `${paint(VERB_COLOR[a.verb], padEnd(a.verb, 6))} ${a.verb === 'say' ? paint(pal.text, clip(a.text, w - 8)) : dim(clip(a.text, w - 8))}`;
  }

  /** One line per running step: who is doing what, right now. */
  private nowLines(st: RunState): string[] {
    if (this.prefs.activity === false) return [];
    const out: string[] = [];
    for (const n of st.pipeline.nodes) {
      const ns = st.nodes[n.id];
      if (ns?.status !== 'running') continue;
      const role = crewFor(n);
      const a = recent(ns.live, 1)[0];
      const who = padEnd(bold(paint(CREW[role]!.color(), CREW[role]!.name)), 8);
      out.push(`${glyph('running', this.tick)} ${who} ${a ? this.actLine(a, this.cols - 16) : dim('starting…')}`);
      if (out.length >= 3) break;
    }
    return out;
  }

  /** Cost over time, budget, stream rate, and how long each step took. */
  private metricLines(st: RunState): string[] {
    if (this.prefs.metrics === false) return [];
    const w = this.cols - 2;
    const finished = Object.values(st.nodes).filter((n) => n.status === 'done' || n.status === 'error').length;
    const key = `${st.id}|${st.costUsd}|${finished}`;
    if (this.metricCache?.key !== key) this.metricCache = { key, series: costSeries(this.d.store.eventsNoChunks(st.id)) };
    const now = Date.now();
    const cap = st.pipeline.settings.maxCostUsd;
    const rate = this.pulse.rate(st.id, now);
    const top = [
      `${dim('cost')} ${spark(this.metricCache.series, 14)} ${usd(st.costUsd)}${cap ? dim(` / ${usd(cap)}`) + ' ' + meter(st.costUsd / cap, 8) : ''}`,
      `${dim('stream')} ${spark(this.pulse.series(st.id, now, 12), 12, pal.cyan)} ${rate ? `${Math.round(rate)} ch/s` : dim('idle')}`,
    ].join('   ');
    const steps = stepDurations(st, now);
    const mx = Math.max(1, ...steps.map((x) => x.ms));
    const items = steps.map((x) => {
      const n = Math.max(1, Math.round((x.ms / mx) * 6));
      const color = x.running ? pal.cyan : pal.slate;
      return `${dim(clip(x.label, 8))} ${paint(color, '▇'.repeat(n))}${faint('░'.repeat(6 - n))} ${dim(dur(x.ms))}`;
    });
    const lines = [top];
    let cur = '';
    for (const it of items) {
      if (cur && vlen(cur) + 2 + vlen(it) > w) {
        lines.push(cur);
        cur = '';
        if (lines.length >= 3) break;
      }
      cur += (cur ? '  ' : '') + it;
    }
    if (cur && lines.length < 3) lines.push(cur);
    return lines;
  }

  // ---------- settings ----------
  private settings(): { label: string; value: string; hint: string; change?: (dir: 1 | -1 | 0) => void }[] {
    const onOff = (v: boolean | undefined) => (v === false ? dim('off') : green('on'));
    const flip = (key: 'animate' | 'activity' | 'metrics') => () => this.setPref({ [key]: this.prefs[key] === false } as Prefs);
    const cycle = <T,>(list: T[], cur: T, dir: 1 | -1 | 0): T => list[(list.indexOf(cur) + (dir || 1) + list.length) % list.length]!;
    return [
      { label: 'Colour theme', value: cyan(themeName), hint: 'enter: pick · ←→ cycle · x delete custom', change: (d) => this.pickTheme(d) },
      { label: 'Crew style', value: cyan(crewStyle), hint: '←→ cycle', change: (d) => {
        const next = cycle(Object.keys(CREW_STYLES), crewStyle, d);
        setCrewStyle(next);
        this.setPref({ crew: next });
      } },
      { label: 'Animations', value: onOff(this.prefs.animate), hint: 'off freezes spinners and bots', change: flip('animate') },
      { label: 'Live activity lines', value: onOff(this.prefs.activity), hint: 'what each running agent is doing', change: flip('activity') },
      { label: 'Metrics panel', value: onOff(this.prefs.metrics), hint: 'cost, budget, stream rate, step times (v in a run)', change: flip('metrics') },
      { label: 'Diff layout', value: cyan(this.prefs.diff ?? 'auto'), hint: 'auto = side by side on wide terminals', change: (d) => this.setPref({ diff: cycle(['auto', 'unified', 'split'] as const, this.prefs.diff ?? 'auto', d) }) },
      { label: 'Theme editor', value: dim('open'), hint: 'edit colours with a live preview', change: () => this.openThemeEditor() },
    ];
  }

  private settingsKey(s: Extract<Screen, { kind: 'dash' }>, k: string) {
    const items = this.settings();
    const n = items.length;
    const sel = s.sel.settings;
    if (k === 'up' || k === 'k') s.sel.settings = (sel + n - 1) % n;
    else if (k === 'down' || k === 'j') s.sel.settings = (sel + 1) % n;
    else if (k === 'right' || k === 'l') items[sel]!.change?.(1);
    else if (k === 'left' || k === 'h') items[sel]!.change?.(-1);
    else if (k === 'enter' || k === ' ') {
      if (sel === 0) this.themeMenu();
      else items[sel]!.change?.(0);
    } else if (k === 'x' && sel === 0) {
      if (BUILTIN_THEMES.has(themeName)) return this.say('built-in themes cannot be deleted', 'err');
      const name = themeName;
      this.modal = { kind: 'confirm', title: `delete the custom theme "${name}"?`, onYes: () => {
        deleteTheme(this.d.cfg.home, name);
        delete THEMES[name];
        setTheme('aurora');
        this.setPref({ theme: 'aurora' });
        this.say(`deleted ${name}`);
      } };
    } else if (k === 'o') this.orchestrate();
    else if (k === 't') this.cycleTheme();
    else if (k === 'c') this.cycleCrew();
  }

  private pickTheme(dir: 1 | -1 | 0) {
    const names = Object.keys(THEMES);
    const next = names[(names.indexOf(themeName) + (dir || 1) + names.length) % names.length]!;
    setTheme(next);
    this.setPref({ theme: next });
  }

  private themeMenu() {
    const items = [...Object.entries(THEMES).map(([value, t]) => ({ label: value, hint: t.label, value })), { label: '＋ new theme…', hint: 'edit colours with a live preview', value: '\u0000new' }];
    this.choose('Colour theme', items, (v) => {
      if (v === '\u0000new') return this.openThemeEditor();
      setTheme(v);
      this.setPref({ theme: v });
      this.say(`theme: ${v}`);
    }, Math.max(0, Object.keys(THEMES).indexOf(themeName)));
  }

  private settingsBody(s: Extract<Screen, { kind: 'dash' }>, h: number): string[] {
    const items = this.settings();
    const sel = s.sel.settings;
    const lines = ['', `  ${dim('Preferences are saved to')} ${cyan('ui.json')} ${dim('in your aorch home and apply to every window.')}`, ''];
    items.forEach((it, i) => lines.push(`  ${i === sel ? cyan('▍') : ' '} ${padEnd(i === sel ? bold(it.label) : it.label, 22)} ${padEnd(it.value, 12)} ${dim(i === sel ? it.hint : '')}`));
    lines.push('', `  ${dim('home ')} ${this.d.cfg.home}`, `  ${dim('vault')} ${this.d.cfg.vault}`);
    if (h >= lines.length + 12) {
      lines.push('', `  ${dim('preview')}`, ...renderBoard({ state: sampleRun(), frame: this.tick, now: Date.now() }, Math.min(this.cols - 4, 90)).map((l) => '  ' + l));
    }
    return lines;
  }

  // ---------- theme editor ----------
  private openThemeEditor() {
    const cur = {} as Record<PalKey, RGB>;
    for (const k of PAL_KEYS) cur[k] = [...pal[k]] as RGB;
    this.push({ kind: 'theme', prev: themeName, pal: cur, sel: 0, dirty: false });
  }

  private themeApply(s: Extract<Screen, { kind: 'theme' }>) {
    applyPalette({ label: 'editing', brand: [s.pal.cyan, s.pal.violet, s.pal.pink], pal: s.pal }, 'editing…');
    s.dirty = true;
  }

  private themeKey(s: Extract<Screen, { kind: 'theme' }>, k: string) {
    const key = PAL_KEYS[s.sel]!;
    const adj = (d: { h?: number; s?: number; l?: number }) => {
      s.pal[key] = nudge(s.pal[key], d);
      this.themeApply(s);
    };
    if (k === 'esc' || k === 'q') {
      const leave = () => {
        setTheme(THEMES[s.prev] ? s.prev : 'aurora');
        this.pop();
      };
      if (s.dirty) this.modal = { kind: 'confirm', title: 'discard these colour changes?', onYes: leave };
      else leave();
    } else if (k === 'up' || k === 'k') s.sel = (s.sel + PAL_KEYS.length - 1) % PAL_KEYS.length;
    else if (k === 'down' || k === 'j') s.sel = (s.sel + 1) % PAL_KEYS.length;
    else if (k === 'left' || k === 'h') adj({ h: -8 });
    else if (k === 'right' || k === 'l') adj({ h: 8 });
    else if (k === '-' || k === '_') adj({ l: -0.04 });
    else if (k === '=' || k === '+') adj({ l: 0.04 });
    else if (k === ',' || k === '<') adj({ s: -0.05 });
    else if (k === '.' || k === '>') adj({ s: 0.05 });
    else if (k === 'enter') {
      this.ask(`hex for ${key}`, (v) => {
        const c = parseHex(v);
        if (!c) return this.say('that is not a hex colour (try #22d3ee)', 'err');
        s.pal[key] = c;
        this.themeApply(s);
      }, toHex(s.pal[key]), 'three or six hex digits');
    } else if (k === 'r') {
      s.pal[key] = [...({ ...basePalette(), ...(THEMES[s.prev]?.pal ?? {}) })[key]] as RGB;
      this.themeApply(s);
    } else if (k === 'R') {
      Object.assign(s.pal, { ...basePalette(), ...(THEMES[s.prev]?.pal ?? {}) });
      this.themeApply(s);
    } else if (k === 's') {
      const suggest = BUILTIN_THEMES.has(s.prev) ? 'my-theme' : s.prev;
      this.ask('name this theme', (v) => {
        const name = v.toLowerCase();
        if (!THEME_NAME_RE.test(name)) return this.say('use lowercase letters, digits and dashes (max 24)', 'err');
        if (BUILTIN_THEMES.has(name)) return this.say(`"${name}" is built in; pick another name`, 'err');
        const theme = { label: 'custom', brand: [s.pal.cyan, s.pal.violet, s.pal.pink], pal: s.pal };
        this.setPref({ themes: { ...(this.prefs.themes ?? {}), [name]: theme }, theme: name });
        registerThemes({ [name]: theme });
        setTheme(name);
        s.dirty = false;
        this.say(`saved theme "${name}"`);
        this.pop();
      }, suggest, 'lowercase letters, digits, dashes');
    }
  }

  private themeBody(s: Extract<Screen, { kind: 'theme' }>, h: number): string[] {
    const left: string[] = [dim(' colour          swatch   hex       h    s   l    contrast')];
    PAL_KEYS.forEach((key, i) => {
      const c = s.pal[key];
      const [hh, ss, ll] = rgbToHsl(c);
      const cr = contrast(c, [12, 12, 16]);
      left.push(`${i === s.sel ? cyan('▍') : ' '}${padEnd(i === s.sel ? bold(key) : key, 9)} ${paint(c, '██████')}   ${padEnd(toHex(c), 9)} ${String(Math.round(hh)).padStart(3)}° ${String(Math.round(ss * 100)).padStart(3)} ${String(Math.round(ll * 100)).padStart(3)}  ${cr < 3 ? amber(cr.toFixed(1) + ' low') : dim(cr.toFixed(1))}`);
    });
    const wide = this.cols >= 118;
    if (wide) left.push('', dim(' ↑↓ colour · ←→ hue · -/= lighter · ,/. saturation'), dim(' enter type hex · r reset one · R reset all'), dim(' s save as a theme · esc discard'), dim(' contrast is against a dark terminal'));
    else left.push(dim(' ↑↓ colour · ←→ hue · -/= light · ,/. saturation · enter hex · r/R reset · s save'));
    const pw = wide ? this.cols - 64 : this.cols - 4;
    const now = Date.now();
    const crew = ['orchestrator', 'planner', 'architect', 'coder', 'tester', 'reviewer', 'approval'].map((r) => padCenter(miniBot(r, 'working', this.tick), 6)).join('');
    const sampleDiff = renderUnified(parseDiff('diff --git a/x.ts b/x.ts\n@@ -1,2 +1,2 @@\n const a = 1;\n-return "old"; // x\n+return "new"; // y\n'), Math.min(pw, 60));
    const right = [
      ...renderBoard({ state: sampleRun(now), frame: this.tick, now }, Math.max(40, Math.min(pw, 88))),
      '',
      `${dim('cost')} ${spark([1, 2, 2, 4, 5, 7, 9, 12, 14, 17], 14)} ${meter(0.64, 10)}  ${dim('crew')} ${crew}`,
      ...(wide ? sampleDiff : []),
    ];
    if (wide) {
      const n = Math.max(left.length, right.length);
      const out: string[] = [''];
      for (let i = 0; i < n; i++) out.push(`${padEnd(left[i] ?? '', 62)} ${right[i] ?? ''}`);
      return out;
    }
    void h;
    return [...left, '', ...right];
  }

  // ---------- editor ----------
  private editorKey(s: Extract<Screen, { kind: 'editor' }>, k: string) {
    const p = s.pipeline;
    const touch = () => ((s.dirty = true), (s.saved = false));
    if (k === 'esc' || k === 'q') {
      if (!s.dirty) return this.pop();
      this.modal = { kind: 'confirm', title: 'Discard unsaved changes? (y/n)', onYes: () => this.pop() };
      return;
    }
    if (k === 'left' || k === 'h') s.sel = Math.max(0, s.sel - 1);
    else if (k === 'right' || k === 'l') s.sel = Math.min(p.nodes.length - 1, s.sel + 1);
    else if (k === 'shift-left' || k === '<' || k === '[') (void (s.sel = moveStep(p, s.sel, -1)), touch());
    else if (k === 'shift-right' || k === '>' || k === ']') (void (s.sel = moveStep(p, s.sel, 1)), touch());
    else if (k === 'a') {
      this.choose(
        'Add a step after the selected one',
        STEP_TYPES.map((t) => ({ value: t, label: `${CREW[t === 'tester' ? 'tester' : t === 'approval' ? 'approval' : t]!.name} · ${t}`, hint: STEP_BLURB[t] })),
        (t) => {
          addStep(p, t as StepType, p.nodes.length ? s.sel + 1 : 0, undefined, detectTestCommand(process.cwd()) ?? 'npm test');
          s.sel = p.nodes.length ? Math.min(p.nodes.length - 1, s.sel + 1) : 0;
          touch();
        },
      );
    } else if (k === 'd' && p.nodes.length) {
      removeStep(p, s.sel);
      s.sel = Math.max(0, Math.min(s.sel, p.nodes.length - 1));
      touch();
    } else if (k === 'enter' && p.nodes.length) this.editStep(s, touch);
    else if (k === 'c') this.ask('Cost cap in USD (blank = none):', (v) => ((p.settings.maxCostUsd = v ? Math.max(0, Number(v)) || undefined : undefined), touch()), String(p.settings.maxCostUsd ?? ''));
    else if (k === 'n') this.ask('Rename workflow:', (v) => (NAME_RE.test(v) ? ((p.name = v), touch()) : this.say('invalid name', 'err')), p.name);
    else if (k === 's') this.saveFlow(s);
    else if (k === 'r') {
      if (s.dirty) this.saveFlow(s);
      if (!s.dirty) this.askRun(p);
    } else if (k === 't') this.cycleTheme();
  }

  private saveFlow(s: Extract<Screen, { kind: 'editor' }>) {
    try {
      const p = normalizePipeline(relink(s.pipeline));
      const errs = preflight(applyBindings(p, this.bindings()), this.registry).filter((i) => i.level === 'error');
      if (errs.length) return this.say(`not saved: ${errs[0]!.message}`, 'err');
      writePipeline(this.d.cfg.home, p);
      s.pipeline = p;
      s.dirty = false;
      s.saved = true;
      this.say(`saved ${p.name}`);
    } catch (e) {
      this.say((e as Error).message, 'err');
    }
  }

  private editStep(s: Extract<Screen, { kind: 'editor' }>, touch: () => void) {
    const n = s.pipeline.nodes[s.sel]!;
    const items: Menu['items'] = [];
    const t = stepType(n);
    if (n.kind === 'agent') {
      items.push({ value: 'agent', label: 'agent', hint: n.agent ?? `follows ${CREW[crewFor(n)]!.name}` }, { value: 'model', label: 'model', hint: n.model ?? '(default)' }, { value: 'prompt', label: 'instructions', hint: n.prompt ? n.prompt.slice(0, 40) : '(role default)' });
      if (t === 'coder') items.push({ value: 'readOnly', label: 'read-only', hint: n.readOnly ? 'yes' : 'no' });
    }
    if (n.kind === 'gate') items.push({ value: 'command', label: 'command', hint: n.command ?? '' }, { value: 'maxLoops', label: 'max fix loops', hint: String(n.maxLoops ?? 2) });
    if (n.verdict) items.push({ value: 'maxLoops', label: 'max fix loops', hint: String(n.maxLoops ?? 2) });
    if (n.kind === 'approval') items.push({ value: 'title', label: 'label', hint: n.title ?? '' });
    items.push({ value: 'id', label: 'id', hint: n.id });
    this.choose(`Edit step “${n.id}”`, items, (f) => {
      const done = (fn: () => void) => (v: string) => (fn.call(null), void v, touch());
      void done;
      switch (f) {
        case 'agent': {
          const bound = this.bindings()[crewFor(n)];
          this.refreshAvail();
          return this.choose(
            `Agent for “${n.id}”`,
            this.agentItems([{ value: '', label: `follow ${CREW[crewFor(n)]!.name}`, hint: bound ? `${bound.agent}${bound.model ? ' · ' + bound.model : ''}` : 'claude (default)' }]),
            (a) => {
              n.agent = a || undefined;
              n.model = undefined;
              touch();
              if (a) this.pickModel(a, undefined, (m) => ((n.model = m), touch()));
            },
          );
        }
        case 'readOnly':
          n.readOnly = !n.readOnly;
          relink(s.pipeline);
          return touch();
        case 'model':
          return this.pickModel(n.agent ?? this.bindings()[crewFor(n)]?.agent ?? 'claude', n.model, (m) => ((n.model = m), touch()));
        case 'prompt':
          return this.ask('Instructions for this step (blank = role default):', (v) => ((n.prompt = v || undefined), touch()), n.prompt ?? '');
        case 'command':
          return this.ask('Gate command (exit 0 = pass):', (v) => ((n.command = v || undefined), touch()), n.command ?? '');
        case 'maxLoops':
          return this.ask('Max fix loops:', (v) => ((n.maxLoops = Math.max(0, Math.min(10, Math.trunc(Number(v)) || 0))), touch()), String(n.maxLoops ?? 2));
        case 'title':
          return this.ask('Label:', (v) => ((n.title = v || undefined), touch()), n.title ?? '');
        case 'id':
          return this.ask('Step id (letters, digits, _ -):', (v) => {
            if (!/^[A-Za-z0-9_-]{1,40}$/.test(v) || s.pipeline.nodes.some((m) => m.id === v)) return this.say('invalid or duplicate id', 'err');
            for (const m of s.pipeline.nodes) if (m.fixNode === n.id) m.fixNode = v;
            n.id = v;
            relink(s.pipeline);
            touch();
          }, n.id);
      }
    });
  }

  // ---------- drawing ----------
  private maestro(): { mood: Mood; text: string } {
    const runs = this.runs();
    const live = runs.filter((r) => r.status === 'running');
    const paused = runs.filter((r) => r.status === 'paused');
    const s = this.screen;
    if (s.kind === 'plan') return s.comp ? { mood: 'happy', text: s.comp.rationale } : s.error ? { mood: 'sad', text: s.error } : { mood: 'working', text: 'Reading your task and sketching a workflow…' };
    if (s.kind === 'session') {
      const ns = this.state(s.runId)?.nodes[s.nodeId];
      return { mood: moodFor(ns?.status ?? 'queued'), text: `You are inside ${s.nodeId}'s session. Press i to reopen the agent's own session, w for a shell in its worktree, esc to step back out.` };
    }
    if (s.kind === 'run') {
      const st = this.state(s.runId);
      const waiting = st && Object.values(st.nodes).some((n) => n.status === 'awaiting');
      const last = st?.actions[st.actions.length - 1];
      if (last && st?.status !== 'done') return { mood: last.action === 'stop' ? 'sad' : 'working', text: `Maestro ${last.action === 'stop' ? 'stopped' : last.action}: ${last.detail}` };
      return { mood: waiting ? 'waiting' : moodFor(st?.status ?? 'queued'), text: waiting ? 'Someone needs a decision from you. Press a to approve or x to reject.' : st?.status === 'done' ? 'All done. Review the branch, or step into any agent to see how it got there.' : st?.status === 'error' ? 'Something failed. Press R to retry only the failed branch.' : 'The crew is working. Pick an agent with ←/→ and press enter to step into its session.' };
    }
    if (s.kind === 'editor') return { mood: 'idle', text: 'Arrange the crew: shift+←/→ or [ ] moves a step, a adds one, enter edits its settings.' };
    if (paused.length) return { mood: 'waiting', text: `${paused.length} run${paused.length > 1 ? 's are' : ' is'} waiting for your approval. Open it and press a to approve.` };
    if (live.length) return { mood: 'working', text: `${live.length} run${live.length > 1 ? 's' : ''} in motion. Open one to watch the crew, or step into an agent's session.` };
    if (runs[0]?.status === 'error') return { mood: 'sad', text: 'The last run hit an error. Open it, then press R to retry just the failed branch.' };
    return { mood: 'idle', text: 'All quiet. Press o and tell me what to build, and I will design the workflow and run it.' };
  }

  private header(): string[] {
    const w = this.cols;
    const m = this.maestro();
    const bot = renderBot('orchestrator', m.mood, this.tick);
    const tabs = this.screen.kind === 'dash' ? this.screen.tab : undefined;
    const tabLine = TABS.map((t, i) => (t === tabs ? bold(paint(pal.cyan, `${i + 1} ${t}`)) : dim(`${i + 1} ${t}`))).join('   ');
    const crumbs = this.stack
      .slice(1)
      .map((s) => (s.kind === 'run' ? `run ${s.runId.slice(-6)}` : s.kind === 'session' ? `${s.nodeId} session` : s.kind === 'editor' ? `editing ${s.pipeline.name}${s.dirty ? ' •' : ''}` : s.kind === 'plan' ? 'plan' : s.kind === 'theme' ? 'theme editor' : ''))
      .join(dim(' › '));
    const right = dim(new Date().toTimeString().slice(0, 8));
    const l0 = `${gradient('aorch', BRAND)}  ${faint(themeName)}${crumbs ? `  ${dim('›')} ${crumbs}` : ''}`;
    const txt = wrap(m.text, w - 14 - 4);
    const bubble = [dim('“') + (txt[0] ?? '') + (txt.length < 2 ? dim('”') : ''), txt[1] ? txt[1] + dim('”') : ''];
    const lines = [
      `${bot[0]}  ${padEnd(l0, w - 12 - vlen(right) - 1)}${right}`,
      `${bot[1]}  ${tabs ? tabLine : dim('esc back  ·  ctrl-c quit')}`,
      `${bot[2]}  ${bubble[0]}`,
      `${bot[3]}  ${bubble[1]}`,
      rule(w),
    ];
    return lines;
  }

  private footer(): string[] {
    const s = this.screen;
    const hint =
      this.modal?.kind === 'prompt' ? 'enter confirm · esc cancel · ctrl-u clear'
      : this.modal?.kind === 'menu' ? '↑↓ choose · enter select · esc cancel'
      : this.modal?.kind === 'confirm' ? 'y yes · n no'
      : s.kind === 'dash' && s.tab === 'settings' ? '↑↓ choose · ←→ change · enter pick · x delete custom theme · tab switch · q quit'
      : s.kind === 'theme' ? '↑↓ colour · ←→ hue · -/= lighter · ,/. saturation · enter hex · r reset · s save · esc discard'
      : s.kind === 'dash' ? (s.tab === 'workflows' ? 'enter edit · r run · n new · o ask Maestro · tab switch · t theme · q quit' : s.tab === 'runs' ? 'enter open · o ask Maestro · n new workflow · s stop · u resume · tab switch · t theme · c crew style · q quit' : 'enter link model · x unlink · o ask Maestro · t theme · c crew style · q quit')
      : s.kind === 'run' ? '←→ pick agent · enter step into session · d diff · v metrics · a approve · x reject · s stop · u resume · R retry failed · m fix · w shell · esc back'
      : s.kind === 'session' ? (s.pane === 'diff' ? 'n/p hunk · N/P file · s split · A whole run · ↑↓ scroll · 1 output · i attach · w shell · esc back' : '1 output · 2 events · 3 diff · ↑↓ scroll · f follow · i attach to agent session · w shell · esc exit session')
      : s.kind === 'editor' ? '←→ select · [ ] move · a add · d delete · enter edit step · c cost cap · n rename · s save · r run · esc back'
      : s.comp ? 'enter run it · e edit first · r re-plan with rules · esc cancel' : 'esc cancel';
    const t = this.toast && this.toast.until > Date.now() ? this.toast : undefined;
    return [rule(this.cols), t ? (t.tone === 'err' ? red('✘ ') : green('✔ ')) + t.text : dim(hint)];
  }

  private body(h: number): string[] {
    const w = this.cols;
    if (this.modal) return this.modalBox(h);
    const s = this.screen;
    switch (s.kind) {
      case 'dash':
        return s.tab === 'runs' ? this.runsBody(s, h) : s.tab === 'workflows' ? this.flowsBody(s, h) : s.tab === 'settings' ? this.settingsBody(s, h) : this.crewBody(h);
      case 'run':
        return this.runBody(s, h);
      case 'session':
        return this.sessionBody(s, h);
      case 'editor':
        return this.editorBody(s, h);
      case 'plan':
        return this.planBody(s, h);
      case 'theme':
        return this.themeBody(s, h);
    }
    void w;
    return [];
  }

  private modalBox(h: number): string[] {
    const m = this.modal!;
    const w = Math.min(this.cols - 4, 78);
    const pad = (l: string) => '  ' + l;
    const lines: string[] = [];
    const top = '╭─ ' + m.title + ' ' + '─'.repeat(Math.max(0, w - 5 - vlen(m.title))) + '╮';
    lines.push(pad(gradient(top, BRAND)));
    const row = (c: string) => pad(faint('│') + ' ' + padEnd(clip(c, w - 4), w - 4) + ' ' + faint('│'));
    if (m.kind === 'prompt') {
      lines.push(row(`${cyan('›')} ${m.value}${this.tick % 8 < 5 ? paint(pal.cyan, '▏') : ' '}`));
      if (m.hint) lines.push(row(dim(m.hint)));
    } else if (m.kind === 'menu') {
      const room = Math.max(5, h - 5);
      const start = Math.max(0, Math.min(Math.max(0, m.items.length - room), m.sel - Math.floor(room / 2)));
      m.items.slice(start, start + room).forEach((it, vi) => {
        const i = start + vi;
        lines.push(row(`${i === m.sel ? cyan('▸') : ' '} ${padEnd(i === m.sel ? bold(it.label) : it.label, 22)}${it.hint ? ' ' + dim(it.hint) : ''}`));
      });
      if (m.items.length > room) lines.push(row(dim(`${m.sel + 1}/${m.items.length}`)));
    } else lines.push(row(dim('press y to confirm, n to cancel')));
    lines.push(pad(gradient('╰' + '─'.repeat(w - 2) + '╯', BRAND)));
    return [...Array(Math.max(0, Math.floor((h - lines.length) / 4))).fill(''), ...lines];
  }

  private window<T>(items: T[], sel: number, h: number): [T[], number] {
    const start = Math.max(0, Math.min(Math.max(0, items.length - h), sel - Math.floor(h / 2)));
    return [items.slice(start, start + h), start];
  }

  private runsBody(s: Extract<Screen, { kind: 'dash' }>, h: number): string[] {
    const runs = this.runs();
    if (!runs.length) return ['', `  ${dim('No runs yet.')}`, `  ${cyan('o')} ${dim('describe a task and let Maestro build and run a workflow')}`, `  ${cyan('2')} ${dim('pick a saved workflow and press r')}`];
    const listH = Math.max(3, Math.min(runs.length, h - 11));
    const [view, start] = this.window(runs, s.sel.runs, listH);
    const lines = view.map((r, vi) => {
      const sel = start + vi === s.sel.runs;
      const mood = moodFor(r.status);
      const role = r.status === 'paused' ? 'approval' : 'coder';
      const stc = r.status === 'done' ? green(r.status) : r.status === 'error' ? red(r.status) : r.status === 'running' ? cyan(r.status) : amber(r.status);
      const row = `${sel ? cyan('▍') : ' '} ${miniBot(role, mood, this.tick)} ${padEnd(cyan(r.id.slice(-8)), 9)} ${padEnd(bold(r.pipeline), 22)} ${padEnd(stc, 9)} ${padEnd(usd(r.costUsd), 7)} ${padEnd(dim(ago(r.startedAt)), 10)} ${dim(r.task.split('\n')[0]!.slice(0, Math.max(10, this.cols - 74)))}`;
      return sel ? row : row;
    });
    const sel = runs[s.sel.runs];
    const st = sel ? this.state(sel.id) : undefined;
    const preview = st ? renderBoard({ state: st, frame: this.tick, now: Date.now() }, Math.min(this.cols - 2, 96)).map((l) => ' ' + l) : [];
    return [...lines, '', ...preview];
  }

  private flowsBody(s: Extract<Screen, { kind: 'dash' }>, h: number): string[] {
    const flows = this.flows();
    if (!flows.length) return ['', `  ${dim('No saved workflows. Press')} ${cyan('n')} ${dim('to create one, or')} ${cyan('o')} ${dim('to ask Maestro.')}`];
    const [view, start] = this.window(flows, s.sel.workflows, Math.max(3, h - 2));
    return view.map((f, vi) => {
      const sel = start + vi === s.sel.workflows;
      let chain = '';
      try {
        const p = readPipeline(this.d.cfg.home, f.name);
        chain = p.nodes.map((n) => paint(CREW[crewFor(n)]!.color(), CREW[crewFor(n)]!.name)).join(dim(' → '));
      } catch {
        chain = red('unreadable');
      }
      return `${sel ? cyan('▍') : ' '} ${padEnd(sel ? bold(f.name) : f.name, 26)} ${padEnd(dim(`${f.nodes} steps`), 10)} ${chain}`;
    });
  }

  private crewBody(h: number): string[] {
    const roles = Object.keys(CREW);
    const sel = (this.screen as Extract<Screen, { kind: 'dash' }>).sel.crew;
    const b = this.bindings();
    const lines: string[] = [];
    const list = roles.map((role, i) => {
      const c = CREW[role]!;
      const bd = b[role];
      const agent = bd?.agent ?? 'claude';
      const a = this.avail[agent];
      const status = role === 'approval' ? '' : a ? (a.ok ? green('✔') : red('✘')) : dim('…');
      const model = role === 'approval' ? dim('you (a person)') : bd ? `${cyan(agent)}${bd.model ? dim(' · ' + bd.model) : ''}` : dim('claude (default)');
      const mood: Mood = i === sel ? 'working' : 'idle';
      return `${i === sel ? cyan('▍') : ' '} ${miniBot(role, mood, this.tick)} ${padEnd(bold(paint(c.color(), c.name)), 9)} ${padEnd(dim(c.title), 13)} ${status} ${model}`;
    });
    const role = roles[sel]!;
    const big = renderBot(role, 'working', this.tick);
    const info = [bold(paint(CREW[role]!.color(), CREW[role]!.name)), dim(CREW[role]!.title), '', dim('enter  link to an agent / model'), dim('x      follow the default'), '', dim(role === 'orchestrator' ? 'designs workflows from your task' : role === 'approval' ? 'a person: pauses the run for you' : 'steps without their own agent use this link')];
    lines.push('');
    for (let i = 0; i < Math.max(list.length, 8); i++) {
      const left = padEnd(list[i] ?? '', 58);
      lines.push(`${left}  ${i < 4 ? big[i]! : ' '.repeat(10)}  ${info[i] ?? ''}`);
    }
    lines.push('', `  ${dim('Local models: start Ollama, LM Studio or llama.cpp and they appear here. Others: add "endpoints" to')} ${cyan('aorch.config.json')}${dim('.')}`);
    void h;
    return lines;
  }

  private runBody(s: Extract<Screen, { kind: 'run' }>, h: number): string[] {
    const st = this.state(s.runId);
    if (!st) return [dim('  run not found')];
    s.sel = Math.min(s.sel, st.pipeline.nodes.length - 1);
    const strip_ = crewStrip(
      st.pipeline.nodes,
      (n) => st.nodes[n.id]?.status ?? 'queued',
      s.sel,
      this.tick,
      this.cols - 2,
      (n) => {
        const ns = st.nodes[n.id];
        const a = ns?.status === 'running' && this.prefs.activity !== false ? recent(ns.live, 1)[0] : undefined;
        if (a) return paint(VERB_COLOR[a.verb], clip(`${a.verb} ${a.text.split('/').pop() ?? ''}`, CELL - 3));
        return ns?.startedAt ? dim(dur(Math.max(0, (ns.status === 'running' || !ns.finishedAt ? Date.now() : ns.finishedAt) - ns.startedAt))) : dim(ns?.status ?? '');
      },
    ).map((l) => ' ' + l);
    const n = st.pipeline.nodes[s.sel]!;
    const ns = st.nodes[n.id];
    const cap = st.pipeline.settings.maxCostUsd;
    const head = `${glyph(st.status, this.tick)} ${bold(st.pipeline.name)} ${dim('·')} ${st.status}  ${dim('·')} ${cap ? meter(st.costUsd / cap, 10) + ' ' : ''}${usd(st.costUsd)}${cap ? dim(` / ${usd(cap)}`) : ''} ${dim('· ' + dur((st.finishedAt ?? Date.now()) - st.startedAt))}  ${dim('branch')} ${cyan(st.branch)}`;
    const detail: string[] = [
      `${bold(CREW[crewFor(n)]!.name)} ${dim(`${n.title ?? n.role ?? n.kind} · ${n.id}`)}  ${ns?.verdict ? (ns.verdict === 'PASS' ? green('PASS') : red('FAIL')) : ''} ${ns && ns.attempts > 1 ? amber(`attempt ${ns.attempts}`) : ''} ${ns?.commit ? dim('commit ') + cyan(ns.commit.slice(0, 7)) : ''} ${ns?.costUsd ? dim(usd(ns.costUsd)) : ''}  ${n.agent ? dim(`${n.agent}${n.model ? ' · ' + n.model : ''}`) : ''}`,
    ];
    if (ns?.error) detail.push(red(ns.error.split('\n')[0]!));
    if (ns?.gate) detail.push(`${ns.gate.ok ? green('gate passed') : red(`gate failed (exit ${ns.gate.exitCode})`)}`);
    const waiting = Object.entries(st.nodes).filter(([, v]) => v.status === 'awaiting').map(([id]) => id);
    const banner = waiting.length ? [amber(`  ◉ waiting for approval: ${waiting.join(', ')} — press a to approve, x to reject`)] : [];
    const metrics = this.metricLines(st).map((l) => ' ' + l);
    const now = this.nowLines(st).map((l) => ' ' + l);
    const extra = banner.length + metrics.length + now.length + (metrics.length || now.length ? 1 : 0);
    const room = Math.max(2, h - strip_.length - 5 - extra);
    const text = (ns?.live ?? ns?.output ?? '').trim();
    if (ns?.status === 'running' && this.prefs.activity !== false && ns.live) {
      for (const a of recent(ns.live, room)) detail.push('  ' + this.actLine(a, this.cols - 4));
    } else if (text) detail.push(...wrap(text, this.cols - 4).slice(-room).map((l) => dim('  ' + l)));
    else detail.push(dim('  (no output yet)'));
    return [' ' + head, '', ...strip_, '', ...banner, ...metrics, ...now, ...(metrics.length || now.length ? [''] : []), ...detail];
  }

  private sessionBody(s: Extract<Screen, { kind: 'session' }>, h: number): string[] {
    const st = this.state(s.runId);
    const node = st?.pipeline.nodes.find((n) => n.id === s.nodeId);
    const ns = st?.nodes[s.nodeId];
    if (!st || !node || !ns) return [dim('  step not found')];
    const role = crewFor(node);
    const bot = renderBot(role, moodFor(ns.status), this.tick);
    const attachable = this.registry.has(node.agent ?? 'claude') && this.registry.get(node.agent ?? 'claude').attachCommand?.(ns.sessionId);
    const info = [
      `${bold(paint(CREW[role]!.color(), CREW[role]!.name))} ${dim('·')} ${node.title ?? node.role ?? node.kind} ${dim('·')} ${glyph(ns.status, this.tick)} ${ns.status}`,
      `${dim('agent')} ${node.agent ?? '—'}${node.model ? dim(` (${node.model})`) : ''}   ${dim('attempts')} ${ns.attempts}   ${dim('cost')} ${usd(ns.costUsd)}${ns.commit ? `   ${dim('commit')} ${cyan(ns.commit.slice(0, 7))}` : ''}`,
      `${dim('session')} ${ns.sessionId ? ns.sessionId.slice(0, 18) + '…' : dim('none')}   ${attachable ? green('press i to attach') : dim('attach unavailable')}`,
      `${dim('worktree')} ${st.workdir}`,
    ];
    const head = bot.map((b, i) => ` ${b}  ${info[i] ?? ''}`);
    const tabs = (['output', 'events', 'diff'] as const).map((p, i) => (p === s.pane ? bold(paint(pal.cyan, `${i + 1} ${p}`)) : dim(`${i + 1} ${p}`))).join('   ');
    const lines = this.sessionLines(s);
    const room = Math.max(3, h - head.length - 3);
    const maxScroll = Math.max(0, lines.length - room);
    if (s.follow) s.scroll = maxScroll;
    s.scroll = Math.min(s.scroll, maxScroll);
    const view = lines.slice(s.scroll, s.scroll + room).map((l) => ' ' + l);
    let pos = lines.length > room ? dim(` ${s.scroll + 1}-${Math.min(lines.length, s.scroll + room)} / ${lines.length}${s.follow ? ' · following' : ''}`) : '';
    if (s.pane === 'diff' && s.parsed) {
      const p = s.parsed.p;
      const hs = jumpPoints(p, this.diffSplit(s)).files;
      const fi = Math.max(0, hs.filter((x) => x <= s.scroll).length - 1);
      pos = `  ${diffSummary(p)}  ${dim(`· ${p.files[fi] ? `file ${fi + 1}/${p.files.length} ${p.files[fi]!.path}` : ''} · ${this.diffSplit(s) ? 'split' : 'unified'}${s.diffAll ? ' · whole run' : ''}`)}`;
    }
    return [...head, ' ' + tabs + pos, ' ' + rule(this.cols - 2), ...view];
  }

  private editorBody(s: Extract<Screen, { kind: 'editor' }>, h: number): string[] {
    const p = s.pipeline;
    const lines: string[] = [];
    lines.push(` ${bold(p.name)} ${s.dirty ? amber('• unsaved') : green('saved')}  ${dim('·')} ${dim(`${p.nodes.length} steps · cost cap ${p.settings.maxCostUsd ? usd(p.settings.maxCostUsd) : 'none'}`)}`);
    lines.push('');
    if (!p.nodes.length) lines.push(`  ${dim('No steps yet. Press')} ${cyan('a')} ${dim('to add the first crew member.')}`);
    else {
      s.sel = Math.min(s.sel, p.nodes.length - 1);
      lines.push(...crewStrip(p.nodes, () => 'idle', s.sel, this.tick, this.cols - 2, (n) => dim(n.kind === 'agent' ? (n.readOnly ? 'read-only' : 'writes') : n.kind === 'gate' ? 'gate' : 'human')).map((l) => ' ' + l));
      const n = p.nodes[s.sel]!;
      lines.push('');
      lines.push(` ${bold(CREW[crewFor(n)]!.name)} ${dim(STEP_BLURB[stepType(n)])}`);
      const rn = applyBindings(p, this.bindings()).nodes[s.sel]!;
      const facts = [`id ${n.id}`, rn.agent ? `agent ${rn.agent}${n.agent ? '' : ' (via ' + CREW[crewFor(n)]!.name + ')'}` : '', rn.model ? `model ${rn.model}` : '', n.command ? `$ ${n.command}` : '', n.fixNode ? `fixes via ${n.fixNode} ≤${n.maxLoops ?? 2}×` : '', n.prompt ? `instructions: ${n.prompt.slice(0, 60)}` : ''].filter(Boolean);
      lines.push(` ${dim(facts.join('  ·  '))}`);
    }
    lines.push('');
    const issues = preflight(applyBindings(p, this.bindings()), this.registry);
    if (!issues.length) lines.push(` ${green('✔')} ${dim('preflight clean')}`);
    for (const i of issues.slice(0, Math.max(2, h - lines.length - 1))) lines.push(` ${i.level === 'error' ? red('✘') : amber('!')} ${i.node ? dim(`[${i.node}] `) : ''}${i.message}`);
    return lines;
  }

  private planBody(s: Extract<Screen, { kind: 'plan' }>, h: number): string[] {
    const lines: string[] = [` ${dim('task')}  ${bold(s.task.slice(0, this.cols - 12))}`, ` ${dim('repo')}  ${s.repo}`, ''];
    if (s.error) return [...lines, red(` ${s.error}`)];
    if (!s.comp) {
      const dots = '.'.repeat((this.tick >> 2) % 4);
      return [...lines, ` ${cyan('Maestro is designing a workflow')}${dots}`];
    }
    const c = s.comp;
    lines.push(` ${green('✔')} ${bold(c.pipeline.name)} ${dim(c.source === 'bot' ? '· designed by the bot' : '· picked by rules')}`, '');
    lines.push(...crewStrip(c.pipeline.nodes, () => 'idle', -1, this.tick, this.cols - 2).map((l) => ' ' + l));
    lines.push('');
    const resolved = applyBindings(c.pipeline, this.bindings());
    for (const n of resolved.nodes.filter((x) => x.kind === 'agent')) lines.push(` ${paint(CREW[crewFor(n)]!.color(), padEnd(CREW[crewFor(n)]!.name, 8))} ${dim('runs on')} ${cyan(n.agent ?? 'claude')}${n.model ? dim(' · ' + n.model) : ''}`);
    lines.push('');
    for (const w of c.warnings) lines.push(` ${amber('!')} ${dim(w)}`);
    lines.push('', ` ${cyan('enter')} ${dim('save and run it')}   ${cyan('e')} ${dim('edit first')}   ${cyan('esc')} ${dim('cancel')}`);
    void h;
    return lines;
  }

  draw = () => {
    if (this.busy) return;
    const rows = this.rows;
    const head = this.header();
    const foot = this.footer();
    const bodyH = rows - head.length - foot.length;
    const body = this.body(bodyH);
    const lines = [...head, ...body.slice(0, bodyH), ...Array(Math.max(0, bodyH - body.length)).fill(''), ...foot];
    let buf = '';
    for (let i = 0; i < lines.length; i++) {
      const l = clip(lines[i]!, this.cols);
      if (this.lastRender[i] === l) continue;
      buf += `${ESC}${i + 1};1H${l}${caps.level ? '\x1b[0m' : ''}${ESC}K`;
    }
    this.lastRender = lines.map((l) => clip(l, this.cols));
    if (buf) this.out.write(buf);
  };
}

export async function runTui(d: TuiDeps): Promise<void> {
  await new Tui(d).run();
}
