/**
 * Workspaces: a project folder plus what the crew should know about it.
 *
 * A workspace is registered in <home>/workspaces.json (id → folder) and described by two files that live in the
 * project itself, so they are versioned with the code and shared with the team:
 *
 *   .aorch/workspace.json   structured facts: name, one-line summary, setup/build/test commands, goals, conventions,
 *                           things to avoid, the GitHub repos it is
 *   .aorch/project.md       free prose: what the project is, how it works, what it needs to do
 *
 * Every run started in a workspace (or in any folder that carries those files) gets the context pasted into each
 * agent's prompt, and its setup command becomes the run's default.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectTestCommand } from './composer.js';
import type { RunWorkspace } from './types.js';

export interface WorkspaceMeta {
  name?: string;
  summary?: string;
  setup?: string;
  build?: string;
  test?: string;
  goals?: string[];
  conventions?: string[];
  avoid?: string[];
  /** owner/repo names on GitHub this folder is a checkout of; lets a PR find its workspace */
  repos?: string[];
}

export interface Workspace {
  id: string;
  path: string;
  /** the folder is still there */
  exists: boolean;
  name: string;
  summary: string;
  setup?: string;
  build?: string;
  test?: string;
  goals: string[];
  conventions: string[];
  avoid: string[];
  repos: string[];
  /** contents of .aorch/project.md */
  notes: string;
  /** at least one of the two .aorch files exists */
  described: boolean;
  isDefault?: boolean;
}

interface Registry {
  default?: string;
  workspaces: { id: string; path: string }[];
}

export const WS_DIR = '.aorch';
export const META_FILE = 'workspace.json';
export const NOTES_FILE = 'project.md';
const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_NOTES = 20_000;
const MAX_CONTEXT = 9_000;

// ---------- registry ----------
const regPath = (home: string) => join(home, 'workspaces.json');

export function loadRegistry(home: string): Registry {
  try {
    const j = JSON.parse(readFileSync(regPath(home), 'utf8')) as Registry;
    const list = Array.isArray(j.workspaces) ? j.workspaces.filter((w) => w && typeof w.id === 'string' && ID_RE.test(w.id) && typeof w.path === 'string') : [];
    return { default: typeof j.default === 'string' && list.some((w) => w.id === j.default) ? j.default : undefined, workspaces: list };
  } catch {
    return { workspaces: [] };
  }
}

function saveRegistry(home: string, r: Registry): void {
  mkdirSync(home, { recursive: true });
  const f = regPath(home);
  writeFileSync(`${f}.tmp`, JSON.stringify(r, null, 2) + '\n');
  renameSync(`${f}.tmp`, f);
}

export const slugId = (name: string): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 28);
  return ID_RE.test(base) ? base : 'project';
};

// ---------- reading ----------
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max) : undefined);
const strs = (v: unknown, max: number, n = 30): string[] => (Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, n) : []);

/** The two committed files, parsed leniently: a broken file never stops a run. */
export function readMeta(dir: string): { meta: WorkspaceMeta; notes: string; described: boolean } {
  let meta: WorkspaceMeta = {};
  let described = false;
  try {
    const j = JSON.parse(readFileSync(join(dir, WS_DIR, META_FILE), 'utf8')) as Record<string, unknown>;
    described = true;
    meta = {
      name: str(j.name, 80),
      summary: str(j.summary, 400),
      setup: str(j.setup, 300),
      build: str(j.build, 300),
      test: str(j.test, 300),
      goals: strs(j.goals, 300),
      conventions: strs(j.conventions, 300),
      avoid: strs(j.avoid, 300),
      repos: strs(j.repos, 100).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)),
    };
  } catch {
    /* no file, or not valid JSON */
  }
  let notes = '';
  try {
    notes = readFileSync(join(dir, WS_DIR, NOTES_FILE), 'utf8').slice(0, MAX_NOTES).trim();
    if (notes) described = true;
  } catch {
    /* no notes */
  }
  return { meta, notes, described };
}

