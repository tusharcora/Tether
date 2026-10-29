/**
 * The person's saved prompts, per project beside the artifacts: `<project>/.aorch/prompts.json` (no project:
 * `<home>/prompts.json`), `{ "prompts": [{ id, name, body, variables }] }`. `variables` are the body's `{{name}}` tokens,
 * read on every save. A symlinked .aorch or prompts.json is refused; the file is written to a fresh temp name and renamed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HttpError } from '../serverkit.js';
import type { SavedPrompt } from './types.js';

export const PROMPT_ID_RE = /^p-[a-z0-9]{4,24}$/;
export const PROMPTS_MAX = 200;
const NAME_MAX = 80;
export const PROMPT_BODY_MAX = 20_000;
const VAR_RE = /\{\{\s*([A-Za-z_][\w-]{0,39})\s*\}\}/g;

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** The prompts file: the project's, or with no project Tether's home's. */
export function promptsFile(home: string, root?: string): string {
  const file = root ? join(root, '.aorch', 'prompts.json') : join(home, 'prompts.json');
  if ((root && isLink(join(root, '.aorch'))) || isLink(file)) throw new HttpError(400, 'refusing a symlinked prompts file');
  return file;
}

/** `{{topic}}` and `{{ file }}` → ["topic", "file"], each once, in order. */
export const variablesOf = (body: string): string[] => [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]!))];

/** A name and a body from a request: one line of 1–80 characters, and 1–20,000 characters. */
export function checkPrompt(raw: Record<string, unknown>): { name: string; body: string } {
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `"name" is 1 to ${NAME_MAX} characters`);
  if (!body || body.length > PROMPT_BODY_MAX) throw new HttpError(400, `"body" is 1 to ${PROMPT_BODY_MAX} characters`);
  return { name, body };
}

export function listPrompts(file: string): SavedPrompt[] {
  if (!existsSync(file) || statSync(file).size > PROMPTS_MAX * (PROMPT_BODY_MAX + 500)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { prompts?: unknown };
    // a hand-edited file keeps what is well-formed
    return (Array.isArray(raw.prompts) ? raw.prompts : []).flatMap((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      if (typeof p.id !== 'string' || !PROMPT_ID_RE.test(p.id)) return [];
      try {
        const { name, body } = checkPrompt(p);
        return [{ id: p.id, name, body, variables: variablesOf(body) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function write(file: string, prompts: SavedPrompt[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ prompts }, null, 2)}\n`, { flag: 'wx' });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function createPrompt(file: string, raw: Record<string, unknown>): SavedPrompt {
  const { name, body } = checkPrompt(raw);
  const all = listPrompts(file);
  if (all.length >= PROMPTS_MAX) throw new HttpError(409, `at most ${PROMPTS_MAX} saved prompts`);
  const p: SavedPrompt = { id: `p-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, name, body, variables: variablesOf(body) };
  write(file, [...all, p]);
  return p;
}

export function updatePrompt(file: string, id: string, raw: Record<string, unknown>): SavedPrompt {
  if (!PROMPT_ID_RE.test(id)) throw new HttpError(400, 'not a prompt id');
  const all = listPrompts(file);
  const i = all.findIndex((p) => p.id === id);
  if (i < 0) throw new HttpError(404, 'no such prompt');
  const { name, body } = checkPrompt({ name: raw.name ?? all[i]!.name, body: raw.body ?? all[i]!.body });
  const p = { id, name, body, variables: variablesOf(body) };
  all[i] = p;
  write(file, all);
  return p;
}

export function deletePrompt(file: string, id: string): boolean {
  if (!PROMPT_ID_RE.test(id)) throw new HttpError(400, 'not a prompt id');
  const all = listPrompts(file);
  const left = all.filter((p) => p.id !== id);
  if (left.length === all.length) return false;
  write(file, left);
  return true;
}
