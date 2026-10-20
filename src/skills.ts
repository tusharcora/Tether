/**
 * Skills, two kinds:
 *  - Claude Code skills: folders with a SKILL.md under ~/.claude/skills and <repo>/.claude/skills.
 *    aorch only reads the name and a one-line description for display; a step that uses one just
 *    tells the agent to invoke it by name (the file's text is never copied into a prompt).
 *  - aorch skills: small reusable workflows (a few steps, each with its own instructions), built in
 *    or saved as JSON in <home>/skills/.
 */
import { existsSync, openSync, closeSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { blankPipeline, makeStep, relink, stepChoices } from './composer.js';
import { NAME_RE } from './pipeline.js';
import type { Pipeline } from './types.js';

export interface Skill {
  /** Unique within its source. */
  name: string;
  description: string;
  source: 'claude' | 'project' | 'aorch';
  /** aorch skills only. */
  steps?: { role: string; prompt?: string }[];
  builtin?: boolean;
}

const CLAUDE_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
const AORCH_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_SKILLS = 200;

const oneLine = (s: unknown, n: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '';

/** Minimal frontmatter reader: only `name:` and `description:` (plain or quoted, single line). */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !/^[>|][+-]?$/.test(v)) out[kv[1] as 'name' | 'description'] = v;
  }
  return out;
}