/** One folder as a workspace. Missing facts fall back to what can be detected (package name, test command). */
export function readWorkspace(id: string, dir: string): Workspace {
  const path = resolve(dir);
  const { meta, notes, described } = readMeta(path);
  const exists = existsSync(path);
  return {
    id,
    path,
    exists,
    name: meta.name ?? detectName(path),
    summary: meta.summary ?? detectSummary(path) ?? '',
    setup: meta.setup,
    build: meta.build,
    test: meta.test ?? (exists ? detectTestCommand(path) : undefined),
    goals: meta.goals ?? [],
    conventions: meta.conventions ?? [],
    avoid: meta.avoid ?? [],
    repos: meta.repos?.length ? meta.repos : exists ? detectRepos(path) : [],
    notes,
    described,
  };
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
const detectName = (dir: string) => str(readJson(join(dir, 'package.json'))?.name, 80) ?? basename(dir);
const detectSummary = (dir: string) => str(readJson(join(dir, 'package.json'))?.description, 400);

function detectRepos(dir: string): string[] {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
    const m = url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i);
    return m ? [m[1]!] : [];
  } catch {
    return [];
  }
}

export function listWorkspaces(home: string): Workspace[] {
  const r = loadRegistry(home);
  return r.workspaces.map((w) => ({ ...readWorkspace(w.id, w.path), isDefault: r.default === w.id }));
}

export function getWorkspace(home: string, id: string): Workspace | undefined {
  return listWorkspaces(home).find((w) => w.id === id);
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/**
 * Which workspace a run belongs to: the one asked for, else the registered one whose folder holds the repo (the
 * deepest wins), else a folder that carries its own .aorch files, else none.
 */
export function resolveWorkspace(home: string, q: { workspace?: string; repo: string }): Workspace | undefined {
  const all = listWorkspaces(home);
  if (q.workspace) {
    const w = all.find((x) => x.id === q.workspace);
    if (!w) throw new Error(`unknown workspace "${q.workspace}" (see: aorch workspace list)`);
    return w;
  }
  const repo = real(q.repo);
  const hit = all.filter((w) => w.exists && inside(repo, real(w.path))).sort((a, b) => b.path.length - a.path.length)[0];
  if (hit) return hit;
  const local = readWorkspace('local', q.repo);
  return local.described ? local : undefined;
}

/** The registered workspace that is a checkout of this GitHub repo, for PRs and webhooks. */
export function workspaceForRepo(home: string, slug: string): Workspace | undefined {
  const s = slug.toLowerCase();
  return listWorkspaces(home).find((w) => w.exists && w.repos.some((r) => r.toLowerCase() === s));
}

// ---------- the text the agents see ----------
export function contextOf(w: Workspace): string {
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
  const parts = [`# Project: ${w.name}`];
  if (w.summary) parts.push(w.summary);
  const how = [w.setup && `- install / setup: \`${w.setup}\``, w.build && `- build: \`${w.build}\``, w.test && `- test: \`${w.test}\``].filter(Boolean);
  if (how.length) parts.push(`## How to work here\n${how.join('\n')}`);
  if (w.goals.length) parts.push(`## What it needs to do\n${bullets(w.goals)}`);
  if (w.conventions.length) parts.push(`## Conventions\n${bullets(w.conventions)}`);
  if (w.avoid.length) parts.push(`## Do not\n${bullets(w.avoid)}`);
  if (w.notes) parts.push(`## Project notes\n${w.notes}`);
  const out = parts.join('\n\n');
  return out.length > MAX_CONTEXT ? out.slice(0, MAX_CONTEXT - 40) + '\n\n[… project notes truncated]' : out;
}

/** What a run remembers about its workspace: enough to show it and to re-send the context. */
export const snapshot = (w: Workspace): RunWorkspace => ({ id: w.id, name: w.name, context: contextOf(w) });

// ---------- creating ----------
export const NOTES_TEMPLATE = (name: string) => `# ${name}

## What this project is
One or two paragraphs: who uses it and what problem it solves.

## How it works
The main parts and how they fit together: entry points, data flow, where the important code lives.

## What it needs to do
The current goals, in order. What "done" looks like for the work in progress.

## Rules of the house
Style, testing and review expectations; things that must not change; places that are fragile.
`;

export interface InitResult {
  workspace: Workspace;
  created: string[];
  existed: boolean;
}

/** Register a folder, writing the two files if they are missing (never overwriting). */
export function initWorkspace(home: string, dir: string, o: { name?: string; id?: string; write?: boolean } = {}): InitResult {
  const path = real(dir);
  if (!existsSync(path)) throw new Error(`${dir} does not exist`);
  const reg = loadRegistry(home);
  const prior = reg.workspaces.find((w) => real(w.path) === path);
  const created: string[] = [];
  if (o.write !== false) {
    const base = readWorkspace('x', path);
    mkdirSync(join(path, WS_DIR), { recursive: true });
    const metaFile = join(path, WS_DIR, META_FILE);
    if (!existsSync(metaFile)) {
      const meta: WorkspaceMeta = { name: o.name ?? base.name, summary: base.summary || undefined, test: base.test, repos: base.repos.length ? base.repos : undefined, goals: [], conventions: [], avoid: [] };
      writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
      created.push(`${WS_DIR}/${META_FILE}`);
    }
    const notesFile = join(path, WS_DIR, NOTES_FILE);
    if (!existsSync(notesFile)) {
      writeFileSync(notesFile, NOTES_TEMPLATE(o.name ?? base.name));
      created.push(`${WS_DIR}/${NOTES_FILE}`);
    }
  }
  if (prior) return { workspace: { ...readWorkspace(prior.id, path), isDefault: reg.default === prior.id }, created, existed: true };
  const taken = new Set(reg.workspaces.map((w) => w.id));
  let id = o.id ?? slugId(o.name ?? readWorkspace('x', path).name);
  if (o.id && taken.has(id)) throw new Error(`a workspace called "${id}" already exists`);
  for (let i = 2; taken.has(id); i++) id = `${slugId(o.name ?? id).slice(0, 26)}-${i}`;
  reg.workspaces.push({ id, path });
  if (!reg.default) reg.default = id;
  saveRegistry(home, reg);
  return { workspace: { ...readWorkspace(id, path), isDefault: reg.default === id }, created, existed: false };
}

export function removeWorkspace(home: string, id: string): boolean {
  const reg = loadRegistry(home);
  const next = reg.workspaces.filter((w) => w.id !== id);
  if (next.length === reg.workspaces.length) return false;
  saveRegistry(home, { default: reg.default === id ? next[0]?.id : reg.default, workspaces: next });
  return true;
}

export function setDefaultWorkspace(home: string, id: string): boolean {
  const reg = loadRegistry(home);
  if (!reg.workspaces.some((w) => w.id === id)) return false;
  saveRegistry(home, { ...reg, default: id });
  return true;
}

/** Change facts in .aorch/workspace.json (creating it if needed). Lists replace; an empty string clears a field. */
export function updateMeta(dir: string, patch: Partial<WorkspaceMeta>): WorkspaceMeta {
  const file = join(dir, WS_DIR, META_FILE);
  const cur = readJson(file) ?? {};
  const next: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length && k !== 'goals' && k !== 'conventions' && k !== 'avoid')) delete next[k];
    else next[k] = v;
  }
  mkdirSync(join(dir, WS_DIR), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return readMeta(dir).meta;
}

