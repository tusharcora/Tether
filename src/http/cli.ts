/** `aorch http …`: the API client from a terminal (and from agents, which run inside a run's worktree). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../store.js';
import { bold, dim, green, red, safeText } from '../ui.js';
import { passed } from './assert.js';
import { describeCheckResult, describeResult } from './describe.js';
import { HttpClientError } from './errors.js';
import { applyImport, previewImport, type ImportKind } from './import.js';
import { activeEnv, runRequest, setActiveEnv } from './index.js';
import { deleteSecret, secretKeys, setSecret } from './secrets.js';
import { listEnvironments, listRequests, readEnvironment, requestExists } from './store.js';
import type { SendOutput } from './types.js';
import { projectFromCwd } from './workspace.js';

export interface HttpCliFlags {
  json?: boolean;
  env?: string;
  header?: string[];
  data?: string;
  kind?: string;
  into?: string;
  yes?: boolean;
  workspace?: string;
}
export interface HttpCliIo {
  out(s: string): void;
  err(s: string): void;
  readStdin(): string;
  confirm(q: string): Promise<boolean>;
  isTTY: boolean;
}

export const HTTP_USAGE = `usage:
  aorch http ls [--json]
  aorch http run <id> [--env <name>] [--json]
  aorch http send <METHOD> <url> [-H "k: v"] [-d body] [--env <name>] [--json]
  aorch http import <file|-> --kind curl|openapi|postman [--into <collection>] [--yes]
  aorch http env ls | use <name> | none
  aorch http secret set <key> | rm <key> | ls      (set reads the value from stdin)`;

const BODY_HEAD = 2048;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/**
 * A redacted result for the terminal: the one-line summary (describeResult), size, one line per check, body head.
 * Pass a SendOutput from runRequest (already redacted); server-sent control characters are stripped before printing.
 */
export function formatResult(o: SendOutput): string {
  const r = o.result;
  const ok = passed(r, o.checks) && r.status < 400;
  const lines = [(ok ? bold : red)(safeText(describeResult(o.request, r, o.checks)))];
  if (!r.error) lines.push(dim(`${kb(r.size)}${r.truncated ? ' · truncated at 5 MB' : ''}`));
  for (const c of o.checks) lines.push(c.ok ? green(`✔ ${describeCheckResult(c)}`) : red(`✘ ${safeText(describeCheckResult(c))}`));
  if (r.body) lines.push('', safeText(r.body.slice(0, BODY_HEAD)) + (r.body.length > BODY_HEAD ? dim(`\n… ${kb(r.body.length - BODY_HEAD)} more`) : ''));
  return lines.join('\n');
}

/** 0 = sent and every check held, 1 = a check failed, 2 = network error. */
const exitFor = (o: SendOutput) => (o.result.status === 0 ? 2 : passed(o.result, o.checks) ? 0 : 1);