function head(file: string, bytes = 8192): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    return buf.toString('utf8', 0, readSync(fd, buf, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

function scan(dir: string, source: 'claude' | 'project'): Skill[] {
  const out: Skill[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const e of entries) {
    const file = join(dir, e, 'SKILL.md');
    try {
      if (!statSync(join(dir, e)).isDirectory() || !existsSync(file)) continue;
      const fm = parseFrontmatter(head(file));
      const name = fm.name && CLAUDE_NAME.test(fm.name) ? fm.name : CLAUDE_NAME.test(e) ? e : '';
      if (name) out.push({ name, description: oneLine(fm.description, 160), source });
    } catch {
      /* unreadable skill: skip it */
    }
    if (out.length >= MAX_SKILLS) break;
  }
  return out;
}

/** Claude Code skills visible from `repo`: the project's own first, then the user's. */
export function claudeSkills(repo?: string, home = homedir()): Skill[] {
  const seen = new Set<string>();
  const all = [...(repo ? scan(join(repo, '.claude', 'skills'), 'project') : []), ...scan(join(home, '.claude', 'skills'), 'claude')];
  return all.filter((s) => !seen.has(s.name) && !!seen.add(s.name)).slice(0, MAX_SKILLS);
}

export const BUILTIN_SKILLS: Skill[] = [
  { name: 'fix-failing-tests', description: 'fix the code until the test command passes, then review', source: 'aorch', builtin: true, steps: [{ role: 'coder', prompt: 'Run the tests, find why they fail, and fix the code (not the tests) with the smallest correct change.' }, { role: 'tester' }, { role: 'reviewer' }] },
  { name: 'write-tests', description: 'add missing tests for the described code and make them pass', source: 'aorch', builtin: true, steps: [{ role: 'coder', prompt: 'Add focused tests for the behaviour described in the task. Follow the repo\'s existing test style. Do not change production code unless a test exposes a real bug.' }, { role: 'tester' }] },
  { name: 'security-pass', description: 'read-only audit for injection, secrets, unsafe input handling', source: 'aorch', builtin: true, steps: [{ role: 'planner', prompt: 'Audit the code in scope for security problems: injection, unsafe shell or path handling, secrets in source, missing validation, unsafe deserialization. List findings by severity with file and line, and a concrete fix for each. Change nothing.' }] },
  { name: 'explain-codebase', description: 'read-only tour: layout, entry points, how a request flows', source: 'aorch', builtin: true, steps: [{ role: 'planner', prompt: 'Explain how this codebase is organised: the main directories, entry points, and how the main flow runs end to end. Keep it short and concrete, with file paths. Change nothing.' }] },
  { name: 'pr-review', description: 'review the current branch against its base', source: 'aorch', builtin: true, steps: [{ role: 'reviewer', prompt: 'Review the changes on this branch for correctness, missed edge cases and unclear code. Be specific.' }] },
  { name: 'full-review', description: 'deep read-only PR review: map, design, security, tests, then one write-up', source: 'aorch', builtin: true, steps: [
    { role: 'planner', prompt: 'Map this change: what it sets out to do, which files and behaviours it touches, and the riskiest parts. Use `git diff` against the base branch named in the task. Change nothing.' },
    { role: 'architect', prompt: 'Review the design of this change: does it fit the existing structure, are the boundaries and names sensible, is anything over- or under-built? Cite files. Change nothing.' },
    { role: 'planner', prompt: 'Review this change for security problems: injection, unsafe input handling, authz gaps, secrets, unsafe dependencies. Cite file and line. Say "none found" if so. Change nothing.' },
    { role: 'planner', prompt: 'Review the tests for this change: what is covered, what is missing, which edge cases and failure paths would you add? Do not run anything. Change nothing.' },
    { role: 'planner', prompt: 'Write the final review as one comment for the PR author, in markdown: a one-line summary, then Blocking issues, Suggestions and Nits (omit empty sections), each with file and line, and finish with a recommendation: approve, approve with comments, or request changes. Draw on the earlier steps; do not repeat them verbatim.' },
  ] },
  { name: 'update-docs', description: 'bring README and docs in line with the code', source: 'aorch', builtin: true, steps: [{ role: 'planner', prompt: 'Find places where the docs disagree with the code and list the exact edits needed.' }, { role: 'coder', prompt: 'Apply the doc edits from the previous step. Touch documentation only.' }, { role: 'reviewer' }] },
];

/** Built-in aorch skills plus valid ones from <home>/skills/*.json. Invalid files are ignored. */
export function aorchSkills(home: string): Skill[] {
  const out = [...BUILTIN_SKILLS];
  const names = new Set(out.map((s) => s.name));
  let files: string[] = [];
  try {
    files = readdirSync(join(home, 'skills')).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const s = parseAorchSkill(JSON.parse(readFileSync(join(home, 'skills', f), 'utf8')));
      if (s && !names.has(s.name)) (out.push(s), names.add(s.name));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function parseAorchSkill(raw: unknown): Skill | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !AORCH_NAME.test(r.name)) return undefined;
  if (!Array.isArray(r.steps) || r.steps.length < 1 || r.steps.length > 8) return undefined;
  const steps: NonNullable<Skill['steps']> = [];
  for (const s of r.steps) {
    if (!s || typeof s !== 'object') return undefined;
    const o = s as Record<string, unknown>;
    if (typeof o.role !== 'string' || !stepChoices().includes(o.role)) return undefined;
    const prompt = typeof o.prompt === 'string' ? o.prompt.slice(0, 4000) : undefined;
    steps.push({ role: o.role, ...(prompt ? { prompt } : {}) });
  }
  return { name: r.name, description: oneLine(r.description, 160), source: 'aorch', steps };
}

/** The line a step carries to invoke a Claude Code skill. The skill's own text is never copied. */
export const claudeSkillLine = (name: string) => `Use the “${name}” skill (invoke it with the Skill tool) for this step.`;

/** Make the workflow an aorch skill describes. */
export function skillPipeline(skill: Skill, testCommand?: string): Pipeline {
  const p = blankPipeline(skill.name);
  for (const st of skill.steps ?? []) {
    if (st.role === 'tester' && !testCommand) continue;
    const n = makeStep(st.role, p, undefined, testCommand);
    if (st.prompt) n.prompt = st.prompt;
    p.nodes.push(n);
  }
  return relink(p);
}

/** A one-step workflow that runs a Claude Code skill. */
export function claudeSkillPipeline(skill: Skill): Pipeline {
  const base = `skill-${skill.name}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  const p = blankPipeline(NAME_RE.test(base) ? base : 'skill-run');
  const n = makeStep('coder', p, 'claude');
  n.prompt = claudeSkillLine(skill.name);
  p.nodes.push(n);
  return relink(p);
}
