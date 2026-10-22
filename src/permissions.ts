/**
 * Commands Maestro may propose. A model never runs anything by itself: each command is shown, and runs
 * only if you allow it once, always allow it, or Settings says Maestro may run commands without asking.
 * A short list of plainly destructive patterns is refused even then.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const normalizeCommand = (c: string) => c.trim().replace(/\s+/g, ' ');

const file = (home: string) => join(home, 'permissions.json');

/** Commands you chose "always allow" for. Exact match on the normalized text. */
export function loadAllowed(home: string): string[] {
  try {
    const j = JSON.parse(readFileSync(file(home), 'utf8')) as { allow?: unknown };
    return Array.isArray(j.allow) ? j.allow.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
  } catch {
    return [];
  }
}

function writeAllowed(home: string, allow: string[]) {
  mkdirSync(home, { recursive: true });
  writeFileSync(`${file(home)}.tmp`, JSON.stringify({ allow }, null, 2) + '\n');
  renameSync(`${file(home)}.tmp`, file(home));
}

export function allowAlways(home: string, command: string): void {
  const c = normalizeCommand(command);
  const cur = loadAllowed(home);
  if (!cur.includes(c)) writeAllowed(home, [...cur, c]);
}

export function clearAllowed(home: string): void {
  if (existsSync(file(home))) writeAllowed(home, []);
}

export const isAllowed = (home: string, command: string) => loadAllowed(home).includes(normalizeCommand(command));

const BLOCKED: [RegExp, string][] = [
  [/\bsudo\b|\bsu\s+-?\s*\w*\s*$/, 'needs administrator rights'],
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME|\*)(\s|$)/, 'would delete a whole directory tree at the top level'],
  [/\bmkfs\b|\bdd\s+[^|;&]*\bof=\/dev\//, 'writes to a disk device'],
  [/:\(\)\s*\{.*\};\s*:/, 'a fork bomb'],
  [/(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, 'pipes a download straight into a shell'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'writes to a disk device'],
  [/\bchmod\s+(-R\s+)?[0-7]*777\s+\//, 'opens up permissions on the filesystem root'],
  [/\bgit\s+push\b[^;&|]*--force(?!-with-lease)\b[^;&|]*\b(main|master)\b/, 'force-pushes the main branch'],
];

/**
 * Commands that change or spend on a bot's harness (aorch evolve: propose, probe, accept, reject; aorch harness … rollback). Maestro may
 * offer them, but each one needs the person's approval every time: never run because Settings says "always", never remembered as
 * "always allow". A reason, or undefined.
 */
export function needsApproval(command: string): string | undefined {
  const c = normalizeCommand(command);
  if (/\baorch\s+evolve\b/.test(c)) return 'it changes or spends on a bot\'s harness (aorch evolve), so it always asks';
  if (/\baorch\s+harness\b.*\brollback\b/.test(c)) return 'it changes a bot\'s harness (rollback), so it always asks';
  return undefined;
}

/** A reason this command is refused even when everything is allowed, or undefined. */
export function blockedReason(command: string): string | undefined {
  const c = normalizeCommand(command);
  if (!c) return 'it is empty';
  if (c.length > 1000) return 'it is too long';
  for (const [re, why] of BLOCKED) if (re.test(c)) return why;
  return undefined;
}

export interface CommandResult {
  exit: number | null;
  output: string;
  ms: number;
  timedOut: boolean;
}

/** Run one command in `cwd` with a timeout and a size cap, without secrets from the environment. */
export function runCommand(command: string, cwd: string, o: { timeoutMs?: number; maxBytes?: number } = {}): Promise<CommandResult> {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(k)) env[k] = v;
  const max = o.maxBytes ?? 20_000;
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let timedOut = false;
    const add = (b: Buffer) => {
      out += b.toString();
      if (out.length > max * 2) out = out.slice(-max);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL'); // the whole group, so a child of the shell cannot keep it open
      } catch {
        child.kill('SIGKILL');
      }
    }, o.timeoutMs ?? 120_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exit: null, output: `could not start: ${e.message}`, ms: Date.now() - t0, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exit: code, output: out.slice(-max), ms: Date.now() - t0, timedOut });
    });
  });
}
