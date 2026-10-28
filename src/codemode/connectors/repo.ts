/**
 * `repo`: the run's worktree, through the Code screen's one path gate (resolveInWorkspace: no `..`, no absolute paths, no
 * .git, no symlink out) and its secrets rule (.env, keys: never read, written or searched). Writes only on writable steps.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isSecretPath, looksBinary, resolveInWorkspace } from '../../code.js';
import { searchText } from '../../codeSearch.js';
import { git } from '../../git.js';
import type { Connector, Method } from '../types.js';

const MAX_READ = 64_000;
const MAX_WRITE = 512_000;
const MAX_LIST = 400;
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', '__pycache__', '.venv']);

/** The gate's refusals are HttpErrors; inside a script they are plain errors with the same words. */
function gate(root: string, rel: unknown): { abs: string; rel: string } {
  if (typeof rel !== 'string') throw new Error('the path must be a string, relative to the repository root');
  const r = resolveInWorkspace(root, rel || '.');
  if (r.rel && isSecretPath(r.rel)) throw new Error(`${r.rel} is a secrets file: it is never read or written by agents`);
  return r;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : d);

export function repoConnector(o: { workdir: string; writable: boolean; base?: string }): Connector {
  const root = o.workdir;
  const methods: Method[] = [
    {
      name: 'list',
      summary: 'List a folder of the repository (folders end with /).',
      params: [{ name: 'dir', schema: { type: 'string', description: 'Relative to the repo root; default "."' }, optional: true }],
      returns: 'string[]',
      async run([dir]) {
        const { abs } = gate(root, dir ?? '.');
        const entries = await readdir(abs, { withFileTypes: true });
        return entries
          .filter((e) => !SKIP.has(e.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, MAX_LIST)
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      },
    },
    {
      name: 'read',
      summary: 'Read a text file, optionally only lines from..to (1-based, inclusive).',
      params: [
        { name: 'path', schema: { type: 'string' } },
        { name: 'opts', schema: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } } }, optional: true },
      ],
      returns: 'string',
      async run([path, opts]) {
        const { abs, rel } = gate(root, path);
        if (!(await stat(abs)).isFile()) throw new Error(`${rel} is not a file`);
        const buf = await readFile(abs);
        if (looksBinary(buf)) throw new Error(`${rel} is a binary file`);
        let text = buf.toString('utf8');
        const o2 = (opts ?? {}) as { from?: unknown; to?: unknown };
        if (o2.from !== undefined || o2.to !== undefined) {
          const lines = text.split('\n');
          const from = Math.max(1, num(o2.from, 1));
          text = lines.slice(from - 1, Math.max(from - 1, num(o2.to, lines.length))).join('\n');
        }
        return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[... ${text.length - MAX_READ} more characters: read a line range]` : text;
      },
    },
    {
      name: 'search',
      summary: 'Find lines containing a text (case-insensitive unless it has capitals) across the repository or under a path.',
      params: [
        { name: 'pattern', schema: { type: 'string' } },
        { name: 'opts', schema: { type: 'object', properties: { path: { type: 'string', description: 'Only under this folder or file' }, max: { type: 'integer', description: 'Default 50' } } }, optional: true },
      ],
      returns: '{ path: string; line: number; text: string }[]',
      async run([pattern, opts]) {
        if (typeof pattern !== 'string' || !pattern) throw new Error('search needs a non-empty pattern');
        const o2 = (opts ?? {}) as { path?: unknown; max?: unknown };
        const under = o2.path !== undefined ? gate(root, o2.path).rel : '';
        const { hits } = await searchText(root, pattern);
        return hits
          .filter((h) => !isSecretPath(h.path) && (!under || h.path === under || h.path.startsWith(`${under}/`)))
          .slice(0, Math.min(200, Math.max(1, num(o2.max, 50))))
          .map((h) => ({ path: h.path, line: h.line, text: h.text.trim().slice(0, 200) }));
      },
    },
    {
      name: 'diff',
      summary: o.base ? 'The changes in this run so far (a unified diff against where the run started).' : 'Uncommitted changes (a unified diff against HEAD).',
      returns: 'string',
      async run() {
        const r = await git(root, ['diff', o.base ?? 'HEAD', '--']);
        const text = r.stdout;
        return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[... diff cut at ${MAX_READ} characters]` : text || '(no changes)';
      },
    },
  ];
  if (o.writable)
    methods.push({
      name: 'write',
      summary: 'Create or overwrite a file with the full new text.',
      params: [
        { name: 'path', schema: { type: 'string' } },
        { name: 'text', schema: { type: 'string' } },
      ],
      returns: 'string',
      write: true,
      async run([path, text]) {
        if (typeof text !== 'string') throw new Error('write needs the full text as a string');
        if (text.length > MAX_WRITE) throw new Error(`too large (max ${MAX_WRITE} characters)`);
        const { abs, rel } = gate(root, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, text);
        return `wrote ${rel} (${text.length} characters)`;
      },
    });
  else
    methods.push({
      name: 'write',
      summary: 'Not available: this step is read-only.',
      params: [
        { name: 'path', schema: { type: 'string' } },
        { name: 'text', schema: { type: 'string' } },
      ],
      write: true,
      run: async () => {
        throw new Error('this step is read-only: repo.write is not available');
      },
    });
  return { name: 'repo', summary: `this run's repository: list, read, search, diff${o.writable ? ', write' : ' (read-only step)'}`, methods: async () => methods };
}
