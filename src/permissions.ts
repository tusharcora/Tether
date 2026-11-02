/**
 * Commands Tether may propose. A model never runs anything by itself: each command is shown, and runs
 * only if you allow it once, always allow it, or Settings says Tether may run commands without asking.
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
 * Commands that change or spend on a bot's harness (aorch evolve: propose, probe, accept, reject; aorch harness … rollback). Tether may
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

const REFUSED_GIT = new Set(['push', 'pull', 'merge', 'rebase', 'filter-branch', 'filter-repo', 'update-ref', 'replace']);
const OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time']);
const SENDS = /^(-[dFTX]|-X.+|--(data|data-\w+|form|upload-file|json|request|post-data|post-file|method)\b)/;

/** Why this one simple command (no chaining) is refused, or undefined. `t` is its words, wrappers already stripped. */
function whyRefused(t: string[]): string | undefined {
  const cmd = (t[0] ?? '').replace(/^.*\//, '');
  const rest = t.slice(1);
  const sub = rest.filter((w) => !w.startsWith('-'))[0];
  if (cmd === 'git') {
    let i = 0;
    while (i < rest.length && rest[i]!.startsWith('-')) i += OPTS_WITH_ARG.has(rest[i]!) ? 2 : 1;
    const g = rest[i];
    const args = rest.slice(i + 1);
    if (g && REFUSED_GIT.has(g)) return `git ${g} sends or rewrites history, so it is left to you`;
    if (g === 'reset' && args.some((a) => /^--(hard|keep|merge)$/.test(a))) return 'git reset --hard throws work away, so it is left to you';
    if (g === 'commit' && args.includes('--amend')) return 'amending a commit rewrites history, so it is left to you';
    if (g === 'reflog' || g === 'gc') return `git ${g} can destroy history, so it is left to you`;
  }
  if (cmd === 'gh') return 'gh acts on GitHub, outside this folder';
  if (['npm', 'yarn', 'pnpm'].includes(cmd) && sub === 'publish') return 'publishing sends your work to the public';
  if (cmd === 'curl' && rest.some((a) => SENDS.test(a))) return 'it sends data out of this folder';
  if (cmd === 'wget' && rest.some((a) => /^--(post-data|post-file|method|body-data|body-file)\b/.test(a))) return 'it sends data out of this folder';
  if (cmd === 'ssh' || cmd === 'scp') return `${cmd} reaches another machine`;
  if (cmd === 'rsync' && rest.some((a) => /^([\w.-]+@|[\w.-]+:)/.test(a))) return 'rsync to another machine sends files out of this folder';
  if (cmd === 'defaults' && sub === 'write') return 'it changes system settings';
  if (cmd === 'systemsetup' || cmd === 'launchctl') return 'it changes system settings';
  if (cmd === 'sudo' || cmd === 'doas') return 'needs administrator rights';
  return undefined;
}

/** A reason this word points outside the folder, or undefined. Judged from the text alone: `..` by depth. */
function outside(word: string): string | undefined {
  let w = word.replace(/^[<>&]+/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(w)) return undefined; // a URL is not a path
  if (w.includes('=')) w = w.slice(w.indexOf('=') + 1); // --out=/etc/x, FOO=../x
  if (/^~|\$\{?HOME\b/.test(w)) return 'it reaches outside this folder (your home)';
  if (w.startsWith('/')) return w === '/dev/null' || w === '/usr/bin/env' || w === '/tmp' || w.startsWith('/tmp/') ? undefined : 'it reaches outside this folder';
  let depth = 0;
  for (const seg of w.split('/')) {
    if (seg === '..' && --depth < 0) return 'it climbs out of this folder';
    else if (seg && seg !== '.' && seg !== '..') depth++;
  }
  return undefined;
}

/**
 * Whether an agent may run this command in a folder the person trusted. Pure text, so it is cheap to import from a hook.
 * Chained, nested and wrapped commands are each judged as if run alone.
 */
export function commandRule(command: string): { ok: true } | { ok: false; why: string } {
  const no = (why: string) => ({ ok: false as const, why: `Not run: ${why}.` });
  const bad = blockedReason(command) ?? needsApproval(command);
  if (bad) return no(bad);
  // shortcut: this matches text, so it stops mistakes, not a hostile project; the macOS Seatbelt port is the real boundary
  const parts = command.replace(/\$\(|[`()]/g, ';').split(/;|&|\||\n/);
  for (const part of parts) {
    const all = part.replace(/["']/g, '').split(/\s+/).filter(Boolean);
    if (!all.length) continue;
    for (const w of all) {
      const why = outside(w);
      if (why) return no(why);
    }
    const t = [...all];
    for (;;) {
      if (/^\w+=/.test(t[0] ?? '')) t.shift();
      else if (WRAPPERS.has(t[0]!)) {
        t.shift();
        while (t[0]?.startsWith('-') || /^\w+=/.test(t[0] ?? '')) t.shift();
      } else break;
      if (!t.length) break;
    }
    if (!t.length) continue;
    const cmd = (t[0] ?? '').replace(/^.*\//, '');
    const inner = (['bash', 'sh', 'zsh'].includes(cmd) && t.findIndex((w) => /^-\w*c$/.test(w)) + 1) || (cmd === 'eval' ? 1 : 0);
    if (inner) {
      const r = commandRule(t.slice(inner).join(' '));
      if (!r.ok) return r;
    }
    const why = whyRefused(t);
    if (why) return no(why);
  }
  return { ok: true };
}
