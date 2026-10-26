/** Code search for the Code screen and ⌘K: file names (fuzzy) and text (ripgrep, or a capped walk without it). Secrets never match. */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gitFiles, gitInfo, isSecretPath, looksBinary, MAX_TEXT, resolveInWorkspace } from './code.js';
import { rgVersion } from './tools.js';

export interface TextHit {
  path: string;
  line: number;
  /** Where the match starts in `text` (0-based characters). */
  col: number;
  text: string;
}

export const MAX_HITS = 200;
const MAX_NAMES = 50;
/** The fallback walk stops here, and so does a non-git folder's file list. */
const WALK_MS = 2000;
const MAX_WALK = 20_000;
const RG_MS = 5000;
const LINE_MAX = 300;

/** Every file of the project: git's list in a repo (ignored files left out), else a capped walk that skips .git. */
export async function projectFiles(root: string): Promise<string[]> {
  if ((await gitInfo(root)).git) return gitFiles(root);
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_WALK) return;
      if (d.name === '.git') continue;
      const r = rel + d.name;
      if (d.isDirectory()) walk(join(dir, d.name), `${r}/`);
      else if (d.isFile()) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

/** Fuzzy score of `q` against a path, or undefined when not every character of `q` appears in order. Name matches rank first. */
function score(path: string, q: string): number | undefined {
  const p = path.toLowerCase();
  const name = p.slice(p.lastIndexOf('/') + 1);
  if (name.startsWith(q)) return 3000 - name.length;
  if (name.includes(q)) return 2000 - name.length;
  if (p.includes(q)) return 1000 - p.length;
  let at = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = p.indexOf(ch, at + 1);
    if (next < 0) return undefined;
    gaps += next - at - 1;
    at = next;
  }
  return 500 - gaps - p.length / 100;
}

export async function searchNames(root: string, query: string): Promise<{ hits: { path: string }[] }> {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { hits: [] };
  const ranked = (await projectFiles(root)).flatMap((path) => {
    const s = isSecretPath(path) ? undefined : score(path, q);
    return s === undefined ? [] : [{ path, s }];
  });
  return { hits: ranked.sort((a, b) => b.s - a.s || a.path.length - b.path.length).slice(0, MAX_NAMES).map(({ path }) => ({ path })) };
}

/** A hit's line, cut to 300 characters around the match. */
function hit(path: string, line: number, text: string, col: number): TextHit {
  if (text.length <= LINE_MAX) return { path, line, col, text };
  const start = Math.max(0, col - 80);
  return { path, line, col: col - start, text: text.slice(start, start + LINE_MAX) };
}

/** ripgrep: smart case, fixed strings, hidden files but never .git or secrets, files up to 2 MB, at most 200 hits. */
function searchRg(rg: string, root: string, q: string): Promise<{ hits: TextHit[]; truncated: boolean }> {
  const args = ['--json', '--max-count', String(MAX_HITS), '--max-filesize', '2M', '--hidden', '--fixed-strings', '--smart-case', '-g', '!.git', '-g', '!.env', '-g', '!.env.*', '-g', '!*.pem', '-g', '!*.key', '-g', '!id_*', '--', q, '.'];
  return new Promise((resolve, reject) => {
    const child = spawn(rg, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    const hits: TextHit[] = [];
    let truncated = false;
    let rest = '';
    const stop = () => ((truncated = true), child.kill());
    const timer = setTimeout(stop, RG_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop()!;
      for (const l of lines) {
        if (truncated) return;
        let m: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string }; submatches?: { start: number }[] } };
        try {
          m = JSON.parse(l);
        } catch {
          continue;
        }
        if (m.type !== 'match' || !m.data?.path?.text || m.data.lines?.text === undefined) continue;
        const path = m.data.path.text.replace(/^\.\//, '');
        if (isSecretPath(path)) continue;
        const text = m.data.lines.text.replace(/\r?\n$/, '');
        const col = Buffer.from(text).subarray(0, m.data.submatches?.[0]?.start ?? 0).toString('utf8').length;
        hits.push(hit(path, m.data.line_number ?? 0, text, col));
        if (hits.length >= MAX_HITS) stop();
      }
    });
    child.on('error', (e) => (clearTimeout(timer), reject(e)));
    child.on('close', () => (clearTimeout(timer), resolve({ hits, truncated })));
  });
}

/** Without ripgrep: the project's files in order, smart case, skipping secrets, binaries and files over 2 MB; stops at 200 hits or 2 s. */
async function searchWalk(root: string, q: string): Promise<{ hits: TextHit[]; truncated: boolean }> {
  const fold = q === q.toLowerCase();
  const deadline = Date.now() + WALK_MS;
  const hits: TextHit[] = [];
  for (const path of await projectFiles(root)) {
    if (Date.now() > deadline) return { hits, truncated: true };
    if (isSecretPath(path)) continue;
    let buf: Buffer;
    try {
      const { abs } = resolveInWorkspace(root, path); // never follow a symlink out of the project
      if (statSync(abs).size > MAX_TEXT) continue;
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!.replace(/\r$/, '');
      const col = (fold ? text.toLowerCase() : text).indexOf(q);
      if (col < 0) continue;
      hits.push(hit(path, i + 1, text, col));
      if (hits.length >= MAX_HITS) return { hits, truncated: true };
    }
  }
  return { hits, truncated: false };
}

/** Text search: ripgrep when it is on PATH (`rg: null` forces the walk), else the walk. */
export function searchText(root: string, q: string, o: { rg?: string | null } = {}): Promise<{ hits: TextHit[]; truncated: boolean }> {
  const rg = o.rg === undefined ? (rgVersion() ? 'rg' : null) : o.rg;
  return rg ? searchRg(rg, root, q) : searchWalk(root, q);
}
