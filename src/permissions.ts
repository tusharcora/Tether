/**
 * Commands Tether may propose. A model never runs anything by itself: each command is shown, and runs
 * only if you allow it once, always allow it, or Settings says Tether may run commands without asking.
 * A short list of plainly destructive patterns is refused even then.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET = [/^(?!.*\.(example|sample|template)$)\.env(\..*)?$/, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)/];
/** Secrets files open read-only, are left out of search and never go into an agent's prompt. Here, not in code.ts, so the command hook stays light. */
export const isSecretPath = (rel: string): boolean => SECRET.some((re) => re.test(rel.split('/').pop() ?? ''));

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

export const MAX_COMMAND_MS = 120_000;
/** Characters of output kept, from the end: that is where a failure shows. */
export const MAX_COMMAND_OUTPUT = 20_000;

// PAT, AUTH and DSN only as a whole part of the name: PATH and GIT_AUTHOR_NAME stay. SSH_AUTH_SOCK is a path, and ssh needs it
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|(^|_)(PAT|AUTH|AUTHORIZATION|DSN)(_|$)/i;
const SECRET_VALUE = /:\/\/[^/\s@]*:[^/\s]*@/; // a URL holding a user and password

/** Run one command in `cwd` with a timeout and a size cap, without secrets from the environment. */
export function runCommand(command: string, cwd: string, o: { timeoutMs?: number; maxBytes?: number } = {}): Promise<CommandResult> {
  return spawnCommand(command, cwd, o);
}

function spawnCommand(command: string, cwd: string, o: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal; /** Kill what the shell left in the background. */ reap?: boolean }): Promise<CommandResult> {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if ((k === 'SSH_AUTH_SOCK' || !SECRET_NAME.test(k)) && !SECRET_VALUE.test(v ?? '')) env[k] = v;
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
    const kill = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL'); // the whole group, so a child of the shell cannot keep it open
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, o.timeoutMs ?? 120_000);
    o.signal?.addEventListener('abort', kill, { once: true });
    const done = () => {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', kill);
    };
    child.on('error', (e) => {
      done();
      resolve({ exit: null, output: `could not start: ${e.message}`, ms: Date.now() - t0, timedOut: false });
    });
    child.on('close', (code) => {
      done();
      if (o.reap) kill();
      resolve({ exit: code, output: out.slice(-max), ms: Date.now() - t0, timedOut });
    });
  });
}

