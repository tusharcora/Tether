/**
 * Terminal and Preview (spec 2026-10-30 §6.3): commands and a dev server in a run's worktree, and nowhere else. Each
 * runs as `sh -lc <command>` in its own process group with a clean environment (the user's PATH and a few basics, none
 * of Tether's keys or tokens). One command at a time per run, its output handed to listeners as it comes (the run's
 * stream forwards it) and kept for the last 50 commands; one preview per run, its URL read from its output. Every
 * group's pid is recorded in `<home>/procs.json`, so a later start can end groups a crash left behind; Stop, a run's
 * delete, the server's close and the process's exit end them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { saveSpill } from './codemode/spill.js';
import { runProcess } from './proc.js';
import { HttpError } from './serverkit.js';
import type { Store } from './store.js';
import type { ExecEntry, PreviewView, ProcMessage } from './types.js';

export type { ExecEntry, PreviewView, ProcMessage };

/** Characters of one command's output shown and kept; the rest (up to KEEP_MAX) is saved to a spill file when it ends. */
export const STREAM_CAP = 100_000;
const KEEP_MAX = 4_000_000;
export const HISTORY = 50;
/** With no URL in its output after this long, a preview is shown on the port it was given. */
export const URL_WAIT_MS = 20_000;
const PREVIEW_TAIL = 8_000;