/** Add one line to a list in .aorch/workspace.json (goals, conventions or avoid). */
export function addToList(dir: string, key: 'goals' | 'conventions' | 'avoid', line: string): void {
  const cur = readMeta(dir).meta[key] ?? [];
  if (cur.includes(line)) return;
  updateMeta(dir, { [key]: [...cur, line] });
}

export function writeNotes(dir: string, text: string): void {
  mkdirSync(join(dir, WS_DIR), { recursive: true });
  writeFileSync(join(dir, WS_DIR, NOTES_FILE), text.trimEnd() + '\n');
}

/** What a read-only agent is asked when it drafts project.md for you. */
export const SURVEY_PROMPT =
  'Survey this repository and write the project notes a new teammate (or another AI agent) would want before touching it. ' +
  'Read the README, the manifest files, the entry points and the tests; do not modify any file. ' +
  'Output ONLY the markdown for .aorch/project.md with these sections: "# <project name>", "## What this project is", ' +
  '"## How it works" (main parts, data flow, where the important code lives), "## What it needs to do" (current goals, inferred from ' +
  'TODOs, open work and the README), "## Rules of the house" (style, testing, fragile areas, things not to change). ' +
  'Be concrete: name real files and commands. Keep it under 120 lines. If you are unsure of something, say so rather than guessing.';