const REFUSED_GIT = new Set(['push', 'pull', 'merge', 'rebase', 'filter-branch', 'filter-repo', 'update-ref', 'replace', 'reflog', 'gc']);
const OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'nice', 'timeout', 'xargs']);
const LEAD = new Set(['{', '!', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']); // shell keywords that start a command
const WRAP_ARGS: Record<string, string[]> = { nice: ['-n'], timeout: ['-s', '-k'], env: ['-u', '-C'], xargs: ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'] };
const BIN = /^\/(?:bin|usr\/bin|usr\/local\/bin|opt\/homebrew\/bin)\/([^/]+)$/; // an executable here is judged by its name
const SENDS = /^(-[a-zA-Z]*[dFTX]|--(data|data-\w+|form|upload-file|json|request|post-data|post-file|method)\b)/;

type W = { s: string; q: boolean }; // a word, and whether any of it was quoted

const ENV_SHOWN = 'it prints the environment, which can hold secrets';
const PUBLISH: Record<string, string> = { cargo: 'publish', twine: 'upload', docker: 'push' };

/** `kill`'s targets: what follows its signal. A lone `-N` is the signal, as in `kill -1 123`. */
function killTargets(rest: string[]): string[] {
  const skip = rest[0] === '-s' || rest[0] === '-n' ? 2 : rest[0]?.startsWith('-') && rest[0] !== '--' ? 1 : 0;
  const a = rest.slice(skip);
  return a[0] === '--' ? a.slice(1) : a;
}

/** Why this one simple command is refused, or undefined. `t` is its words, wrappers already stripped. */
function whyRefused(t: string[]): string | undefined {
  const cmd = (t[0] ?? '').replace(/^.*\//, '');
  const rest = t.slice(1);
  const sub = rest.filter((w) => !/^[-+]/.test(w))[0]; // + is cargo's toolchain
  if (cmd === 'git') {
    let i = 0;
    while (i < rest.length && rest[i]!.startsWith('-')) i += OPTS_WITH_ARG.has(rest[i]!) ? 2 : 1;
    const g = rest[i];
    const args = rest.slice(i + 1);
    if (g && REFUSED_GIT.has(g)) return `git ${g} sends or rewrites history, so it is left to you`;
    if (g === 'reset' && args.some((a) => /^--(hard|soft|keep|merge)$|[~^]|^@/.test(a))) return 'git reset moves or throws away work, so it is left to you';
    if (g === 'commit' && args.includes('--amend')) return 'amending a commit rewrites history, so it is left to you';
    if ((g === 'checkout' && args.includes('-B')) || (g === 'switch' && args.includes('-C')) || (g === 'branch' && args.some((a) => /^-[a-zA-Z]*[fD]|^--force$/.test(a)))) return 'it moves a branch over existing work, so it is left to you';
  }
  if (cmd === 'gh' || (cmd === 'npx' && sub === 'gh')) return 'gh acts on GitHub, outside this folder';
  if ((['npm', 'yarn', 'pnpm'].includes(cmd) && rest.includes('publish')) || (sub && PUBLISH[cmd] === sub)) return 'publishing sends your work to the public';
  if (cmd === 'curl' && rest.some((a) => SENDS.test(a))) return 'it sends data out of this folder';
  if (cmd === 'wget' && rest.some((a) => /^--(post-data|post-file|method|body-data|body-file)\b/.test(a))) return 'it sends data out of this folder';
  if (cmd === 'ssh' || cmd === 'scp') return `${cmd} reaches another machine`;
  if (cmd === 'rsync' && rest.some((a) => /^([\w.-]+@|[\w.-]+:)/.test(a))) return 'rsync to another machine sends files out of this folder';
  if (cmd === 'defaults' && (sub === 'write' || sub === 'delete')) return 'it changes system settings';
  if (cmd === 'systemsetup' || cmd === 'launchctl') return 'it changes system settings';
  if (cmd === 'sudo' || cmd === 'doas' || cmd === 'su') return 'needs administrator rights';
  if (cmd === 'pkill' || cmd === 'killall' || (cmd === 'kill' && killTargets(rest).some((a) => a.startsWith('-')))) return 'it can stop programs outside this folder';
  if (cmd === 'printenv' || ((cmd === 'set' || cmd === 'export') && !rest.length) || (cmd === 'export' && rest[0] === '-p')) return ENV_SHOWN;
  return undefined;
}

/** A reason this word is off limits: a secrets file, or a path outside the folder. Judged from the text alone: `..` by depth. */
function outside(word: string, root?: string): string | undefined {
  let w = word;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(w)) return undefined; // a URL is not a path
  if (w.includes('=')) w = w.slice(w.indexOf('=') + 1); // --out=/etc/x, FOO=../x
  if (isSecretPath(w)) return 'it touches a secrets file, and agents never read those';
  if (/^~|\$\{?HOME\b/.test(w)) return 'it reaches outside this folder (your home)';
  if (w.startsWith('/')) {
    if (root && (w === root || w.startsWith(`${root}/`))) w = w.slice(root.length);
    else return w === '/dev/null' || w === '/usr/bin/env' || w === '/tmp' || w.startsWith('/tmp/') ? undefined : 'it reaches outside this folder';
  }
  let depth = 0;
  for (const seg of w.split('/')) {
    if (seg === '..' && --depth < 0) return 'it climbs out of this folder';
    else if (seg && seg !== '.' && seg !== '..') depth++;
  }
  return undefined;
}

/** Split into simple commands of words. Quotes keep a word whole; `;` `&` `|` newline, parens and backticks end a command. */
function scan(text: string): W[][] {
  const out: W[][] = [];
  let cmd: W[] = [];
  let cur = '';
  let has = false;
  let isq = false;
  let q = '';
  const word = () => {
    if (has) cmd.push({ s: cur, q: isq });
    cur = '';
    has = isq = false;
  };
  const end = () => {
    word();
    if (cmd.length) out.push(cmd);
    cmd = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && q !== "'") (cur += text[++i] ?? ''), (has = true);
    else if (q) c === q ? (q = '') : (cur += c);
    else if (c === '"' || c === "'") (q = c), (has = isq = true);
    else if (c !== '\n' && /\s/.test(c)) word();
    else if (';&|\n()`'.includes(c)) end();
    else (cur += c), (has = true);
  }
  end();
  return out;
}

/** Texts inside `$(…)` and backticks, which run even inside double quotes. */
function subs(text: string): string[] {
  const out: string[] = [];
  let q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\') i++;
    else if (q === "'") q = c === "'" ? '' : q;
    else if (c === '"') q = q ? '' : '"';
    else if (c === "'" && !q) q = c;
    else if (c === '`') {
      const j = text.indexOf('`', i + 1) < 0 ? text.length : text.indexOf('`', i + 1);
      out.push(text.slice(i + 1, j));
      i = j;
    } else if (c === '$' && text[i + 1] === '(') {
      let d = 1;
      let j = i + 2;
      while (j < text.length && d) d += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0, j++;
      out.push(text.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return out;
}

/** Why one simple command is refused: wrappers peeled off, then shells, find -exec, paths and the refused list. */
function judge(t: W[], root?: string): string | undefined {
  const all = [...t];
  let env = false; // `env` with nothing left to run prints the environment
  while (t[0]) {
    const w = t[0];
    const bin = BIN.exec(w.s);
    if (bin) w.s = bin[1]!;
    if (/^\w+=/.test(w.s) || LEAD.has(w.s)) t.shift();
    else if (!WRAPPERS.has(w.s)) break;
    else {
      env ||= w.s === 'env';
      t.shift();
      while (t[0]?.s.startsWith('-')) t.splice(0, WRAP_ARGS[w.s]?.includes(t[0].s) ? 2 : 1);
      if (w.s === 'timeout' && /^\d/.test(t[0]?.s ?? '')) t.shift();
    }
  }
  if (env && !t[0]) return ENV_SHOWN;
  const cmd = (t[0]?.s ?? '').replace(/^.*\//, '');
  const rest = t.slice(1);
  const exempt = new Set<W>(); // text a command only reads: a commit message, a search pattern
  if (cmd === 'git' && rest.some((w) => w.s === 'commit')) rest.forEach((w, i) => (/^(-m|--message)$/.test(w.s) && rest[i + 1] ? exempt.add(rest[i + 1]!) : /^(-m.|--message=)/.test(w.s) && exempt.add(w)));
  if (/^(sed|awk|gawk|grep|egrep|fgrep|rg)$/.test(cmd)) rest.filter((w) => !w.s.startsWith('-'))[0] && exempt.add(rest.filter((w) => !w.s.startsWith('-'))[0]!);
  for (const w of all) {
    if (exempt.has(w)) continue;
    for (const p of w.q ? [w.s] : w.s.split(/[<>&]+/)) {
      const why = outside(p, root);
      if (why) return why;
    }
  }
  const inner = /^(ba|z)?sh$/.test(cmd) ? rest[rest.findIndex((w) => /^-\w*c$/.test(w.s)) + 1]?.s : cmd === 'eval' ? rest.map((w) => w.s).join(' ') : undefined;
  if (inner) {
    const why = check(inner, root);
    if (why) return why;
  }
  if (cmd === 'find')
    for (const [i, w] of rest.entries()) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(w.s)) continue;
      const sub = rest.slice(i + 1);
      const stop = sub.findIndex((x) => x.s === ';' || x.s === '+');
      const why = judge(stop < 0 ? sub : sub.slice(0, stop), root);
      if (why) return why;
    }
  return whyRefused(t.map((w) => w.s));
}

const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;
// a heredoc body is data for the command that reads it, unless that command is a shell: before the marker, or piped to after it
const HEREDOC = /([^\n]*)<<-?\s*(['"]?)(\w+)\2([^\n]*)\n[\s\S]*?\n[ \t]*\3\b/g;
const PIPED_TO_SHELL = /\|\s*(?:\S*\/)?(?:(?:ba|z)?sh|eval)(?![\w.-])/;

function check(command: string, root?: string): string | undefined {
  const text = command.replace(/\\\n/g, ' ').replace(HEREDOC, (m, pre: string, _q: string, tag: string, post: string) => (/\b(ba|z)?sh\b|\beval\b/.test(pre) || PIPED_TO_SHELL.test(post) ? m : `${pre}<<${tag}${post}`));
  const c = normalizeCommand(text);
  if (!c) return 'it is empty';
  if (c.length > 1000) return 'it is too long';
  const blank = c.replace(QUOTED, '""');
  for (const [re, why] of BLOCKED.slice(1)) if (re.test(blank)) return why; // [0] is sudo, judged by command position instead
  const na = needsApproval(blank);
  if (na) return na;
  for (const s of subs(text)) {
    const why = check(s, root);
    if (why) return why;
  }
  for (const cmd of scan(text)) {
    const why = judge(cmd, root);
    if (why) return why;
  }
  return undefined;
}

/**
 * Whether an agent may run this command in a folder the person trusted. Pure text, so it is cheap to import from a hook.
 * Chained, nested and wrapped commands are each judged as if run alone. `root`, when given, is the folder: absolute paths inside it are fine.
 */
export function commandRule(command: string, root?: string): { ok: true } | { ok: false; why: string } {
  // shortcut: this matches text, so it stops mistakes, not a hostile project; the macOS Seatbelt port is the real boundary
  const why = check(command, root?.replace(/\/+$/, ''));
  return why ? { ok: false, why: `Not run: ${why}.` } : { ok: true };
}

/** What an agent reads when `commandRule` says no, from any model. */
export const refusal = (why: string) => `${why} Tell the person it did not run and why, and do not try to get around it.`;

/** One command from an agent's step, in its folder. Always text for the model: a refusal or a failure is an answer, never a throw. */
export async function runStepCommand(root: string, command: string, signal: AbortSignal): Promise<string> {
  const rule = commandRule(command, root);
  if (!rule.ok) return refusal(rule.why);
  if (signal.aborted) return 'Not run: this step was stopped.';
  try {
    const r = await spawnCommand(command, root, { timeoutMs: MAX_COMMAND_MS, maxBytes: MAX_COMMAND_OUTPUT, signal, reap: true });
    const head = r.timedOut ? `Stopped: it ran past ${MAX_COMMAND_MS / 1000} s.` : signal.aborted ? 'Stopped: this step was stopped.' : r.exit ? `Exit code ${r.exit}.` : '';
    const cut = r.output.length >= MAX_COMMAND_OUTPUT ? '[output cut: this is the end of it]' : '';
    return [head, cut, r.output].filter(Boolean).join('\n') || '(no output)';
  } catch (e) {
    return `Not run: ${(e as Error).message}`; // spawn refuses some text outright, like a NUL byte
  }
}
