import { spawn } from 'node:child_process';

export interface ProcOptions {
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  signal?: AbortSignal;
  /** Called for each complete stdout line. */
  onStdoutLine?: (line: string) => void;
  /** Called with each stdout chunk as it arrives. */
  onStdout?: (text: string) => void;
  /** Called once the process exists, with its pid (its process group's id too). */
  onSpawn?: (pid: number) => void;
  onStderr?: (text: string) => void;
  /** Max bytes of stdout/stderr kept in the result (the tail is kept). */
  maxBuffer?: number;
}

export interface ProcResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  aborted: boolean;
  spawnError?: string;
}

const tail = (s: string, max: number) => (s.length > max ? s.slice(s.length - max) : s);

/**
 * Run a subprocess in its own process group so an abort (or timeout) kills the whole
 * tree — agent CLIs spawn children, and orphaned agents keep editing files and billing.
 */
export function runProcess(o: ProcOptions): Promise<ProcResult> {
  const max = o.maxBuffer ?? 2_000_000;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let pending = '';
    let aborted = false;
    let settled = false;
    const done = (r: Omit<ProcResult, 'stdout' | 'stderr' | 'aborted'>) => {
      if (settled) return;
      settled = true;
      if (pending && o.onStdoutLine) o.onStdoutLine(pending);
      o.signal?.removeEventListener('abort', onAbort);
      resolve({ ...r, stdout, stderr, aborted });
    };

    const child = spawn(o.cmd, o.args, {
      cwd: o.cwd,
      env: o.env ?? process.env,
      detached: process.platform !== 'win32',
      stdio: [o.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    const killTree = (sig: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch {
        /* already gone */
      }
    };

    function onAbort() {
      aborted = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 3000).unref();
    }
    if (o.signal) {
      if (o.signal.aborted) onAbort();
      else o.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (child.pid !== undefined) o.onSpawn?.(child.pid);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      stdout = tail(stdout + d, max);
      o.onStdout?.(d);
      if (o.onStdoutLine) {
        pending += d;
        let i: number;
        while ((i = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, i);
          pending = pending.slice(i + 1);
          if (line.trim()) o.onStdoutLine(line);
        }
      }
    });
    child.stderr?.on('data', (d: string) => {
      stderr = tail(stderr + d, max);
      o.onStderr?.(d);
    });
    child.on('error', (err) => done({ code: null, signal: null, spawnError: err.message }));
    child.on('close', (code, signal) => done({ code, signal }));

    if (o.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(o.stdin);
    }
  });
}