/** The environment a command gets: the user's PATH and a few basics. Nothing else of Tether's (keys, tokens, settings). */
const KEEP_ENV = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'TZ']);
export function cleanEnv(src: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(src)) if (v !== undefined && (KEEP_ENV.has(k) || k.startsWith('LC_'))) out[k] = v;
  return { ...out, FORCE_COLOR: '0', ...extra };
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** The first loopback http(s) URL in a dev server's output (colour codes stripped), or undefined. Other hosts are never shown. */
export function detectUrl(text: string): string | undefined {
  return /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?![\w.-])(?::\d{1,5})?(?:\/[^\s'"<>`]*)?/.exec(text.replace(ANSI, ''))?.[0];
}

/** The command a preview runs when none is given: the worktree's package.json `dev` script, else `start`. */
export function devCommand(dir: string): string | undefined {
  try {
    const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.scripts ?? {};
    return typeof scripts.dev === 'string' ? 'npm run dev' : typeof scripts.start === 'string' ? 'npm run start' : undefined;
  } catch {
    return undefined;
  }
}

/** A command from a request: text of 1 to 2000 characters, no NUL. */
export function checkCommand(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, '"command" is required');
  if (v.length > 2000) throw new HttpError(400, '"command" is too long (max 2000 characters)');
  if (v.includes('\0')) throw new HttpError(400, '"command" may not contain NUL');
  return v.trim();
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

/** When a process started, from `ps` (NaN when it is gone or unreadable). */
function startedAt(pid: number): number {
  try {
    return Date.parse(execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return NaN;
  }
}

const killGroup = (pid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(-pid, sig);
  } catch {
    /* already gone */
  }
};

/** Every RunProcs not yet stopped: one exit hook kills all their groups (a test may open many servers). */
const OPEN = new Set<RunProcs>();
let exitHooked = false;

interface Live {
  ac: AbortController;
  pid?: number;
  done: Promise<void>;
}

export class RunProcs {
  private execs = new Map<string, ExecEntry[]>();
  private running = new Map<string, Live>();
  private previews = new Map<string, { view: PreviewView; live?: Live; timer?: NodeJS.Timeout }>();
  private listeners = new Map<string, Set<(m: ProcMessage) => void>>();
  private seq = 0;
  /** pid -> the run and when it started: what procs.json holds. */
  private pids = new Map<number, { run: string; at: number }>();
  private readonly file: string;

  constructor(private o: { home: string; store: Store }) {
    this.file = join(o.home, 'procs.json');
    this.reap();
    OPEN.add(this);
    if (!exitHooked) {
      exitHooked = true;
      process.on('exit', () => OPEN.forEach((p) => p.killAllNow()));
    }
  }

  /** End the groups a crashed Tether left behind: those whose leader still runs and started when it was recorded. */
  private reap(): void {
    let old: Record<string, { at?: unknown }> = {};
    try {
      old = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    for (const [k, r] of Object.entries(old)) {
      const pid = Number(k);
      if (Number.isInteger(pid) && pid > 1 && typeof r?.at === 'number' && Math.abs(startedAt(pid) - r.at) < 2000) killGroup(pid, 'SIGKILL');
    }
    rmSync(this.file, { force: true });
  }
  private saveFile(): void {
    try {
      if (!this.pids.size) return void rmSync(this.file, { force: true });
      mkdirSync(this.o.home, { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.pids)), { mode: 0o600 });
    } catch {
      /* best effort: the process is still tracked in memory */
    }
  }

  /** Follow a run's Terminal output. Returns the unsubscribe. */
  on(runId: string, fn: (m: ProcMessage) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(fn);
    this.listeners.set(runId, set);
    return () => void (set.delete(fn), set.size || this.listeners.delete(runId));
  }
  private emit(runId: string, m: ProcMessage): void {
    for (const fn of this.listeners.get(runId) ?? []) fn(m);
  }

  /** The run's worktree: 404 for an unknown run, 409 when its worktree is gone. */
  private worktree(runId: string): string {
    const s = this.o.store.state(runId);
    if (!s) throw new HttpError(404, `unknown run ${runId}`);
    if (!existsSync(s.workdir)) throw new HttpError(409, 'this run’s worktree is gone');
    return s.workdir;
  }

  private spawn(runId: string, dir: string, command: string, env: NodeJS.ProcessEnv, onText: (t: string) => void, onEnd: (r: { code: number | null; signal?: string; spawnError?: string }) => Promise<void> | void): Live {
    const ac = new AbortController();
    const live: Live = { ac, done: Promise.resolve() };
    live.done = runProcess({
      cmd: '/bin/sh',
      args: ['-lc', command],
      cwd: dir,
      env,
      signal: ac.signal,
      maxBuffer: 1,
      onStdout: onText,
      onStderr: onText,
      onSpawn: (pid) => {
        live.pid = pid;
        this.pids.set(pid, { run: runId, at: Date.now() });
        this.saveFile();
      },
    }).then(async (r) => {
      if (live.pid !== undefined && this.pids.delete(live.pid)) this.saveFile();
      await onEnd({ code: r.code, ...(r.signal ? { signal: r.signal } : {}), ...(r.spawnError ? { spawnError: r.spawnError } : {}) });
    });
    return live;
  }

  /** Run a command in the run's worktree. Its output comes to listeners; 409 while another is running. */
  exec(runId: string, command: string): ExecEntry {
    const dir = this.worktree(runId);
    if (this.running.has(runId)) throw new HttpError(409, 'a command is still running here: stop it first');
    const entry: ExecEntry = { id: ++this.seq, command, at: Date.now(), output: '', running: true };
    const list = [...(this.execs.get(runId) ?? []), entry].slice(-HISTORY);
    this.execs.set(runId, list);
    let full = '';
    let capped = false;
    const shown = (text: string) => ((entry.output += text), this.emit(runId, { type: 'exec.output', id: entry.id, text }));
    const onText = (t: string) => {
      if (full.length < KEEP_MAX) full += t.slice(0, KEEP_MAX - full.length);
      if (entry.output.length < STREAM_CAP) shown(t.slice(0, STREAM_CAP - entry.output.length));
      else if (!capped) {
        capped = true;
        shown(`\n[the output goes on past ${STREAM_CAP / 1000}k characters; all of it is saved when the command ends]\n`);
      }
    };
    this.emit(runId, { type: 'exec.start', id: entry.id, command, at: entry.at });
    const live = this.spawn(runId, dir, command, cleanEnv(), onText, async (r) => {
      this.running.delete(runId);
      if (r.spawnError) shown(`could not start: ${r.spawnError}\n`);
      const spill = capped ? await saveSpill(dir, full) : undefined;
      Object.assign(entry, { running: false, code: r.code, ...(r.signal ? { signal: r.signal } : {}), durationMs: Date.now() - entry.at, ...(spill ? { spill } : {}) });
      this.emit(runId, { type: 'exec.end', id: entry.id, code: r.code, ...(r.signal ? { signal: r.signal } : {}), durationMs: entry.durationMs!, ...(spill ? { spill } : {}) });
    });
    this.running.set(runId, live);
    return { ...entry };
  }

  /** Stop the run's command (its whole process group). False when none runs. */
  stopExec(runId: string): boolean {
    const l = this.running.get(runId);
    l?.ac.abort();
    return !!l;
  }

  /** The run's last 50 commands, oldest first, with what they printed. */
  history(runId: string): ExecEntry[] {
    return (this.execs.get(runId) ?? []).map((e) => ({ ...e }));
  }

  /**
   * Start the run's preview (or return the one going): `command`, else the worktree's dev or start script, with PORT set
   * to a free port. Its URL is the first loopback URL it prints, else localhost:PORT after 20 s.
   */
  async startPreview(runId: string, command?: string): Promise<PreviewView> {
    const dir = this.worktree(runId);
    const cur = this.previews.get(runId);
    if (cur && (cur.view.status === 'starting' || cur.view.status === 'running')) return { ...cur.view };
    const cmd = command ?? devCommand(dir);
    if (!cmd) throw new HttpError(400, 'There is no dev or start script in package.json: give the command that starts the app.');
    const p: { view: PreviewView; live?: Live; timer?: NodeJS.Timeout } = { view: { status: 'starting', command: cmd, port: 0, output: '' } };
    this.previews.set(runId, p);
    const view = p.view;
    view.port = await freePort();
    const found = (url: string) => {
      view.url = url;
      if (view.status === 'starting') view.status = 'running';
      clearTimeout(p.timer);
    };
    const onText = (t: string) => {
      view.output = (view.output + t).slice(-PREVIEW_TAIL);
      const u = view.url ? undefined : detectUrl(view.output);
      if (u) found(u);
    };
    // stopped (or the run deleted) while the port was found
    if (view.status === 'stopped' || this.previews.get(runId) !== p) return { ...view };
    p.timer = setTimeout(() => view.url || view.status !== 'starting' || found(`http://localhost:${view.port}`), URL_WAIT_MS);
    p.timer.unref?.();
    p.live = this.spawn(runId, dir, cmd, cleanEnv(process.env, { PORT: String(view.port) }), onText, (r) => {
      clearTimeout(p.timer);
      if (view.status !== 'stopped') Object.assign(view, { status: 'exited', code: r.code });
      if (r.spawnError) view.output += `\ncould not start: ${r.spawnError}`;
    });
    return { ...view };
  }

  preview(runId: string): PreviewView | undefined {
    const p = this.previews.get(runId);
    return p ? { ...p.view } : undefined;
  }

  /** Stop the run's preview. False when there is none going. */
  stopPreview(runId: string): boolean {
    const p = this.previews.get(runId);
    if (!p || (p.view.status !== 'starting' && p.view.status !== 'running')) return false;
    p.view.status = 'stopped';
    clearTimeout(p.timer);
    p.live?.ac.abort();
    return true;
  }

  /** End everything the run has going and forget it (the run is being deleted). Resolves once the processes are gone. */
  async stopRun(runId: string): Promise<void> {
    const waits = [this.running.get(runId)?.done, this.previews.get(runId)?.live?.done];
    this.stopExec(runId);
    this.stopPreview(runId);
    await Promise.all(waits);
    this.execs.delete(runId);
    this.previews.delete(runId);
    this.listeners.delete(runId);
  }

  /** End every run's processes (the server closes). */
  async stopAll(): Promise<void> {
    OPEN.delete(this);
    await Promise.all([...new Set([...this.running.keys(), ...this.previews.keys()])].map((id) => this.stopRun(id)));
  }

  /** Kill every group at once, without waiting (the process is exiting). */
  killAllNow(): void {
    for (const pid of this.pids.keys()) killGroup(pid, 'SIGKILL');
  }
}