export async function httpCommand(home: string, cwd: string, args: string[], f: HttpCliFlags, io: HttpCliIo): Promise<number> {
  const usage = () => (io.err(HTTP_USAGE), 2);
  const [sub = 'ls', a1, a2] = args.slice(1);
  let store: Store | undefined;
  const db = () => (store ??= Store.open(join(home, 'runs.db'))).raw();
  try {
    const proj = projectFromCwd(home, cwd, f.workspace);
    const show = (o: SendOutput) => (io.out(f.json ? JSON.stringify(o) : formatResult(o)), exitFor(o));
    switch (sub) {
      case 'ls': {
        const reqs = listRequests(proj.dir);
        if (f.json) return io.out(JSON.stringify(reqs)), 0;
        if (!reqs.length) return io.out(dim('no saved requests here (.aorch/http). Import some: aorch http import <file> --kind openapi')), 0;
        const w = Math.min(36, Math.max(...reqs.map((r) => r.id.length)));
        for (const r of reqs) io.out(r.invalid ? `${r.id.padEnd(w)}  ${red(`invalid: ${safeText(r.invalid)}`)}` : `${r.id.padEnd(w)}  ${r.method.padEnd(7)} ${safeText(r.url)}  ${dim(safeText(r.note ?? r.name))}`);
        return 0;
      }
      case 'run': {
        if (!a1) return usage();
        return show(await runRequest({ home, db: db(), workspace: proj.scope, dir: proj.dir, envDir: proj.envDir, id: a1, env: f.env, source: 'cli', allowSecrets: true }));
      }
      case 'send': {
        if (!a1 || !a2) return usage();
        const headers = (f.header ?? []).map((h) => {
          const i = h.indexOf(':');
          if (i <= 0) throw new HttpClientError('invalid', `a header must look like "Name: value" (got "${safeText(h)}")`);
          return { key: h.slice(0, i).trim(), value: h.slice(i + 1).trim(), on: true };
        });
        let body: unknown = { kind: 'none' };
        if (f.data !== undefined) {
          try {
            body = { kind: 'json', value: JSON.parse(f.data) };
          } catch {
            body = { kind: 'text', value: f.data };
          }
        }
        const draft = { v: 1, name: 'ad-hoc', method: a1.toUpperCase(), url: a2, headers, body };
        // ad-hoc: allowSecrets false, so a {{var}} that is a secret fails with "secret not available for ad-hoc requests"
        return show(await runRequest({ home, db: db(), workspace: proj.scope, dir: proj.dir, envDir: proj.envDir, draft, env: f.env, source: 'cli', allowSecrets: false }));
      }
      case 'import': {
        if (!a1) return usage();
        if (f.kind !== 'curl' && f.kind !== 'openapi' && f.kind !== 'postman') return io.err('--kind must be curl, openapi or postman'), 2;
        let text: string;
        try {
          text = a1 === '-' ? io.readStdin() : readFileSync(a1, 'utf8');
        } catch (e) {
          return io.err(`${red('✘ error')} cannot read ${a1}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`), 2;
        }
        const pv = previewImport(f.kind as ImportKind, text, { into: f.into, exists: (id) => requestExists(proj.dir, id) });
        if (pv.error) return io.err(`cannot import: ${pv.error}`), 2;
        for (const c of pv.create) io.out(`${green('+')} ${c.id}  ${dim(`${c.file.method} ${safeText(c.file.url)}`)}`);
        for (const s of pv.skip) io.out(`${red('-')} ${safeText(s.name)}: ${s.reason}`);
        for (const w of pv.warnings) io.out(`! ${safeText(w)}`);
        const go = f.yes || (io.isTTY && a1 !== '-' && (await io.confirm(`write ${pv.create.length} request(s) into .aorch/http?`)));
        if (!go) return io.err('nothing written; run again with --yes to write the files'), 2;
        const created = applyImport(proj.dir, pv);
        io.out(green(`✔ wrote ${created.length} request(s)`));
        return 0;
      }
      case 'env': {
        if (a1 === 'ls' || !a1) {
          const cur = activeEnv(home, proj.scope);
          const envs = listEnvironments(proj.envDir);
          if (f.json) return io.out(JSON.stringify({ environments: envs, active: cur })), 0;
          for (const e of envs) io.out(`${e === cur ? green('●') : dim('○')} ${e}`);
          if (!envs.length) io.out(dim('no environments (.aorch/http/environments/<name>.json)'));
          return 0;
        }
        if (a1 === 'use' && a2) {
          readEnvironment(proj.envDir, a2);
          setActiveEnv(home, proj.scope, a2);
          return io.out(`${green('✔')} ${a2} is the active environment for ${proj.scope}`), 0;
        }
        if (a1 === 'none') return setActiveEnv(home, proj.scope, null), io.out(`${green('✔')} no active environment for ${proj.scope}`), 0;
        return usage();
      }
      case 'secret': {
        if (a1 === 'ls' || !a1) {
          const keys = secretKeys(home, proj.scope);
          if (f.json) return io.out(JSON.stringify({ keys })), 0;
          for (const k of keys) io.out(k);
          if (!keys.length) io.out(dim(`no secrets for ${proj.scope}`));
          return 0;
        }
        if (a1 === 'set' && a2) {
          // the value comes from stdin only, never argv (argv shows up in `ps` and shell history)
          if (io.isTTY) io.err(dim('type the value, then press Ctrl-D:'));
          setSecret(home, proj.scope, a2, io.readStdin().replace(/\r?\n$/, ''));
          return io.out(`${green('✔')} saved secret ${a2} for ${proj.scope} ${dim('(the value is never printed)')}`), 0;
        }
        if (a1 === 'rm' && a2) return io.out(deleteSecret(home, proj.scope, a2) ? `${green('✔')} removed ${a2}` : dim(`no secret ${a2}`)), 0;
        return usage();
      }
      default:
        return usage();
    }
  } catch (e) {
    // every HttpClientError (unknown vars, ad-hoc secret, secrets file, no environment, the aorch home as cwd) is one line, exit 2
    if (e instanceof HttpClientError) return io.err(`${red('✘ error')} ${safeText(e.message)}`), 2;
    throw e;
  } finally {
    store?.close();
  }
}
