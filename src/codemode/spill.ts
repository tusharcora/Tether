// Ported from deepseek-harness spill/spill-policy and spill/spill-local (MIT, © 2026 DeepSeek).
/**
 * Spill for oversized run_code output. The full text goes to `<workdir>/.tether/spill/<id>.txt` (owner-only), and the
 * model gets its head and tail within the result limit plus a notice naming the file and how to read it with repo.read.
 * `.tether/` holds a `.gitignore` of `*`, so git ignores the folder: spills never reach a diff, a commit or a search.
 * Spill files older than 24 hours are swept.
 */
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SPILL_DIR = '.tether/spill';
export const SPILL_MAX_AGE_MS = 24 * 3_600_000;
const GAP = '\n\n[...]\n\n';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The first (or last) `n` UTF-16 units, one fewer when the cut would split a surrogate pair. */
function end(text: string, n: number, tail: boolean): string {
  let cut = tail ? text.length - n : n;
  if (isHigh(text.charCodeAt(cut - 1)) && isLow(text.charCodeAt(cut))) cut += tail ? 1 : -1;
  return tail ? text.slice(cut) : text.slice(0, cut);
}

/** Contiguous ends of `text` within `budget` characters: half to each end, never overlapping; and the UTF-8 bytes left out. */
export function retain(text: string, budget: number): { head: string; tail: string; omittedBytes: number } {
  const head = end(text, Math.min(text.length, Math.ceil(budget / 2)), false);
  const rest = text.slice(head.length);
  const tail = end(rest, Math.min(rest.length, Math.floor(budget / 2)), true);
  return { head, tail, omittedBytes: bytes(text) - bytes(head) - bytes(tail) };
}

const notice = (omitted: number, rel: string) =>
  `(Omitted ${omitted} bytes. Full formatted result stored at: ${rel}. Read it in line ranges with repo.read("${rel}", { from: 1, to: 200 }), or return less from the script.)`;

/**
 * Save `text` and return its bounded preview (at most `max` characters), or undefined when it cannot be saved or the
 * notice alone would not fit: the caller then keeps its own cut.
 */
export async function spillText(workdir: string, text: string, max: number): Promise<string | undefined> {
  const rel = `${SPILL_DIR}/${randomBytes(6).toString('hex')}.txt`;
  const worst = notice(bytes(text), rel);
  if (worst.length > max) return undefined;
  if (!(await saveSpill(workdir, text, rel))) return undefined;
  const r = retain(text, Math.max(0, max - GAP.length - 2 - worst.length));
  return r.head || r.tail ? `${r.head}${GAP}${r.tail}\n\n${notice(r.omittedBytes, rel)}` : notice(r.omittedBytes, rel);
}

/** Save `text` as a spill file (owner-only, git-ignored) and return its path relative to `workdir`, or undefined when it cannot. */
export async function saveSpill(workdir: string, text: string, rel = `${SPILL_DIR}/${randomBytes(6).toString('hex')}.txt`): Promise<string | undefined> {
  try {
    await mkdir(join(workdir, SPILL_DIR), { recursive: true, mode: 0o700 });
    await writeFile(join(workdir, '.tether', '.gitignore'), '*\n', { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'EEXIST') throw e;
    });
    await writeFile(join(workdir, rel), text, { flag: 'wx', mode: 0o600 });
    return rel;
  } catch {
    return undefined;
  }
}

/** Delete regular spill files under `workdir` whose mtime is strictly older than the cutoff; symlinks and other entries are left alone. Never throws. */
export async function sweepSpills(workdir: string, now = Date.now()): Promise<void> {
  const dir = join(workdir, SPILL_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // no spills here
  }
  for (const name of names) {
    try {
      const st = await lstat(join(dir, name));
      if (st.isFile() && st.mtimeMs < now - SPILL_MAX_AGE_MS) await unlink(join(dir, name));
    } catch {
      /* raced away or unreadable: the next sweep tries again */
    }
  }
}
