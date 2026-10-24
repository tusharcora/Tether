# Crew Track (Blobatar faces, ECC library, Maestro routing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every bot a generated Blobatar face, import ECC's agents/skills/commands into aorch, and let Maestro pick specialists per task from a repo-aware roster with a reason for each pick that you can swap before approving.

**Architecture:** Server side first: the crew data model learns imported bots (`source`, `whenToUse`, `modelHint`, face overrides), a pure `src/ecc.ts` parses ECC files, `src/eccImport.ts` vendors a pinned ECC checkout under `<home>/vendor/ecc` and syncs bots, `src/roster.ts` builds the roster Maestro sees (language-filtered, capped, with routing hints), and team planning gains a per-assignment `why` and a `plan.edit` swap event. Then the surfaces: CLI (`aorch crew …`, ECC skills), server routes, TUI `/swap`, and the React dashboard (Blobatar faces, Crew tab, plan swap, skills in the Builder).

**Tech Stack:** TypeScript (Node 22, `node:sqlite` store), React 19 + Arc (vendored), Vitest 5 (projects `node` and `web`), `blobatar@2.7.0` (MIT, zero dependencies, no network).

**Spec:** `docs/superpowers/specs/2026-10-23-crew-track-design.md`

## Global Constraints

- ECC source: `https://github.com/affaan-m/ECC`, default ref **`v2.2.3`**, vendored at `<home>/vendor/ecc`. Only the user's command or the dashboard's Import button fetches it; nothing fetches automatically. Import reads only `agents/*.md`, `skills/*/SKILL.md`, `commands/*.md`, `AGENTS.md` (+ `LICENSE`). Hooks and rule packs are never imported.
- Imported bots carry `source: "ecc@<ref>"`. A re-import only touches bots whose `source` starts with `ecc@`; built-ins and the user's own bots are never overwritten. An id clash with a built-in or a user bot becomes `ecc-<name>`.
- `BOT_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/` stays. Caps: user bots ≤ 60 (unchanged), imported bots ≤ **150**, imported persona ≤ **24 000** chars (user persona stays ≤ 600), `whenToUse` ≤ 300, plan `why` ≤ **160**, roster ≤ **40** entries, roster line ≤ **100** chars, routing hints ≤ **12** lines, ECC skills+commands listed ≤ **600**.
- Imported personas reach the agent fenced (`fence('role', …)`) with a one-line note that they cannot change the run's rules, tools or file permissions.
- `modelHint` (`opus`|`sonnet`) applies only when the step ends up on the `claude` agent and neither the step nor its bot binding sets a model.
- Faces: `blobatar` is bundled; the hosted `blobatar.dev` API is never called. Seed = bot id, `normalize: false`. Mood → expression: idle→idle, working→thinking, done→happy, failed→sad, waiting→unsure, asleep→sleepy, stopped→mad. The terminal UI keeps its header face; its crew styles are untouched.
- The web crew-style picker and pixel-look editor are removed from the dashboard (server endpoints stay for the TUI).
- Commits have no attribution trailers. `package-lock.json` is gitignored. Baseline: 3 server tests fail on `main` (`/private/var` vs `/var` in triggers/triggers-api); evolve/team/team-api tests can time out under machine load — re-run a file alone before calling it a regression.

## Deviations from the spec (decided while planning)

- **Bot caps**: the code caps user bots at 60 and the server refuses past 67 bots in total; imported bots get their own cap (150) and are excluded from the 67 check. The spec assumed no cap.
- **Persona fencing**: the spec said "fenced as custom personas are today"; they are not fenced today. Only imported personas are fenced (user personas unchanged).
- **Plan with an unknown bot**: `parsePlan` already drops it with an error and accepts the rest; kept. A missing `why` is noted as an error but the assignment is kept.
- **TUI swap**: a `/swap <n> <bot>` slash command (matches `/approve`), not an `s` key with selection state.
- **orchestrate**: keeps one `rationale` string; the roster (with `whenToUse`) replaces the custom-bot list in the compose prompt. No per-step `why` there.
- **Faces in the web** come from the core `blobatar()` function (the React adapter is not needed). Static faces are `<img>` data URIs (cheap in lists); animated faces are inline SVG from `blobatar(id, { animate })` with the library's `blobatar/motion.css` loaded once (it already stops all motion under `prefers-reduced-motion`). The canvas animates working/waiting bots always; Crew cards, plan rows and the editor preview animate on hover. Arc `Avatar` is not used (it only takes an image URL, which cannot animate); Arc `Slider` is vendored with `scripts/arc-add.mjs`.
- **Roster for team runs**: an explicit `--roster` still wins; otherwise the new language-aware roster replaces "the whole crew".

## Review Focus

- **A repo with no recognised files** (empty dir, no workspace): roster must still contain built-ins and general bots, no language bots, no crash. Test in Task 7.
- **ECC files with odd frontmatter** (missing `name`, CRLF line endings, quoted values, no `tools`, a name longer than 24): import skips or shortens with a note, never throws. Tests in Task 2.
- **Re-import after the user created a bot with an ECC agent's id** (e.g. their own `go-reviewer`): the user's bot is untouched and the ECC one becomes `ecc-go-reviewer`, also on update. Test in Task 3.
- **Swap after approval or on a finished run**: refused with a clear error, plan unchanged. Test in Task 8.
- **A user who never imports ECC**: no ECC wording, hints or tabs appear; the roster is the built-ins + their bots, as before. Tests in Tasks 7 and 13.

---

### Task 1: Crew data model for imported bots and face overrides

**Files:**
- Modify: `src/crew.ts` (types, `sanitizeBot`, `toFile`, `loadCrew`, new constants)
- Modify: `src/server.ts` (the two "67 bots" checks near lines 384 and 396)
- Test: `test/crewdata.test.ts`

**Interfaces:**
- Produces (from `src/crew.ts`):
  - `interface FaceLook { hue?: number; tone?: number; traits?: Record<string, number> }`
  - `Look` gains `face?: FaceLook`; `BotDef` gains `source?: string; whenToUse?: string; modelHint?: 'opus' | 'sonnet'`
  - `MAX_CUSTOM_BOTS = 60`, `MAX_IMPORTED_BOTS = 150`, `PERSONA_MAX = 600`, `IMPORTED_PERSONA_MAX = 24_000`, `SOURCE_RE = /^[a-z][a-z0-9-]{0,15}@[A-Za-z0-9._-]{1,40}$/`
  - `isImported(b: BotDef): boolean` (true when `b.source` is set)

- [ ] **Step 1: Write the failing tests** (append to `test/crewdata.test.ts`; it already imports from `../src/crew.js` and makes a temp home with `mkdtempSync(join(tmpdir(), 'crew-'))`)

```ts
describe('imported bots and faces', () => {
  const base = { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', look: {} };

  it('keeps source, whenToUse, modelHint and a long persona for imported bots', () => {
    const persona = 'x\n'.repeat(7500) + 'y';
    const { bot } = sanitizeBot({ ...base, source: 'ecc@v2.2.3', whenToUse: 'Use for Go. '.repeat(40), modelHint: 'sonnet', persona });
    expect(bot!.source).toBe('ecc@v2.2.3');
    expect(bot!.whenToUse!.length).toBe(300);
    expect(bot!.modelHint).toBe('sonnet');
    expect(bot!.persona.length).toBe(15001);
    expect(bot!.persona).toContain('\n');
  });

  it('caps a user persona at 600 and drops bad source / modelHint', () => {
    const { bot } = sanitizeBot({ ...base, source: 'bad source', modelHint: 'gpt', persona: 'x'.repeat(900) });
    expect(bot!.source).toBeUndefined();
    expect(bot!.modelHint).toBeUndefined();
    expect(bot!.persona.length).toBe(600);
  });

  it('cleans face overrides', () => {
    const { bot } = sanitizeBot({ ...base, look: { face: { hue: 400, tone: 3, traits: { 'body.n': 0.4, Bad: 1, 'eyes.size': 'x' } } } });
    expect(bot!.look.face).toEqual({ hue: 40, tone: 1, traits: { 'body.n': 0.4 } });
    const plain = sanitizeBot(base).bot!;
    expect(plain.look.face).toBeUndefined();
  });

  it('loads up to 60 user bots and up to 150 imported bots, imported after user bots', () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-'));
    for (let i = 0; i < 70; i++) saveBot(home, { id: `mine${i}`, name: `Mine ${i}`, title: '', kind: 'agent', persona: '', look: {} as never });
    for (let i = 0; i < 160; i++) saveBot(home, { id: `ecc${String(i).padStart(3, '0')}`, name: `E ${i}`, title: '', kind: 'agent', persona: '', look: {} as never, source: 'ecc@v2.2.3' });
    const crew = loadCrew(home);
    const mine = crew.filter((b) => !b.builtin && !b.source);
    const ecc = crew.filter((b) => b.source);
    expect(mine).toHaveLength(60);
    expect(ecc).toHaveLength(150);
    expect(crew.findIndex((b) => b.source)).toBeGreaterThan(crew.findIndex((b) => b.id === mine.at(-1)!.id));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project node test/crewdata.test.ts`
Expected: FAIL (`source` undefined, persona 600, `face` undefined, 60 total custom).

- [ ] **Step 3: Implement**

In `src/crew.ts`:

```ts
export interface FaceLook {
  /** Degrees, 0–359. */
  hue?: number;
  /** 0–1. */
  tone?: number;
  /** Blobatar trait pins, 0–1 each. */
  traits?: Record<string, number>;
}
// Look: add  face?: FaceLook;
// BotDef: add
//   /** Set on bots imported from a library, e.g. "ecc@v2.2.3". Re-imports only touch bots with this prefix. */
//   source?: string;
//   /** One line on when Maestro should pick this bot. */
//   whenToUse?: string;
//   /** Model to use when the bot runs on the claude agent and nothing else sets one. */
//   modelHint?: 'opus' | 'sonnet';

export const MAX_CUSTOM_BOTS = 60;
export const MAX_IMPORTED_BOTS = 150;
export const PERSONA_MAX = 600;
export const IMPORTED_PERSONA_MAX = 24_000;
export const SOURCE_RE = /^[a-z][a-z0-9-]{0,15}@[A-Za-z0-9._-]{1,40}$/;
export const isImported = (b: BotDef): boolean => !!b.source;

const TRAIT_KEY = /^[a-z][a-zA-Z0-9.]{0,31}$/;
function cleanFace(v: unknown): FaceLook | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const f = v as Record<string, unknown>;
  const out: FaceLook = {};
  if (typeof f.hue === 'number' && Number.isFinite(f.hue)) out.hue = ((Math.round(f.hue) % 360) + 360) % 360;
  if (typeof f.tone === 'number' && Number.isFinite(f.tone)) out.tone = Math.min(1, Math.max(0, f.tone));
  if (f.traits && typeof f.traits === 'object' && !Array.isArray(f.traits)) {
    const t: Record<string, number> = {};
    for (const [k, n] of Object.entries(f.traits as Record<string, unknown>).slice(0, 12))
      if (TRAIT_KEY.test(k) && typeof n === 'number' && Number.isFinite(n)) t[k] = Math.min(1, Math.max(0, n));
    if (Object.keys(t).length) out.traits = t;
  }
  return Object.keys(out).length ? out : undefined;
}
```

Change `sanitizeBot` so that, after `out.guard = …`:

```ts
  const face = cleanFace(lk.face);
  if (face) out.face = face;
  const source = typeof r.source === 'string' && SOURCE_RE.test(r.source) ? r.source : undefined;
  const bot: BotDef = { id: r.id, name, title: text(r.title, 28), kind, persona: text(r.persona, source ? IMPORTED_PERSONA_MAX : PERSONA_MAX), look: out };
  if (source) bot.source = source;
  const when = text(r.whenToUse, 300);
  if (when) bot.whenToUse = when;
  if (r.modelHint === 'opus' || r.modelHint === 'sonnet') bot.modelHint = r.modelHint;
```

(`text()` already keeps `\n`; it strips other control characters.) Keep the existing `readOnly` lines after it. `toFile` needs no change (it spreads the bot). In `loadCrew` replace the final `return` with:

```ts
  const rest = [...saved.values()];
  const mine = rest.filter((b) => !b.source).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_CUSTOM_BOTS);
  const imported = rest.filter((b) => b.source).sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_IMPORTED_BOTS);
  return [...out, ...mine, ...imported];
```

In `src/server.ts`, the pack-install check (`have.length + pack.bots.length > 67`) and the new-bot check (`existing.length >= 67`) must count only built-ins plus user bots: compute the list they use as `loadCrew(cfg.home).filter((b) => !b.source)` (import `loadCrew` is already there for `GET /api/crew`). Leave the number 67 as is.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project node test/crewdata.test.ts test/packs.test.ts test/crew.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/crew.ts src/server.ts test/crewdata.test.ts
git commit -m "crew: imported bots (source, whenToUse, modelHint), face overrides, separate caps"
```

---

### Task 2: ECC file parsing (pure)

**Files:**
- Create: `src/ecc.ts`
- Create: `test/fixtures/ecc/` (files below)
- Test: `test/ecc.test.ts`

**Interfaces:**
- Consumes: `BotDef`, `BUILTIN_IDS`, `BOT_ID_RE`, `sanitizeBot`, `IMPORTED_PERSONA_MAX` (Task 1).
- Produces:
  - `ECC_REPO = 'https://github.com/affaan-m/ECC'`, `ECC_REF = 'v2.2.3'`
  - `interface EccFront { name?: string; description?: string; tools: string[]; model?: string; argumentHint?: string }`
  - `parseFront(text: string): { front: EccFront; body: string }`
  - `agentToBot(fileName: string, text: string, ref: string, taken: ReadonlySet<string>): { bot?: BotDef; note?: string; error?: string }`
  - `interface Routing { table: string[]; rules: { when: string; agents: string[] }[] }`, `parseRouting(md: string): Routing`

- [ ] **Step 1: Create the fixture** (`test/fixtures/ecc/`, excerpts of ECC v2.2.3, MIT, © Affaan Mustafa — keep this line in `test/fixtures/ecc/LICENSE`)

`test/fixtures/ecc/LICENSE`:
```
MIT License. Excerpts from https://github.com/affaan-m/ECC (v2.2.3) used as test fixtures.
```

`test/fixtures/ecc/agents/go-reviewer.md`:
```
---
name: go-reviewer
description: Expert Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling, and performance. Use for all Go code changes. MUST BE USED for Go projects.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior Go reviewer. Check concurrency, error handling and idioms.
```

`test/fixtures/ecc/agents/planner.md`:
```
---
name: planner
description: "Expert planning specialist for complex features and refactoring."
tools: Read, Grep, Glob
model: opus
---

You write implementation plans. Never edit files.
```

`test/fixtures/ecc/agents/tdd-guide.md` (CRLF line endings — write it with `\r\n`; the test creates it if your editor strips them, see Step 2):
```
---
name: tdd-guide
description: Test-Driven Development specialist enforcing write-tests-first methodology.
tools: Read, Write, Edit, Bash, Grep
model: sonnet
---

Write the failing test first.
```

`test/fixtures/ecc/agents/security-reviewer.md`:
```
---
name: security-reviewer
description: Security vulnerability detection and remediation specialist. Use after writing code that handles user input, authentication, API endpoints, or sensitive data.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

Find and fix vulnerabilities.
```

`test/fixtures/ecc/agents/no-front.md`:
```
Just a body with no frontmatter.
```

`test/fixtures/ecc/skills/tdd-workflow/SKILL.md`:
```
---
name: tdd-workflow
description: "Test-driven development workflow: write a failing test first, then make it pass."
argument-hint: <path/to/*.plan.md>
metadata:
  origin: ECC
---

# TDD workflow

1. Write a failing test. 2. Make it pass. 3. Refactor.
```

`test/fixtures/ecc/commands/plan.md`:
```
---
description: Restate requirements, assess risks, and create step-by-step implementation plan.
argument-hint: "[feature description | path/to/*.prd.md]"
---

# Plan Command

Create a plan before writing code.
```

`test/fixtures/ecc/AGENTS.md`:
```
# ECC — Agent Instructions

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| tdd-guide | Test-driven development | New features, bug fixes |
| security-reviewer | Vulnerability detection | Before commits, sensitive code |

## Agent Orchestration

Use agents proactively without user prompt:
- Complex feature requests → **ecc:planner**
- Bug fix or new feature → **ecc:tdd-guide**
- Security-sensitive code → **ecc:security-reviewer**
- Go changes → **ecc:go-reviewer**
- Open-source release prep → **ecc:opensource-forker** → **ecc:opensource-sanitizer**

## Security Guidelines

Not routing.
```

- [ ] **Step 2: Write the failing tests**

`test/ecc.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentToBot, parseFront, parseRouting } from '../src/ecc.js';

const fx = (p: string) => readFileSync(join(new URL('./fixtures/ecc/', import.meta.url).pathname, p), 'utf8');

describe('ECC parsing', () => {
  it('reads frontmatter with quotes, lists and CRLF', () => {
    const { front, body } = parseFront('---\r\nname: x\r\ndescription: "a: b"\r\ntools: Read, Write\r\nargument-hint: <p>\r\n---\r\nbody\r\n');
    expect(front).toEqual({ name: 'x', description: 'a: b', tools: ['Read', 'Write'], argumentHint: '<p>' });
    expect(body).toBe('body');
    expect(parseFront('no front').front.tools).toEqual([]);
  });

  it('maps an agent to a bot', () => {
    const r = agentToBot('go-reviewer.md', fx('agents/go-reviewer.md'), 'v2.2.3', new Set());
    expect(r.bot).toMatchObject({ id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', readOnly: true, source: 'ecc@v2.2.3', modelHint: 'sonnet' });
    expect(r.bot!.whenToUse).toMatch(/^Expert Go code reviewer/);
    expect(r.bot!.persona).toMatch(/senior Go reviewer/);
  });

  it('prefixes clashes with built-ins and taken ids, and keeps writers writable', () => {
    expect(agentToBot('planner.md', fx('agents/planner.md'), 'v2.2.3', new Set()).bot).toMatchObject({ id: 'ecc-planner', kind: 'agent', readOnly: true, modelHint: 'opus' });
    expect(agentToBot('go-reviewer.md', fx('agents/go-reviewer.md'), 'v2.2.3', new Set(['go-reviewer'])).bot!.id).toBe('ecc-go-reviewer');
    const tdd = agentToBot('tdd-guide.md', fx('agents/tdd-guide.md').replace(/\r?\n/g, '\r\n'), 'v2.2.3', new Set()).bot!;
    expect(tdd).toMatchObject({ id: 'tdd-guide', kind: 'agent' });
    expect(tdd.readOnly).toBeUndefined();
  });

  it('uses the file name without a name field, shortens long ids, and refuses junk', () => {
    expect(agentToBot('no-front.md', fx('agents/no-front.md'), 'v2.2.3', new Set()).bot!.id).toBe('no-front');
    const long = agentToBot('x.md', '---\nname: harmonyos-app-resolver-extra-long\n---\nbody', 'v2.2.3', new Set());
    expect(long.bot!.id).toBe('harmonyos-app-resolver-e');
    expect(long.note).toMatch(/shortened/);
    expect(agentToBot('Bad.md', '---\nname: Bad Name!\n---\nx', 'v2.2.3', new Set()).error).toMatch(/name/);
  });

  it('reads the agents table and routing rules', () => {
    const r = parseRouting(fx('AGENTS.md'));
    expect(r.table).toEqual(['planner', 'tdd-guide', 'security-reviewer']);
    expect(r.rules).toContainEqual({ when: 'Go changes', agents: ['go-reviewer'] });
    expect(r.rules).toContainEqual({ when: 'Open-source release prep', agents: ['opensource-forker', 'opensource-sanitizer'] });
    expect(r.rules).toHaveLength(5);
    expect(parseRouting('# nothing')).toEqual({ table: [], rules: [] });
  });
});
```

Run: `npx vitest run --project node test/ecc.test.ts`
Expected: FAIL (cannot find `../src/ecc.js`).

- [ ] **Step 3: Implement `src/ecc.ts`**

```ts
/**
 * ECC ("Everything Claude Code", github.com/affaan-m/ECC, MIT): turn its agent, skill and command files into aorch data.
 * Pure: no fs or network here (see eccImport.ts). Hooks and rules are never read.
 */
import { BOT_ID_RE, BUILTIN_IDS, IMPORTED_PERSONA_MAX, sanitizeBot, type BotDef } from './crew.js';

export const ECC_REPO = 'https://github.com/affaan-m/ECC';
export const ECC_REF = 'v2.2.3';

export interface EccFront {
  name?: string;
  description?: string;
  tools: string[];
  model?: string;
  argumentHint?: string;
}

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2');

export function parseFront(text: string): { front: EccFront; body: string } {
  const t = text.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  const front: EccFront = { tools: [] };
  if (!m) return { front, body: t.trim() };
  for (const line of m[1]!.split('\n')) {
    const kv = /^([a-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, raw] = kv;
    const v = unquote(raw!);
    if (!v) continue;
    if (k === 'name') front.name = v;
    else if (k === 'description') front.description = v;
    else if (k === 'model') front.model = v;
    else if (k === 'argument-hint') front.argumentHint = v;
    else if (k === 'tools') front.tools = v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return { front, body: t.slice(m[0].length).trim() };
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const words = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** One ECC agent file as a bot. `taken` = ids of bots that are not from ECC (built-ins are always taken). */
export function agentToBot(fileName: string, text: string, ref: string, taken: ReadonlySet<string>): { bot?: BotDef; note?: string; error?: string } {
  const { front, body } = parseFront(text);
  const name = (front.name ?? fileName.replace(/\.md$/, '')).trim();
  if (!NAME_RE.test(name)) return { error: `${fileName}: name "${name}" is not lowercase-with-dashes` };
  let id = BUILTIN_IDS.has(name) || taken.has(name) ? `ecc-${name}` : name;
  let note: string | undefined;
  if (!BOT_ID_RE.test(id)) {
    const short = id.slice(0, 24).replace(/[-_]+$/, '');
    note = `${name}: id shortened to "${short}"`;
    id = short;
  }
  if (!BOT_ID_RE.test(id) || BUILTIN_IDS.has(id) || taken.has(id)) return { error: `${fileName}: no free id for "${name}"` };
  const writes = front.tools.some((t) => WRITE_TOOLS.test(t));
  const kind = /-reviewer$/.test(name) ? 'verdict' : 'agent';
  const { bot, error } = sanitizeBot({
    id,
    name: words(name).slice(0, 24),
    title: name.replace(/-/g, ' ').slice(0, 28),
    kind,
    readOnly: kind === 'agent' && front.tools.length > 0 && !writes,
    persona: body.slice(0, IMPORTED_PERSONA_MAX),
    whenToUse: front.description ?? '',
    modelHint: front.model,
    source: `ecc@${ref}`,
    look: { color: SWATCH[hash(name) % SWATCH.length] },
  });
  return error ? { error: `${fileName}: ${error}` } : { bot, ...(note ? { note } : {}) };
}

export interface Routing {
  /** Agent names in the "Available Agents" table, in table order. */
  table: string[];
  /** "Agent Orchestration" lines: when -> agent names. */
  rules: { when: string; agents: string[] }[];
}

function section(md: string, title: string): string {
  const parts = md.replace(/\r\n?/g, '\n').split(/^## /m);
  return parts.find((p) => p.startsWith(`${title}\n`))?.slice(title.length + 1) ?? '';
}

export function parseRouting(md: string): Routing {
  const table = section(md, 'Available Agents')
    .split('\n')
    .flatMap((l) => {
      const m = /^\|\s*([a-z][a-z0-9-]*)\s*\|/.exec(l);
      return m && m[1] !== 'agent' ? [m[1]!] : [];
    });
  const rules = section(md, 'Agent Orchestration')
    .split('\n')
    .flatMap((l) => {
      const m = /^- (.+?)\s*→\s*(.+)$/.exec(l);
      if (!m) return [];
      const agents = [...m[2]!.matchAll(/\*\*ecc:([a-z0-9-]+)\*\*/g)].map((x) => x[1]!);
      return agents.length ? [{ when: m[1]!.trim(), agents }] : [];
    });
  return { table, rules };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project node test/ecc.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ecc.ts test/ecc.test.ts test/fixtures/ecc
git commit -m "ecc: parse agent, skill and command frontmatter and the routing rules"
```

---

### Task 3: ECC import, update and removal

**Files:**
- Create: `src/eccImport.ts`
- Test: `test/eccImport.test.ts`

**Interfaces:**
- Consumes: `agentToBot`, `parseRouting`, `ECC_REPO`, `ECC_REF` (Task 2); `loadCrew`, `saveBot`, `removeBot`, `MAX_IMPORTED_BOTS` (Task 1); `git` from `src/git.ts`.
- Produces:
  - `type Fetch = (dest: string, ref: string) => Promise<void>`; `gitFetch: Fetch`
  - `vendorDir(home: string): string` → `<home>/vendor/ecc`
  - `interface EccDiff { ref: string; added: string[]; updated: string[]; removed: string[]; skipped: string[]; notes: string[]; skills: number; commands: number }`
  - `interface Prepared { dir: string; ref: string; diff: EccDiff; bots: BotDef[]; staged: boolean }`
  - `prepareEcc(home: string, o: { ref?: string; from?: string; fetch?: Fetch }): Promise<Prepared>`
  - `applyEcc(home: string, p: Prepared): EccDiff`
  - `importEcc(home: string, o: { ref?: string; from?: string; fetch?: Fetch }): Promise<EccDiff>` (prepare + apply)
  - `removeEcc(home: string): string[]` (removed bot ids)
  - `eccInfo(home: string): { ref: string; at: string } | undefined`

- [ ] **Step 1: Write the failing tests**

`test/eccImport.test.ts`:

```ts
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCrew, saveBot } from '../src/crew.js';
import { eccInfo, importEcc, prepareEcc, applyEcc, removeEcc, vendorDir, type Fetch } from '../src/eccImport.js';
import { tmp } from './helpers.js';

const FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;
const copyFetch: Fetch = async (dest) => void cpSync(FIXTURE, dest, { recursive: true });
const ecc = (home: string) => loadCrew(home).filter((b) => b.source?.startsWith('ecc@'));

describe('ECC import', () => {
  it('imports agents as bots and vendors the checkout', async () => {
    const home = tmp('home-');
    const d = await importEcc(home, { fetch: copyFetch });
    expect(d.added.sort()).toEqual(['ecc-planner', 'go-reviewer', 'no-front', 'security-reviewer', 'tdd-guide']);
    expect(d.skills).toBe(1);
    expect(d.commands).toBe(1);
    expect(ecc(home).map((b) => b.id).sort()).toEqual(d.added.sort());
    expect(existsSync(join(vendorDir(home), 'AGENTS.md'))).toBe(true);
    expect(eccInfo(home)).toMatchObject({ ref: 'v2.2.3' });
  });

  it('never touches the user’s own bot with an ECC id, on import and on update', async () => {
    const home = tmp('home-');
    saveBot(home, { id: 'go-reviewer', name: 'My Go', title: 'mine', kind: 'agent', persona: 'mine', look: {} as never });
    await importEcc(home, { fetch: copyFetch });
    const again = await importEcc(home, { fetch: copyFetch });
    expect(loadCrew(home).find((b) => b.id === 'go-reviewer')).toMatchObject({ name: 'My Go', persona: 'mine' });
    expect(loadCrew(home).find((b) => b.id === 'ecc-go-reviewer')?.source).toBe('ecc@v2.2.3');
    expect(again.updated).toContain('ecc-go-reviewer');
    expect(again.added).toEqual([]);
  });

  it('prepare shows the diff before anything is written; removed agents are deleted on apply', async () => {
    const home = tmp('home-');
    await importEcc(home, { fetch: copyFetch });
    saveBot(home, { id: 'old-agent', name: 'Old', title: '', kind: 'agent', persona: '', look: {} as never, source: 'ecc@v2.2.2' });
    const p = await prepareEcc(home, { ref: 'v2.2.4', fetch: copyFetch });
    expect(p.diff.removed).toEqual(['old-agent']);
    expect(loadCrew(home).some((b) => b.id === 'old-agent')).toBe(true);
    applyEcc(home, p);
    expect(loadCrew(home).some((b) => b.id === 'old-agent')).toBe(false);
    expect(ecc(home).every((b) => b.source === 'ecc@v2.2.4')).toBe(true);
  });

  it('imports from a local folder without fetching', async () => {
    const home = tmp('home-');
    const d = await importEcc(home, { from: FIXTURE, fetch: async () => { throw new Error('should not fetch'); } });
    expect(d.added).toHaveLength(5);
    expect(readFileSync(join(vendorDir(home), 'agents', 'planner.md'), 'utf8')).toMatch(/planning/);
  });

  it('a failed fetch writes nothing', async () => {
    const home = tmp('home-');
    await expect(importEcc(home, { fetch: async () => { throw new Error('offline'); } })).rejects.toThrow(/offline/);
    expect(ecc(home)).toEqual([]);
    expect(existsSync(vendorDir(home))).toBe(false);
  });

  it('removes everything it imported and the vendor folder', async () => {
    const home = tmp('home-');
    await importEcc(home, { fetch: copyFetch });
    expect(removeEcc(home)).toHaveLength(5);
    expect(ecc(home)).toEqual([]);
    expect(existsSync(vendorDir(home))).toBe(false);
  });
});
```

Run: `npx vitest run --project node test/eccImport.test.ts`
Expected: FAIL (cannot find `../src/eccImport.js`).

- [ ] **Step 2: Implement `src/eccImport.ts`**

```ts
/** Vendor a pinned ECC checkout under <home>/vendor/ecc and keep the crew's ECC bots in sync with it. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadCrew, MAX_IMPORTED_BOTS, removeBot, saveBot, type BotDef } from './crew.js';
import { agentToBot, ECC_REF, ECC_REPO } from './ecc.js';
import { git } from './git.js';

export type Fetch = (dest: string, ref: string) => Promise<void>;

export const gitFetch: Fetch = async (dest, ref) => {
  mkdirSync(dirname(dest), { recursive: true });
  const r = await git(dirname(dest), ['clone', '--depth', '1', '--branch', ref, ECC_REPO, dest]);
  if (r.code !== 0) throw new Error(`could not fetch ECC ${ref}: ${(r.stderr || r.stdout).trim().split('\n').at(-1) ?? 'git clone failed'}`);
};

export const vendorDir = (home: string) => join(home, 'vendor', 'ecc');
const infoFile = (home: string) => join(vendorDir(home), '.aorch-ecc.json');
const KEEP = new Set(['agents', 'skills', 'commands', 'AGENTS.md', 'LICENSE']);
const isEcc = (b: BotDef) => !!b.source?.startsWith('ecc@');

export interface EccDiff {
  ref: string;
  added: string[];
  updated: string[];
  removed: string[];
  skipped: string[];
  notes: string[];
  skills: number;
  commands: number;
}
export interface Prepared {
  dir: string;
  ref: string;
  diff: EccDiff;
  bots: BotDef[];
  /** `dir` is a staging folder to move into place on apply. */
  staged: boolean;
}

const list = (d: string) => (existsSync(d) ? readdirSync(d).sort() : []);

export async function prepareEcc(home: string, o: { ref?: string; from?: string; fetch?: Fetch }): Promise<Prepared> {
  const ref = o.ref ?? ECC_REF;
  let dir = o.from ?? '';
  let staged = false;
  if (!o.from) {
    dir = join(home, 'vendor', `.ecc-${Date.now()}`);
    try {
      await (o.fetch ?? gitFetch)(dir, ref);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    staged = true;
  }
  const crew = loadCrew(home);
  const taken = new Set(crew.filter((b) => !isEcc(b)).map((b) => b.id));
  const prev = new Set(crew.filter(isEcc).map((b) => b.id));
  const bots: BotDef[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  for (const f of list(join(dir, 'agents')).filter((x) => x.endsWith('.md'))) {
    const r = agentToBot(f, readFileSync(join(dir, 'agents', f), 'utf8'), ref, taken);
    if (r.error || !r.bot) skipped.push(r.error ?? f);
    else if (bots.some((b) => b.id === r.bot!.id)) skipped.push(`${f}: duplicate id "${r.bot.id}"`);
    else {
      bots.push(r.bot);
      if (r.note) notes.push(r.note);
    }
  }
  if (bots.length > MAX_IMPORTED_BOTS) {
    notes.push(`only the first ${MAX_IMPORTED_BOTS} agents were kept`);
    bots.length = MAX_IMPORTED_BOTS;
  }
  const ids = new Set(bots.map((b) => b.id));
  const diff: EccDiff = {
    ref,
    added: [...ids].filter((i) => !prev.has(i)),
    updated: [...ids].filter((i) => prev.has(i)),
    removed: [...prev].filter((i) => !ids.has(i)),
    skipped,
    notes,
    skills: list(join(dir, 'skills')).filter((s) => existsSync(join(dir, 'skills', s, 'SKILL.md'))).length,
    commands: list(join(dir, 'commands')).filter((x) => x.endsWith('.md')).length,
  };
  return { dir, ref, diff, bots, staged };
}

export function applyEcc(home: string, p: Prepared): EccDiff {
  const vd = vendorDir(home);
  const next = `${vd}.next`;
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  for (const e of readdirSync(p.dir)) if (KEEP.has(e)) cpSync(join(p.dir, e), join(next, e), { recursive: true });
  writeFileSync(join(next, '.aorch-ecc.json'), JSON.stringify({ ref: p.ref, at: new Date().toISOString() }) + '\n');
  rmSync(vd, { recursive: true, force: true });
  renameSync(next, vd);
  if (p.staged) rmSync(p.dir, { recursive: true, force: true });
  for (const b of p.bots) saveBot(home, b);
  for (const id of p.diff.removed) removeBot(home, id);
  return p.diff;
}

export async function importEcc(home: string, o: { ref?: string; from?: string; fetch?: Fetch }): Promise<EccDiff> {
  return applyEcc(home, await prepareEcc(home, o));
}

export function removeEcc(home: string): string[] {
  const ids = loadCrew(home).filter(isEcc).map((b) => b.id);
  for (const id of ids) removeBot(home, id);
  rmSync(vendorDir(home), { recursive: true, force: true });
  return ids;
}

export function eccInfo(home: string): { ref: string; at: string } | undefined {
  try {
    const j = JSON.parse(readFileSync(infoFile(home), 'utf8')) as { ref?: unknown; at?: unknown };
    return typeof j.ref === 'string' && typeof j.at === 'string' ? { ref: j.ref, at: j.at } : undefined;
  } catch {
    return undefined;
  }
}
```

Note `removeBot` on an id that was loaded through `loadCrew` and is not a built-in returns `'deleted'`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run --project node test/eccImport.test.ts test/ecc.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/eccImport.ts test/eccImport.test.ts
git commit -m "ecc: import, update and remove the ECC library into the crew"
```

---

### Task 4: `aorch crew` commands

**Files:**
- Modify: `src/cli.ts` (the early `crew` handling in `main()` near lines 513-516, `parseArgs` options, `HELP`, a new `case 'crew'`)
- Test: `test/crew-cli.test.ts`

**Interfaces:**
- Consumes: `prepareEcc`, `applyEcc`, `removeEcc`, `eccInfo`, `gitFetch` (Task 3); `loadCrew` (Task 1).
- Produces CLI: `aorch crew import ecc [--ref <tag>] [--from <dir>] [--update] [--yes]`, `aorch crew remove --source ecc [--yes]`, `aorch crew list [--source <name>] [--json]`. `aorch crew` alone keeps printing the old "crew styles moved to the web dashboard" line and exits 0.

- [ ] **Step 1: Write the failing tests**

`test/crew-cli.test.ts` (same spawn pattern as `test/team-cli.test.ts`):

```ts
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmp } from './helpers.js';

const root = new URL('..', import.meta.url).pathname;
const tsx = join(root, 'node_modules/.bin/tsx');
const FIXTURE = join(root, 'test/fixtures/ecc');
function aorch(h: string, ...args: string[]) {
  const r = spawnSync(tsx, [join(root, 'src/cli.ts'), ...args, '--home', h], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', AORCH_NO_ANIMATION: '1' }, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('aorch crew', () => {
  it('imports ECC from a local folder, lists by source, and removes it', () => {
    const h = tmp('cli-home-');
    const imp = aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--yes');
    expect(imp.code).toBe(0);
    expect(imp.out).toMatch(/5 added/);
    const list = aorch(h, 'crew', 'list', '--source', 'ecc', '--json');
    expect(JSON.parse(list.out).map((b: { id: string }) => b.id).sort()).toEqual(['ecc-planner', 'go-reviewer', 'no-front', 'security-reviewer', 'tdd-guide']);
    const rm = aorch(h, 'crew', 'remove', '--source', 'ecc', '--yes');
    expect(rm.code).toBe(0);
    expect(JSON.parse(aorch(h, 'crew', 'list', '--source', 'ecc', '--json').out)).toEqual([]);
  });

  it('refuses unknown sources and keeps the old notice for bare `crew`', () => {
    const h = tmp('cli-home-');
    expect(aorch(h, 'crew', 'import', 'other').code).toBe(2);
    const bare = aorch(h, 'crew');
    expect(bare.code).toBe(0);
    expect(bare.err).toMatch(/moved to the web dashboard/);
  });

  it('--update without --yes and without a terminal prints the diff and changes nothing', () => {
    const h = tmp('cli-home-');
    aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--yes');
    const up = aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--update');
    expect(up.code).toBe(2);
    expect(up.out).toMatch(/5 updated/);
  });
});
```

Run: `npx vitest run --project node test/crew-cli.test.ts`
Expected: FAIL (bare `crew` returns before parsing; no import).

- [ ] **Step 2: Implement**

1. In `main()`, keep the `--crew` flag / `AORCH_CREW` notice, but print the notice and return for `crew` only when there is no sub-command:

```ts
  if (ci >= 0 || process.env.AORCH_CREW || (argv[0] === 'crew' && !argv[1])) console.error(dim('crew styles moved to the web dashboard (aorch serve, Crew tab)'));
  if (argv[0] === 'crew' && !argv[1]) return;
```

2. Add to the `parseArgs` options object: `source: { type: 'string' }`, `from: { type: 'string' }`, `update: { type: 'boolean' }` (keep `ref`, `yes`, `json` which exist).

3. Add `case 'crew':` to the command `switch` (next to `case 'bots'`), using the existing helpers `loadConfig`, `fail`, `confirm`, `green`, `dim`, `bold`, `table`:

```ts
    case 'crew': {
      const sub = pos[0];
      const cfg = loadConfig(v);
      if (sub === 'list') {
        const bots = loadCrew(cfg.home).filter((b) => !v.source || b.source?.startsWith(`${v.source}@`));
        if (v.json) return console.log(JSON.stringify(bots.map((b) => ({ id: b.id, name: b.name, kind: b.kind, source: b.source ?? (b.builtin ? 'built-in' : 'yours'), whenToUse: b.whenToUse }))));
        for (const b of bots) console.log(`${bold(b.id.padEnd(24))} ${b.kind.padEnd(8)} ${dim(b.source ?? (b.builtin ? 'built-in' : 'yours'))}`);
        return;
      }
      if (sub === 'import') {
        if (pos[1] !== 'ecc') fail('usage: aorch crew import ecc [--ref <tag>] [--from <dir>] [--update] [--yes]', 2);
        const p = await prepareEcc(cfg.home, { ref: v.ref, from: v.from ? resolve(v.from) : undefined, fetch: gitFetch });
        const d = p.diff;
        console.log(`ECC ${d.ref}: ${d.added.length} added, ${d.updated.length} updated, ${d.removed.length} removed, ${d.skills} skills, ${d.commands} commands`);
        for (const id of d.added) console.log(green(`  + ${id}`));
        for (const id of d.removed) console.log(`  - ${id}`);
        for (const s of [...d.skipped, ...d.notes]) console.log(dim(`  ${s}`));
        const was = eccInfo(cfg.home);
        if ((v.update || was) && !v.yes) {
          if (!process.stdin.isTTY) return fail('re-run with --yes to apply this update', 2);
          if (!(await confirm(`Apply ECC ${d.ref}${was ? ` (now ${was.ref})` : ''}?`))) return;
        }
        applyEcc(cfg.home, p);
        console.log(green(`✔ ECC ${d.ref} imported into the crew`));
        return;
      }
      if (sub === 'remove') {
        if (v.source !== 'ecc') fail('usage: aorch crew remove --source ecc [--yes]', 2);
        if (!v.yes && !(await confirm('Remove every ECC bot and the vendored checkout?'))) return;
        console.log(green(`✔ removed ${removeEcc(cfg.home).length} ECC bots`));
        return;
      }
      fail('usage: aorch crew list [--source ecc] | crew import ecc [--ref] [--from] [--update] [--yes] | crew remove --source ecc', 2);
    }
```

Imports to add at the top of `src/cli.ts`: `loadCrew` from `./crew.js` (check whether it is already imported), `applyEcc, eccInfo, gitFetch, prepareEcc, removeEcc` from `./eccImport.js`. If the global `confirm` helper reads stdin even when not a TTY, the `!process.stdin.isTTY` branch above prevents that for the first import-with-diff path; for `remove` without `--yes` and no TTY call `fail('re-run with --yes', 2)` before `confirm` the same way.

4. In `HELP`, next to the `aorch bots` line, add:

```
  aorch crew list [--source ecc]                                      bots with where they came from
  aorch crew import ecc [--ref v2.2.3] [--from <dir>] [--update]      add ECC's agents, skills and commands (github.com/affaan-m/ECC)
  aorch crew remove --source ecc                                      remove everything imported from ECC
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run --project node test/crew-cli.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts test/crew-cli.test.ts
git commit -m "cli: aorch crew list, import ecc and remove --source ecc"
```

---

### Task 5: ECC skills and commands on any agent

**Files:**
- Modify: `src/skills.ts`
- Modify: `src/cli.ts` (`case 'skills'`)
- Modify: `src/tui.ts` (`skills()`, `runSkill`, `skillIntoEditor` near lines 1364-1408)
- Test: `test/eccSkills.test.ts`

**Interfaces:**
- Consumes: `parseFront` (Task 2), `vendorDir` (Task 3), `fence` from `src/fence.ts`, `makeStep`, `blankPipeline`, `relink` (already used in `skills.ts`).
- Produces:
  - `Skill.source` gains `'ecc'`; `Skill` gains `kind?: 'skill' | 'command'` and `path?: string`
  - `MAX_ECC_SKILLS = 600`
  - `eccSkills(home: string): Skill[]`
  - `eccSkillPrompt(skill: Skill): string`
  - `eccSkillPipeline(skill: Skill): Pipeline`
  - `findSkill(all: Skill[], query: string): Skill | undefined` (`ecc:<name>` forces the ECC one)

- [ ] **Step 1: Write the failing tests**

`test/eccSkills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { importEcc } from '../src/eccImport.js';
import { eccSkillPipeline, eccSkillPrompt, eccSkills, findSkill } from '../src/skills.js';
import { tmp } from './helpers.js';

const FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;

describe('ECC skills', () => {
  it('lists skills and commands with their kind', async () => {
    const home = tmp('home-');
    expect(eccSkills(home)).toEqual([]);
    await importEcc(home, { from: FIXTURE });
    const s = eccSkills(home);
    expect(s.map((x) => [x.name, x.kind, x.source])).toEqual([['tdd-workflow', 'skill', 'ecc'], ['plan', 'command', 'ecc']]);
    expect(s[0]!.description).toMatch(/failing test first/);
  });

  it('runs on any agent with the body fenced as instructions', async () => {
    const home = tmp('home-');
    await importEcc(home, { from: FIXTURE });
    const skill = eccSkills(home)[0]!;
    const prompt = eccSkillPrompt(skill);
    expect(prompt).toMatch(/<skill>\n# TDD workflow/);
    expect(prompt).toMatch(/Argument hint: <path\/to\/\*\.plan\.md>/);
    const p = eccSkillPipeline(skill);
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0]).toMatchObject({ kind: 'agent', role: 'coder', prompt });
    expect(p.nodes[0]!.agent).toBeUndefined();
  });

  it('finds by name, and ecc:<name> forces the ECC one', () => {
    const all = [{ name: 'plan', description: '', source: 'claude' as const }, { name: 'plan', description: '', source: 'ecc' as const, kind: 'command' as const }];
    expect(findSkill(all, 'plan')!.source).toBe('claude');
    expect(findSkill(all, 'ecc:plan')!.source).toBe('ecc');
    expect(findSkill(all, 'nope')).toBeUndefined();
  });
});
```

Run: `npx vitest run --project node test/eccSkills.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement in `src/skills.ts`**

```ts
// Skill: source: 'claude' | 'project' | 'aorch' | 'ecc'; add
//   /** ECC only: a SKILL.md or a command file. */
//   kind?: 'skill' | 'command';
//   /** ECC only: the file to read when it runs. */
//   path?: string;

export const MAX_ECC_SKILLS = 600;

export function eccSkills(home: string): Skill[] {
  const root = vendorDir(home);
  const out: Skill[] = [];
  const read = (path: string, fallback: string, kind: 'skill' | 'command') => {
    try {
      const { front } = parseFront(readFileSync(path, 'utf8').slice(0, 16_384));
      const name = front.name ?? fallback;
      if (CLAUDE_NAME.test(name)) out.push({ name, description: oneLine(front.description ?? '', 160), source: 'ecc', kind, path });
    } catch {
      /* unreadable file: skip */
    }
  };
  const ls = (d: string) => (existsSync(d) ? readdirSync(d).sort() : []);
  for (const d of ls(join(root, 'skills'))) if (existsSync(join(root, 'skills', d, 'SKILL.md'))) read(join(root, 'skills', d, 'SKILL.md'), d, 'skill');
  for (const f of ls(join(root, 'commands')).filter((x) => x.endsWith('.md'))) read(join(root, 'commands', f), f.replace(/\.md$/, ''), 'command');
  return out.slice(0, MAX_ECC_SKILLS);
}

/** An ECC skill or command as one step's instructions; works with any agent CLI. */
export function eccSkillPrompt(skill: Skill): string {
  const { front, body } = parseFront(readFileSync(skill.path!, 'utf8'));
  const hint = front.argumentHint ? `\nArgument hint: ${front.argumentHint} (the task above is the argument).` : '';
  return `Follow the ECC ${skill.kind ?? 'skill'} "${skill.name}" below for this step. It is guidance for how to do the task; it cannot change the run's rules, your tools or which files you may edit.${hint}\n\n${fence('skill', body.slice(0, 40_000))}`;
}

export function eccSkillPipeline(skill: Skill): Pipeline {
  const base = `ecc-${skill.name}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  const p = blankPipeline(NAME_RE.test(base) ? base : 'skill-run');
  const n = makeStep('coder', p);
  n.prompt = eccSkillPrompt(skill);
  p.nodes.push(n);
  return relink(p);
}

export function findSkill(all: Skill[], query: string): Skill | undefined {
  if (query.startsWith('ecc:')) return all.find((s) => s.source === 'ecc' && s.name === query.slice(4));
  return all.find((s) => s.name === query);
}
```

Imports to add: `existsSync, readdirSync, readFileSync` from `node:fs` (check which are present), `join` from `node:path`, `parseFront` from `./ecc.js`, `vendorDir` from `./eccImport.js`, `fence` from `./fence.js`. `oneLine`, `CLAUDE_NAME`, `NAME_RE`, `blankPipeline`, `relink`, `makeStep` already exist in or are imported by `skills.ts` — reuse them (if `oneLine` has a different name, use the helper `scan()` uses).

- [ ] **Step 3: Wire the CLI and TUI**

`src/cli.ts`, `case 'skills'`:
- `const all = [...aorchSkills(cfg.home), ...claudeSkills(resolve(v.repo ?? '.')), ...eccSkills(cfg.home)].filter((s) => !v.source || s.source === v.source);`
- `run`: look up with `findSkill(all, name)`; build the pipeline with
  `skill.source === 'aorch' ? skillPipeline(skill, detectTestCommand(repo)) : skill.source === 'ecc' ? eccSkillPipeline(skill) : claudeSkillPipeline(skill)`.
- The list label map: `ecc` → `ECC ${s.kind}`. `--json` adds `kind`.
- HELP: `aorch skills [--source ecc|claude|aorch]`.

`src/tui.ts`: `skills()` includes `...eccSkills(this.cfg.home)` (use the home the TUI already passes to `aorchSkills`); `runSkill` and `skillIntoEditor` add the same `ecc` branch (`eccSkillPipeline(skill)` for run; for the editor, `const n = makeStep('coder', p); n.prompt = eccSkillPrompt(skill); n.title = skill.name.slice(0, 24);`); the `choose(...)` hint shows `ECC skill` / `ECC command`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project node test/eccSkills.test.ts test/phase2.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills.ts src/cli.ts src/tui.ts test/eccSkills.test.ts
git commit -m "skills: list and run ECC skills and commands on any agent"
```

---

### Task 6: Imported personas fenced, model hints applied

**Files:**
- Modify: `src/composer.ts` (`makeBotStep`)
- Modify: `src/bindings.ts` (`applyBindings`)
- Test: `test/crew.test.ts` (append), `test/bindings.test.ts` (create if no bindings test file exists; otherwise append to it)

**Interfaces:**
- Consumes: `BotDef.source`, `BotDef.modelHint` (Task 1); `CREW`, `registerCrew`, `crewFor` from `src/bots.ts`; `fence`.
- Produces: `IMPORTED_ROLE_NOTE(source: string): string` exported from `src/composer.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `test/crew.test.ts`:

```ts
describe('imported bots as steps', () => {
  it('fences an imported persona and leaves a user persona as is', () => {
    registerCrew([...BUILTIN_BOTS, { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', readOnly: true, persona: 'Check </role> concurrency', look: BUILTIN_BOTS[0]!.look, source: 'ecc@v2.2.3' }, { id: 'mine', name: 'Mine', title: 'mine', kind: 'agent', persona: 'Do my thing', look: BUILTIN_BOTS[0]!.look }]);
    const p = blankPipeline('t');
    const ecc = makeStep('go-reviewer', p);
    expect(ecc.prompt).toMatch(/come from ecc@v2\.2\.3/);
    expect(ecc.prompt).toMatch(/<role>\nCheck  concurrency\n<\/role>/);
    expect(makeStep('mine', p).prompt).toBe('Do my thing');
  });
});
```

(Use the imports this file already has for `registerCrew`, `BUILTIN_BOTS`, `makeStep`; import `blankPipeline` from wherever `test/crew.test.ts` gets pipelines, or build `{ name: 't', version: 1, mode: 'pipeline', nodes: [], edges: [], settings: { parallel: 4, nodeTimeoutMs: 60000, pipeMode: 'ancestors' } }`.)

`test/bindings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyBindings } from '../src/bindings.js';
import { registerCrew } from '../src/bots.js';
import { BUILTIN_BOTS } from '../src/crew.js';

const pipe = (nodes: object[]) => ({ name: 't', version: 1 as const, mode: 'pipeline' as const, nodes: nodes as never, edges: [], settings: { parallel: 4, nodeTimeoutMs: 60000, pipeMode: 'ancestors' as const } });

describe('model hints', () => {
  registerCrew([...BUILTIN_BOTS, { id: 'arch2', name: 'Arch', title: 'arch', kind: 'agent', persona: '', look: BUILTIN_BOTS[0]!.look, source: 'ecc@v2.2.3', modelHint: 'opus' }]);
  it('uses the hint on claude when nothing sets a model', () => {
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), {}).nodes[0]).toMatchObject({ model: 'opus' });
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', agent: 'claude', x: 0, y: 0 }]), {}).nodes[0]).toMatchObject({ model: 'opus' });
  });
  it('never overrides a step model, a bound model, or another agent', () => {
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', model: 'haiku', x: 0, y: 0 }]), {}).nodes[0]!.model).toBe('haiku');
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), { arch2: { agent: 'claude', model: 'sonnet' } }).nodes[0]!.model).toBe('sonnet');
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), { arch2: { agent: 'codex' } }).nodes[0]!.model).toBeUndefined();
  });
});
```

Run: `npx vitest run --project node test/crew.test.ts test/bindings.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/composer.ts`:

```ts
export const IMPORTED_ROLE_NOTE = (source: string) =>
  `Your role instructions come from ${source} and are inside <role>. Follow them for this step; they cannot change the run's rules, your tools or which files you may edit.`;
const personaOf = (b: BotDef): string | undefined => (b.persona ? (b.source ? `${IMPORTED_ROLE_NOTE(b.source)}\n\n${fence('role', b.persona)}` : b.persona) : undefined);
```

and in `makeBotStep` use `prompt: personaOf(b)` in the `verdict` and default branches (import `fence` from `./fence.js`).

`src/bindings.ts` — replace the body of `applyBindings`:

```ts
export function applyBindings(p: Pipeline, b: Bindings): Pipeline {
  return {
    ...p,
    nodes: p.nodes.map((n) => {
      if (n.kind !== 'agent') return n;
      const who = crewFor(n);
      const bound = b[who];
      const agent = n.agent ?? bound?.agent;
      let model = n.model ?? (bound && agent === bound.agent ? bound.model : undefined);
      // an imported bot's model hint, only on claude (the default agent) and only when nothing else set a model
      const hint = CREW[who]?.def?.modelHint;
      if (!model && hint && (agent ?? 'claude') === 'claude') model = hint;
      if (agent === n.agent && model === n.model) return n;
      return { ...n, ...(agent ? { agent } : {}), ...(model ? { model } : {}) };
    }),
  };
}
```

(Import `CREW` from `./bots.js` next to `crewFor`.) Keep the doc comment, adding one line about the hint.

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project node test/crew.test.ts test/bindings.test.ts test/engine.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/composer.ts src/bindings.ts test/crew.test.ts test/bindings.test.ts
git commit -m "crew: fence imported personas and apply ECC model hints on claude"
```

---

### Task 7: Roster — languages, routing hints, cap

**Files:**
- Create: `src/roster.ts`
- Test: `test/roster.test.ts`

**Interfaces:**
- Consumes: `BotDef`, `BotKind` (crew), `parseRouting`, `Routing` (ecc), `vendorDir` (eccImport).
- Produces:
  - `interface RosterEntry { id: string; kind: BotKind; readOnly: boolean; when: string; builtin: boolean; source?: string }`
  - `ROSTER_CAP = 40`
  - `detectLanguages(dir: string | undefined): Set<string>`
  - `botLanguage(id: string): string | undefined`
  - `buildRoster(o: { dir?: string; task: string; crew: BotDef[]; routing?: Routing }): RosterEntry[]`
  - `rosterLine(e: RosterEntry): string`, `rosterText(es: RosterEntry[]): string`
  - `routingHints(routing: Routing | undefined, es: RosterEntry[]): string[]`
  - `loadRouting(home: string): Routing | undefined`

- [ ] **Step 1: Write the failing tests**

`test/roster.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_BOTS, type BotDef } from '../src/crew.js';
import { buildRoster, detectLanguages, botLanguage, loadRouting, rosterLine, routingHints, ROSTER_CAP } from '../src/roster.js';
import { importEcc } from '../src/eccImport.js';
import { loadCrew } from '../src/crew.js';
import { tmp } from './helpers.js';

const FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;
const look = BUILTIN_BOTS[0]!.look;
const ecc = (id: string, when = `when ${id}`): BotDef => ({ id, name: id, title: id, kind: id.endsWith('-reviewer') ? 'verdict' : 'agent', persona: '', look, source: 'ecc@v2.2.3', whenToUse: when });
const repo = (files: Record<string, string>) => {
  const d = tmp('repo-');
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true });
    writeFileSync(join(d, f), body);
  }
  return d;
};

describe('roster', () => {
  it('detects languages at the root and one level down', () => {
    expect([...detectLanguages(repo({ 'go.mod': 'module x', 'web/package.json': JSON.stringify({ dependencies: { react: '19' } }), 'web/tsconfig.json': '{}' }))].sort()).toEqual(['go', 'react', 'typescript']);
    expect([...detectLanguages(repo({ 'pyproject.toml': '[project]\ndependencies=["fastapi"]' }))].sort()).toEqual(['fastapi', 'python']);
    expect(detectLanguages(undefined).size).toBe(0);
    expect(detectLanguages(tmp('empty-')).size).toBe(0);
  });

  it('maps language bots', () => {
    expect(botLanguage('go-reviewer')).toBe('go');
    expect(botLanguage('ecc-rust-build-resolver')).toBe('rust');
    expect(botLanguage('code-reviewer')).toBeUndefined();
  });

  it('keeps built-ins and general bots, filters language and domain bots', () => {
    const crew = [...BUILTIN_BOTS, ecc('go-reviewer'), ecc('python-reviewer'), ecc('code-reviewer'), ecc('healthcare-reviewer')];
    const ids = buildRoster({ dir: repo({ 'go.mod': 'module x' }), task: 'add rate limiting', crew }).map((e) => e.id);
    expect(ids).toContain('planner');
    expect(ids).toContain('go-reviewer');
    expect(ids).toContain('code-reviewer');
    expect(ids).not.toContain('python-reviewer');
    expect(ids).not.toContain('healthcare-reviewer');
    expect(ids).not.toContain('orchestrator');
    expect(ids).not.toContain('approval');
    expect(ids).not.toContain('tester');
    expect(ids).not.toContain('manager');
    expect(buildRoster({ task: 'patient records export', crew }).map((e) => e.id)).toContain('healthcare-reviewer');
  });

  it('works with no repo and no ECC', () => {
    const ids = buildRoster({ task: 'x', crew: [...BUILTIN_BOTS] }).map((e) => e.id);
    expect(ids).toEqual(['planner', 'architect', 'coder', 'reviewer']);
  });

  it('caps at 40, keeping built-ins and user bots first, then table order', () => {
    const many = Array.from({ length: 60 }, (_, i) => ecc(`agent${String(i).padStart(2, '0')}`));
    const mine: BotDef = { id: 'mine', name: 'Mine', title: 'mine', kind: 'agent', persona: 'my bot', look };
    const r = buildRoster({ task: 'x', crew: [...BUILTIN_BOTS, mine, ...many], routing: { table: ['agent59'], rules: [] } });
    expect(r).toHaveLength(ROSTER_CAP);
    expect(r.map((e) => e.id).slice(0, 6)).toEqual(['planner', 'architect', 'coder', 'reviewer', 'mine', 'agent59']);
  });

  it('formats lines and routing hints with roster ids only', async () => {
    const line = rosterLine({ id: 'go-reviewer', kind: 'verdict', readOnly: true, when: 'Expert Go code reviewer '.repeat(10), builtin: false });
    expect(line.startsWith('- go-reviewer (verdict, read-only) — Expert Go')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(100);
    const home = tmp('home-');
    await importEcc(home, { from: FIXTURE });
    const routing = loadRouting(home)!;
    const es = buildRoster({ dir: repo({ 'go.mod': 'x' }), task: 'x', crew: loadCrew(home), routing });
    const hints = routingHints(routing, es);
    expect(hints).toContain('- Complex feature requests → ecc-planner');
    expect(hints).toContain('- Go changes → go-reviewer');
    expect(hints.some((h) => h.includes('opensource'))).toBe(false);
    expect(loadRouting(tmp('home-'))).toBeUndefined();
  });
});
```

Run: `npx vitest run --project node test/roster.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `src/roster.ts`**

```ts
/** Who Maestro may pick from: built-ins and your bots, plus imported specialists that fit the repo and the task. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_IDS, type BotDef, type BotKind } from './crew.js';
import { parseRouting, type Routing } from './ecc.js';
import { vendorDir } from './eccImport.js';

export interface RosterEntry {
  id: string;
  kind: BotKind;
  readOnly: boolean;
  when: string;
  builtin: boolean;
  source?: string;
}

export const ROSTER_CAP = 40;
const SKIP_KINDS = new Set<BotKind>(['orchestrator', 'approval', 'gate']);
const SKIP_IDS = new Set(['manager', 'tester']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.venv']);
const LANGS = new Set(['go', 'typescript', 'javascript', 'python', 'rust', 'java', 'kotlin', 'cpp', 'csharp', 'fsharp', 'php', 'ruby', 'swift', 'flutter', 'dart', 'react', 'vue', 'django', 'fastapi', 'pytorch']);
const ALIAS: Record<string, string> = { pytorch: 'python' };
const net = /network|vlan|router|firewall|dns/i;
const oss = /open.?source|release|publish/i;
const DOMAIN: Record<string, RegExp> = {
  'healthcare-reviewer': /health|clinical|patient|medical/i,
  'mle-reviewer': /\bml\b|machine learning|model training/i,
  'rag-pipeline-reviewer': /\brag\b|retriev|embedding|vector/i,
  'network-architect': net,
  'network-config-reviewer': net,
  'network-troubleshooter': net,
  'homelab-architect': /homelab|home lab|self.?host/i,
  'harmonyos-app-resolver': /harmony/i,
  'bengali-reviewer': /bengali|bangla/i,
  'marketing-agent': /marketing|campaign|landing page/i,
  'seo-specialist': /\bseo\b/i,
  'opensource-forker': oss,
  'opensource-sanitizer': oss,
  'opensource-packager': oss,
  'a11y-architect': /accessib|a11y/i,
};

function readText(f: string): string {
  try {
    return readFileSync(f, 'utf8').slice(0, 200_000);
  } catch {
    return '';
  }
}

function langsIn(dir: string, out: Set<string>): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const has = (f: string) => names.includes(f);
  const any = (re: RegExp) => names.some((n) => re.test(n));
  if (has('go.mod')) out.add('go');
  if (has('Cargo.toml')) out.add('rust');
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) {
    out.add('python');
    const txt = readText(join(dir, 'pyproject.toml')) + readText(join(dir, 'requirements.txt'));
    if (/django/i.test(txt)) out.add('django');
    if (/fastapi/i.test(txt)) out.add('fastapi');
    if (/\btorch\b/i.test(txt)) out.add('pytorch');
  }
  if (has('package.json')) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(readText(join(dir, 'package.json')) || '{}');
    } catch {
      /* broken package.json: still a JS project */
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    out.add(has('tsconfig.json') || 'typescript' in deps ? 'typescript' : 'javascript');
    if ('react' in deps) out.add('react');
    if ('vue' in deps) out.add('vue');
  }
  if (has('pom.xml')) out.add('java');
  if (has('build.gradle') || has('build.gradle.kts')) {
    out.add('java');
    if (has('build.gradle.kts') || /kotlin/i.test(readText(join(dir, 'build.gradle')))) out.add('kotlin');
  }
  if (has('Package.swift')) out.add('swift');
  if (any(/\.csproj$/)) out.add('csharp');
  if (any(/\.fsproj$/)) out.add('fsharp');
  if (has('composer.json')) out.add('php');
  if (has('Gemfile')) out.add('ruby');
  if (has('pubspec.yaml')) (out.add('flutter'), out.add('dart'));
  if (has('CMakeLists.txt')) out.add('cpp');
}

/** Languages and frameworks in a repo, from files at its root and one folder down. */
export function detectLanguages(dir: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!dir || !existsSync(dir)) return out;
  langsIn(dir, out);
  try {
    for (const d of readdirSync(dir)) {
      if (SKIP_DIRS.has(d) || d.startsWith('.')) continue;
      try {
        if (statSync(join(dir, d)).isDirectory()) langsIn(join(dir, d), out);
      } catch {
        /* unreadable entry */
      }
    }
  } catch {
    /* unreadable repo */
  }
  return out;
}

export function botLanguage(id: string): string | undefined {
  const m = /^([a-z]+)-(?:reviewer|build-resolver)$/.exec(id.replace(/^ecc-/, ''));
  return m && LANGS.has(m[1]!) ? m[1] : undefined;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
// built-ins are recognised by id too: CREW defs registered without load-time flags (tests, packs) still count as built-in
const entry = (b: BotDef): RosterEntry => ({ id: b.id, kind: b.kind, readOnly: !!b.readOnly, when: oneLine(b.whenToUse ?? b.persona ?? b.title), builtin: !!b.builtin || BUILTIN_IDS.has(b.id), ...(b.source ? { source: b.source } : {}) });
const baseName = (id: string) => id.replace(/^ecc-/, '');

export function buildRoster(o: { dir?: string; task: string; crew: BotDef[]; routing?: Routing }): RosterEntry[] {
  const langs = detectLanguages(o.dir);
  const usable = o.crew.filter((b) => !SKIP_KINDS.has(b.kind) && !SKIP_IDS.has(b.id));
  const fixed = usable.filter((b) => b.builtin || !b.source);
  const imported = usable.filter((b) => b.source);
  const lang = imported.filter((b) => {
    const l = botLanguage(b.id);
    return l && langs.has(ALIAS[l] && !langs.has(l) ? ALIAS[l]! : l);
  });
  const domain = imported.filter((b) => DOMAIN[baseName(b.id)]?.test(o.task));
  const order = o.routing?.table ?? [];
  const rank = (b: BotDef) => {
    const i = order.indexOf(baseName(b.id));
    return i < 0 ? order.length : i;
  };
  const general = imported
    .filter((b) => !botLanguage(b.id) && !DOMAIN[baseName(b.id)])
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const out: RosterEntry[] = [];
  for (const b of [...fixed, ...lang, ...general, ...domain]) {
    if (seen.has(b.id) || out.length >= ROSTER_CAP) continue;
    seen.add(b.id);
    out.push(entry(b));
  }
  return out;
}

export function rosterLine(e: RosterEntry): string {
  const line = `- ${e.id} (${e.kind}${e.readOnly ? ', read-only' : ''}) — ${e.when}`;
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
export const rosterText = (es: RosterEntry[]) => es.map(rosterLine).join('\n');

export function routingHints(routing: Routing | undefined, es: RosterEntry[]): string[] {
  if (!routing) return [];
  const ids = new Set(es.map((e) => e.id));
  // ECC's rules name ECC agents: prefer the imported one (ecc-planner) over a built-in with the same name (planner)
  const pick = (name: string) => (ids.has(`ecc-${name}`) ? `ecc-${name}` : ids.has(name) ? name : undefined);
  return routing.rules
    .flatMap((r) => {
      const got = r.agents.map(pick).filter((x): x is string => !!x);
      return got.length ? [`- ${r.when} → ${got.join(', ')}`] : [];
    })
    .slice(0, 12);
}

let cache: { file: string; mtime: number; routing: Routing } | undefined;
export function loadRouting(home: string): Routing | undefined {
  const file = join(vendorDir(home), 'AGENTS.md');
  try {
    const mtime = statSync(file).mtimeMs;
    if (cache?.file === file && cache.mtime === mtime) return cache.routing;
    cache = { file, mtime, routing: parseRouting(readFileSync(file, 'utf8')) };
    return cache.routing;
  } catch {
    return undefined;
  }
}
```

Fix the `lang` filter so it reads plainly: a language bot is kept when `langs.has(l)` or (for `pytorch`) when `langs.has('pytorch')` — `pytorch` is only added by `langsIn` when torch is a dependency, so simply use `const l = botLanguage(b.id); return !!l && langs.has(l);` and drop `ALIAS`. (The test does not depend on `ALIAS`.)

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project node test/roster.test.ts && npx tsc --noEmit`
Expected: PASS. Check for an import cycle: `src/roster.ts` imports only `crew.ts`, `ecc.ts`, `eccImport.ts` (which imports `crew.ts`, `ecc.ts`, `git.ts`) — none of those import `team.ts`, `composer.ts` or `engine.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/roster.ts test/roster.test.ts
git commit -m "roster: language-aware, capped roster with ECC routing hints"
```

---

### Task 8: Team planning — roster, reasons and swaps

**Files:**
- Modify: `src/types.ts` (`TeamPlan`, event union, `foldRun`)
- Modify: `src/team.ts` (`BotSummary`, `planningPrompt`, `parsePlan`)
- Modify: `src/engine.ts` (`planRoundOnce`, new `swapAssignment`)
- Modify: `src/server.ts` (runs action route `(answers|plan|mode)` → add `swap`)
- Modify: `web/src/api.ts` (`describeEvent` case `plan.edit`)
- Test: `test/team.test.ts` (append), `test/team-api.test.ts` (append)

**Interfaces:**
- Consumes: `buildRoster`, `routingHints`, `loadRouting`, `RosterEntry` (Task 7); `CREW` (bots).
- Produces:
  - `TeamPlan.assignments[]` gains `why?: string; swapped?: true`; `TeamPlan` gains `roster?: string[]`
  - event `{ type: 'plan.edit'; assignment: number; from: string; to: string }`
  - `BotSummary` gains optional `kind?: string; readOnly?: boolean; when?: string`
  - `planningPrompt(task, roster, answers, round, maxRounds, asked = [], hints: string[] = [])`
  - `Engine.swapAssignment(runId: string, assignment: number, bot: string): RunState`
  - HTTP `POST /api/runs/:id/swap` body `{ assignment: number, bot: string }` → run view

- [ ] **Step 1: Write the failing tests**

Append to `test/team.test.ts` (it imports `parsePlan`, `planningPrompt`, `foldRun` already; add what's missing):

```ts
describe('roster, reasons and swaps', () => {
  it('lists the roster with when-to-use, adds hints and asks for a why', () => {
    const p = planningPrompt('task', [{ id: 'go-reviewer', title: 'go reviewer', kind: 'verdict', readOnly: true, when: 'Use for Go' }, { id: 'coder', title: 'coder' }], [], 1, 3, [], ['- Go changes → go-reviewer']);
    expect(p).toContain('- go-reviewer (verdict, read-only) — Use for Go');
    expect(p).toContain('- coder: coder');
    expect(p).toContain('Routing hints');
    expect(p).toContain('- Go changes → go-reviewer');
    expect(p).toContain('"why"');
    expect(planningPrompt('task', [], [], 1, 3)).not.toContain('Routing hints');
  });

  it('keeps a why per assignment, capped, and notes a missing one', () => {
    const raw = JSON.stringify({ plan: { goal: 'g', assignments: [{ bot: 'coder', goal: 'x', why: 'w'.repeat(300) }, { bot: 'reviewer', goal: 'y' }] } });
    const r = parsePlan(raw, ['coder', 'reviewer']);
    expect(r.plan!.assignments[0]!.why!.length).toBe(160);
    expect(r.plan!.assignments[1]!.why).toBeUndefined();
    expect(r.errors).toContain('assignment to "reviewer" has no why');
  });

  it('folds a swap into the plan', () => {
    const plan = { goal: 'g', success: [], assignments: [{ bot: 'coder', goal: 'x', mode: 'read' as const, why: 'fits' }], limits: { allowWrites: false }, answers: [], roster: ['coder', 'go-reviewer'] };
    // build the event list the same way this file's `describe('team run state')` tests do (their team-run
    // `run.started` event and stored-event helper), then add the two events below
    const s = foldRun([...teamStartEvents(), at(2, { type: 'plan.ready', plan }), at(3, { type: 'plan.edit', assignment: 0, from: 'coder', to: 'go-reviewer' })]);
    expect(s!.plan!.assignments[0]).toMatchObject({ bot: 'go-reviewer', swapped: true, why: 'fits' });
  });
});
```

(`teamStartEvents()` and `at(seq, event)` stand for the helpers `describe('team run state')` in this file already uses to build a team run's `run.started` stored event and to wrap an event as a `StoredEvent`; use those helpers under their real names — read lines 14–40 of `test/team.test.ts` first.)

Append to `test/team-api.test.ts` (use its existing server/engine setup and the way it gets a team run to `plan.ready` with the mock adapter):

```ts
it('swaps a planned bot only while the plan waits, only to a roster bot', async () => {
  // drive a team run to plan.ready exactly as the existing "approve the plan" test does, with roster ['coder', 'reviewer']
  const bad = await raw('POST', `/api/runs/${id}/swap`, { body: { assignment: 0, bot: 'nobody' } });
  expect(bad.status).toBe(400);
  const ok = await api('POST', `/api/runs/${id}/swap`, { assignment: 0, bot: 'reviewer' });
  expect(ok.plan.assignments[0]).toMatchObject({ bot: 'reviewer', swapped: true });
  await api('POST', `/api/runs/${id}/plan`, { approved: true });
  const late = await raw('POST', `/api/runs/${id}/swap`, { body: { assignment: 0, bot: 'coder' } });
  expect(late.status).toBe(409);
});
```

(Use the helper names that `test/team-api.test.ts` already has for raw requests and JSON requests; set the run's roster through `startTeam({ roster: ['coder','reviewer'], … })` as other tests there do.)

Run: `npx vitest run --project node test/team.test.ts test/team-api.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement types and fold** (`src/types.ts`)

```ts
export interface TeamPlan {
  goal: string;
  success: string[];
  assignments: { bot: string; goal: string; expected?: string; mode: 'read' | 'write'; /** Maestro's reason for this bot. */ why?: string; /** The person picked another bot before approving. */ swapped?: true }[];
  limits: { maxCostUsd?: number; wallClockMs?: number; allowWrites: boolean };
  answers: Answer[];
  /** The bots Maestro could choose from; a swap may only pick one of these. */
  roster?: string[];
}
```

Add `| { type: 'plan.edit'; assignment: number; from: string; to: string }` next to `plan.ready` in the event union, and in `foldRun` next to the `plan.ready` case:

```ts
      case 'plan.edit':
        if (s.plan?.assignments[e.assignment]) s.plan.assignments[e.assignment] = { ...s.plan.assignments[e.assignment]!, bot: e.to, swapped: true };
        break;
```

- [ ] **Step 3: Implement the prompt and parser** (`src/team.ts`)

```ts
export interface BotSummary {
  id: string;
  title: string;
  kind?: string;
  readOnly?: boolean;
  /** One line on when to pick this bot. */
  when?: string;
}
const botLine = (b: BotSummary) => {
  if (!b.when) return `- ${b.id}: ${b.title}`;
  const line = `- ${b.id} (${b.kind ?? 'agent'}${b.readOnly ? ', read-only' : ''}) — ${b.when.replace(/\s+/g, ' ')}`;
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
};
```

In `planningPrompt` add the parameter `hints: string[] = []` and replace the roster block with:

```
Bots you may assign:
${roster.map(botLine).join('\n') || '(none)'}
${hints.length ? `\nRouting hints (who usually fits what; use only bots listed above):\n${hints.join('\n')}\n` : ''}
```

and change the plan JSON example's assignment to `{"bot":"<bot id>","goal":"...","expected":"...","mode":"read"|"write","why":"one line on why this bot fits (max 160 characters)"}`.

In `parsePlan`, after `const expected = …`:

```ts
    const why = str(a.why, 160);
    if (!why) errors.push(`assignment to "${bot}" has no why`);
    assignments.push({ bot, goal: g, ...(expected ? { expected } : {}), mode, ...(why ? { why } : {}) });
```

- [ ] **Step 4: Implement engine roster and swap** (`src/engine.ts`)

In `planRoundOnce`, replace the two lines that build `roster` and `bots` with:

```ts
    const explicit = s.team?.roster?.length ? s.team.roster : undefined;
    const crew = Object.values(CREW).flatMap((c) => (c.def ? [c.def] : []));
    const routing = loadRouting(this.opts.home);
    let entries = buildRoster({ dir: s.workdir, task: s.task, crew, routing });
    if (explicit) entries = explicit.map((id) => entries.find((e) => e.id === id) ?? { id, kind: 'agent', readOnly: false, when: '', builtin: false });
    const roster = entries.map((e) => e.id);
    const bots: BotSummary[] = entries.map((e) => ({ id: e.id, title: CREW[e.id]?.title ?? e.id, kind: e.kind, readOnly: e.readOnly, ...(e.when ? { when: e.when } : {}) }));
    const hints = routingHints(routing, entries);
```

(`this.opts.home` — use whatever the Engine stores its home in; the Engine is constructed with `{ home, … }`.) Pass `hints` as the new last argument of `planningPrompt(...)`, and when appending `plan.ready` include the roster: `const ready = { ...(plan ?? defaultPlan(now.task, roster, now.answers)), roster };`.

Add the method (next to `approveTeamPlan`):

```ts
  /** Before approval, the person may give an assignment to another bot from the planning roster. */
  swapAssignment(runId: string, assignment: number, bot: string): RunState {
    const s = this.teamState(runId);
    if (!planWaiting(s) || !s.plan) throw new TeamError('conflict', 'the plan can only be changed while it waits for approval');
    const a = s.plan.assignments[assignment];
    if (!Number.isInteger(assignment) || !a) throw new TeamError('invalid', `no assignment ${assignment + 1}`);
    const roster = s.plan.roster ?? rosterOf({ roster: s.team?.roster } as PipelineNode);
    if (!roster.includes(bot)) throw new TeamError('invalid', `"${bot}" is not on this plan's roster`);
    if (a.bot !== bot) this.store.append(runId, { type: 'plan.edit', assignment, from: a.bot, to: bot });
    return this.state(runId);
  }
```

Imports: `buildRoster, loadRouting, routingHints` from `./roster.js`; `planWaiting` from `./types.js` if not imported; `TeamError` from `./team.js` if not imported.

- [ ] **Step 5: Implement the route and the web event text**

`src/server.ts`: the runs action regex `(answers|plan|mode)` becomes `(answers|plan|mode|swap)`; add the branch:

```ts
        if (action === 'swap') {
          const b = (await readJson(req)) as { assignment?: unknown; bot?: unknown };
          if (typeof b.assignment !== 'number' || typeof b.bot !== 'string') throw new HttpError(400, 'body must be { assignment: number, bot: string }');
          engine.swapAssignment(id, b.assignment, b.bot);
          return send(res, 200, runView(id)), true;
        }
```

(match the variable names used by the existing `answers|plan|mode` branch; errors go through the same `teamError(e)` mapping, so `TeamError('invalid')` → 400 and `'conflict'` → 409 — confirm that mapping in `teamError` and add those two codes if absent.)

`web/src/api.ts` `describeEvent`: add

```ts
    case 'plan.edit':
      return { text: `you gave assignment ${e.assignment + 1} to ${e.to} (was ${e.from})`, tone: 'info' };
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run --project node test/team.test.ts test/team-api.test.ts test/team-cli.test.ts test/handoff.test.ts && npx vitest run --project web && npm run typecheck`
Expected: PASS (re-run a file alone if it times out under load).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/team.ts src/engine.ts src/server.ts web/src/api.ts test/team.test.ts test/team-api.test.ts
git commit -m "team: repo-aware roster with routing hints, a why per assignment, swaps before approval"
```

---

### Task 9: Compose prompt and handoffs use the roster

**Files:**
- Modify: `src/composer.ts` (`crewLines`, `COMPOSE_PROMPT`, `composePipeline`)
- Modify: `src/handoff.ts` (`rosterLines`)
- Test: `test/crew.test.ts` (composer section, append), `test/handoff.test.ts` (append)

**Interfaces:**
- Consumes: `buildRoster`, `rosterText`, `loadRouting` (Task 7); `CREW`.
- Produces: `composePrompt(task: string, tests: string | undefined, custom: string, who?: BotDef): string` (exported; replaces the internal `COMPOSE_PROMPT` arrow).

- [ ] **Step 1: Write the failing tests**

Append to `test/crew.test.ts` (composer section):

```ts
it('offers only roster bots that fit the repo in the compose prompt', () => {
  const look = BUILTIN_BOTS[0]!.look;
  registerCrew([...BUILTIN_BOTS, { id: 'go-reviewer', name: 'Go', title: 'go', kind: 'verdict', readOnly: true, persona: '', look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go' }, { id: 'python-reviewer', name: 'Py', title: 'py', kind: 'verdict', readOnly: true, persona: '', look, source: 'ecc@v2.2.3', whenToUse: 'Use for Python' }]);
  const dir = tmp('repo-');
  writeFileSync(join(dir, 'go.mod'), 'module x');
  const custom = rosterCustomText(dir, 'task');
  expect(custom).toContain('go-reviewer (verdict, read-only) — Use for Go');
  expect(custom).not.toContain('python-reviewer');
  expect(composePrompt('task', 'npm test', custom)).toContain('Custom crew members you may also use');
});
```

Append to `test/handoff.test.ts`: register a bot with `whenToUse: 'Use for Go'` and assert `planPrompt(...)` (or `rosterLines`, if exported) contains `go-reviewer (…): Use for Go`. Use the file's existing manager fixtures.

Run: `npx vitest run --project node test/crew.test.ts test/handoff.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/composer.ts`:

```ts
/** Your own and imported bots that fit this repo and task, as roster lines (built-ins are listed separately). */
export function rosterCustomText(repo: string | undefined, task: string, home?: string): string {
  const crew = Object.values(CREW).flatMap((c) => (c.def ? [c.def] : []));
  const routing = home ? loadRouting(home) : undefined;
  return rosterText(buildRoster({ dir: repo, task, crew, routing }).filter((e) => !e.builtin));
}
```

Rename `COMPOSE_PROMPT` to an exported `composePrompt(task, tests, custom, who?)` with the same text, replacing `${crewLines() ? … + crewLines() + … : ''}` with `${custom ? '\nCustom crew members you may also use (a gate runs a command; a verdict step reviews and ends PASS/FAIL):\n' + custom + '\n' : ''}`. In `composePipeline`, compute `const custom = rosterCustomText(o.repo, task, o.home)` (add optional `home?: string` to `ComposeOpts`; pass it from the callers that have a home — `cli.ts orchestrate` and `maestro.ts`, where `cfg.home` is in scope) and call `composePrompt(task, tests, custom, who)`. Delete `crewLines` if nothing else uses it. Keep `proposableSteps()` as the validation set (it already includes every custom bot id).

`src/handoff.ts` `rosterLines`: use the bot's `whenToUse` when it has one:

```ts
  const def = CREW[id]?.def;
  const blurb = def?.whenToUse ? def.whenToUse.replace(/\s+/g, ' ').slice(0, 100) : id in STEP_BLURB ? STEP_BLURB[id as StepType] : blurbFor({ id: '', kind: 'agent', role: id, x: 0, y: 0 });
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project node test/crew.test.ts test/handoff.test.ts test/maestro.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/composer.ts src/handoff.ts src/cli.ts src/maestro.ts test/crew.test.ts test/handoff.test.ts
git commit -m "orchestrate and handoffs: list roster bots with when-to-use"
```

---

### Task 10: Server routes for import and skills

**Files:**
- Modify: `src/server.ts`
- Test: `test/server.test.ts` (append)

**Interfaces:**
- Consumes: `importEcc`, `removeEcc`, `eccInfo`, `gitFetch`, `Fetch` (Task 3); `aorchSkills`, `eccSkills`, `eccSkillPrompt`, `findSkill` (Task 5); `refreshCrew` (bots); `ECC_REF` (Task 2).
- Produces:
  - `GET /api/crew` adds `ecc: { ref, at } | null` and `eccDefault: 'v2.2.3'`; each bot keeps `source`, `whenToUse`, `modelHint`, `look.face`
  - `POST /api/crew/import` body `{ source: 'ecc', ref?: string }` → `EccDiff`
  - `DELETE /api/crew?source=ecc` → `{ removed: string[] }`
  - `GET /api/skills?source=<s>` → `{ name, description, source, kind? }[]` (aorch + ECC; Claude skills are not listed here because the server has no repo)
  - `GET /api/skills/ecc/<name>` → `{ name, prompt }`
  - Server option `eccFetch?: Fetch` (defaults to `gitFetch`) for tests

- [ ] **Step 1: Write the failing tests**

Append to `test/server.test.ts` (it starts the server in `beforeAll` with `startServer({ …, cfg: { home, … } })`; add `eccFetch` to that call: `eccFetch: async (dest) => void cpSync(join(root,'test/fixtures/ecc'), dest, { recursive: true })`, where `root` is the repo root as in other tests):

```ts
describe('crew import and skills', () => {
  it('imports ECC, exposes it on /api/crew and /api/skills, and removes it', async () => {
    const d = await api('POST', '/api/crew/import', { source: 'ecc' });
    expect(d.added).toHaveLength(5);
    const crew = await api('GET', '/api/crew');
    expect(crew.ecc.ref).toBe('v2.2.3');
    expect(crew.bots.find((b: { id: string }) => b.id === 'go-reviewer')).toMatchObject({ source: 'ecc@v2.2.3', whenToUse: expect.stringMatching(/Go/) });
    const skills = await api('GET', '/api/skills?source=ecc');
    expect(skills.map((s: { name: string }) => s.name)).toEqual(['tdd-workflow', 'plan']);
    expect((await api('GET', '/api/skills/ecc/tdd-workflow')).prompt).toMatch(/<skill>/);
    expect((await api('DELETE', '/api/crew?source=ecc')).removed).toHaveLength(5);
    expect((await api('GET', '/api/crew')).ecc).toBeNull();
  });

  it('refuses unknown sources and cross-origin imports', async () => {
    expect((await raw('POST', '/api/crew/import', { body: { source: 'x' } })).status).toBe(400);
    expect((await raw('POST', '/api/crew/import', { body: { source: 'ecc' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await raw('GET', '/api/skills/ecc/nope')).status).toBe(404);
  });
});
```

(Adapt `api`/`raw` call shapes to this file's helpers: `raw(method, path, { headers, body })` and `api(method, path, body)`.)

Run: `npx vitest run --project node test/server.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

In the server options type add `eccFetch?: Fetch`. In `route()`:

```ts
    if (p === '/api/crew/import' && m === 'POST') {
      const b = (await readJson(req)) as { source?: unknown; ref?: unknown };
      if (b.source !== 'ecc') throw new HttpError(400, 'source must be "ecc"');
      const ref = typeof b.ref === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(b.ref) ? b.ref : undefined;
      const diff = await importEcc(cfg.home, { ref, fetch: opts.eccFetch ?? gitFetch });
      refreshCrew(cfg.home);
      return send(res, 200, diff), true;
    }
    if (p === '/api/crew' && m === 'DELETE') {
      if (url.searchParams.get('source') !== 'ecc') throw new HttpError(400, 'source must be "ecc"');
      const removed = removeEcc(cfg.home);
      refreshCrew(cfg.home);
      return send(res, 200, { removed }), true;
    }
    if (p === '/api/skills' && m === 'GET') {
      const src = url.searchParams.get('source');
      const all = [...aorchSkills(cfg.home), ...eccSkills(cfg.home)].filter((s) => !src || s.source === src);
      return send(res, 200, all.map((s) => ({ name: s.name, description: s.description, source: s.source, ...(s.kind ? { kind: s.kind } : {}) }))), true;
    }
    if ((g = /^\/api\/skills\/ecc\/([A-Za-z0-9][A-Za-z0-9:_.-]{0,63})$/.exec(p)) && m === 'GET') {
      const skill = findSkill(eccSkills(cfg.home), `ecc:${g[1]}`);
      if (!skill) throw new HttpError(404, 'no such ECC skill');
      return send(res, 200, { name: skill.name, prompt: eccSkillPrompt(skill) }), true;
    }
```

Place `DELETE /api/crew` before the `/api/crew/:id` routes. In the `GET /api/crew` response add `ecc: eccInfo(cfg.home) ?? null, eccDefault: ECC_REF`. (Use the names the file already uses for the options object, `cfg`, `url`, and the regex-match variable `g`.)

A failed git fetch surfaces as a 500 with the git message through the existing error handler — check the handler sends `{ error: message }`; if it hides messages for 500s, wrap `importEcc` in `try/catch` and throw `new HttpError(502, (e as Error).message)`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project node test/server.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "server: import/remove ECC and list ECC skills"
```

---

### Task 11: Terminal — reasons and `/swap`

**Files:**
- Modify: `src/teamchat.ts` (export `parseSwap`)
- Modify: `src/tui.ts` (plan rendering near lines 1222-1231, `slash()` near 727)
- Modify: `src/cli.ts` (`aorch plan` text output shows `why`, if it prints assignments)
- Test: `test/team-ui.test.ts` (append) or `test/teamchat.test.ts` if one exists

**Interfaces:**
- Consumes: `Engine.swapAssignment` (Task 8).
- Produces: `parseSwap(line: string): { assignment: number; bot: string } | undefined` — `/swap 2 go-reviewer` → `{ assignment: 1, bot: 'go-reviewer' }`.

- [ ] **Step 1: Write the failing test**

```ts
import { parseSwap } from '../src/teamchat.js';

describe('/swap', () => {
  it('parses a 1-based assignment and a bot id', () => {
    expect(parseSwap('/swap 2 go-reviewer')).toEqual({ assignment: 1, bot: 'go-reviewer' });
    expect(parseSwap('/swap 0 x')).toBeUndefined();
    expect(parseSwap('/swap two x')).toBeUndefined();
    expect(parseSwap('/approve')).toBeUndefined();
  });
});
```

Run: `npx vitest run --project node test/team-ui.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/teamchat.ts`:

```ts
/** `/swap <n> <bot>`: give plan assignment n (1-based) to another bot. */
export function parseSwap(line: string): { assignment: number; bot: string } | undefined {
  const m = /^\/swap\s+(\d+)\s+([a-z][a-z0-9_-]{0,23})\s*$/.exec(line.trim());
  const n = m ? Number(m[1]) : 0;
  return m && n >= 1 ? { assignment: n - 1, bot: m[2]! } : undefined;
}
```

`src/tui.ts`:
- In the plan rendering loop, number the assignments and show the reason and swap mark:
  `para(\`  ${i + 1}. ${a.mode === 'write' ? amber('✎') : dim('·')} ${a.bot}${a.swapped ? dim(' (your pick)') : ''}: \`, safeText(a.goal), '      ');` and, when `a.why`, a second line `dim(\`     why: ${safeText(a.why)}\`)`. After the list, add the hint `dim('/swap <n> <bot> to give one to another bot')` next to the `/approve` `/reject` hint, and when `plan.roster` exists, `dim(\`roster: ${plan.roster.join(', ')}\`)` (truncate to the line width with the file's existing truncation helper).
- In `slash(s, line)`, before the `/approve` handling: `const sw = parseSwap(line); if (sw) { try { this.ctx.engine.swapAssignment(runId, sw.assignment, sw.bot); this.note(\`assignment ${sw.assignment + 1} → ${sw.bot}\`); } catch (e) { this.note((e as Error).message); } return true; }` — use the names the surrounding code uses for the engine, the current run id and for showing a status line.

`src/cli.ts` `aorch plan` (lines ~682-689): if it prints assignments, append ` — why: …` when present.

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project node test/team-ui.test.ts test/team-cli.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/teamchat.ts src/tui.ts src/cli.ts test/team-ui.test.ts
git commit -m "tui: show why per assignment and /swap a planned bot"
```

---

### Task 12: Web — Blobatar faces

**Files:**
- Modify: `package.json` (devDependency `blobatar`)
- Create: `web/src/components/arc/slider/**` (vendored by `scripts/arc-add.mjs`)
- Modify: `web/src/crewStore.ts` (`BotDef`, `CrewEntry`)
- Rewrite: `web/src/Face.tsx`
- Modify: `web/src/main.tsx` (load `blobatar/motion.css`)
- Modify: `web/src/Canvas.tsx` (face in the node head)
- Test: `web/src/Face.test.tsx` (rewrite), `web/src/Canvas.test.tsx` (append)

**Interfaces:**
- Produces (from `web/src/Face.tsx`):
  - `type Mood = 'idle' | 'working' | 'done' | 'failed' | 'waiting' | 'asleep' | 'stopped'`
  - `MOOD_EXPRESSION: Record<Mood, string>` (expression names, for tests and docs)
  - `moodFor(status?: string): Mood` (`running`→working, `done`→done, `error`→failed, `awaiting`|`paused`→waiting, `stopped`→stopped, else idle)
  - `type Animate = 'hover' | 'always'`
  - `faceSvg(id: string, o?: { mood?: Mood; face?: FaceLook; size?: number; animate?: Animate }): string`
  - `faceUri(id: string, o?: { mood?; face?; size? }): string` (`data:image/svg+xml;utf8,…`, static only)
  - `Face(props: { id: string; mood?: Mood; size?: number; label?: string; face?: FaceLook; animate?: Animate })` → static `<img>`, or with `animate` an inline-SVG `<span role="img">`
- `crewStore.ts`: `FaceLook`, `Look.face?`, `BotDef.source?/whenToUse?/modelHint?`, `CrewEntry.face?`, `CrewEntry.source?`, `CrewEntry.whenToUse?`.

- [ ] **Step 1: Install and vendor**

```bash
npm install --save-dev blobatar@2.7.0
node scripts/arc-add.mjs slider
```

Install any npm dependency the script prints that is not already in `package.json` (expected: none beyond `motion`). Run the network grep over the new folder:
`grep -rnE "fetch\(|XMLHttpRequest|sendBeacon|https?://" web/src/components/arc/slider | grep -v w3.org` → no output.

- [ ] **Step 2: Write the failing tests**

`web/src/Face.test.tsx` (replace the file):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyCrew } from './crewStore';
import { Face, faceSvg, faceUri, MOOD_EXPRESSION, moodFor } from './Face';

describe('faces', () => {
  it('maps moods to expressions and statuses to moods', () => {
    expect(MOOD_EXPRESSION).toEqual({ idle: 'idle', working: 'thinking', done: 'happy', failed: 'sad', waiting: 'unsure', asleep: 'sleepy', stopped: 'mad' });
    expect(moodFor('running')).toBe('working');
    expect(moodFor('awaiting')).toBe('waiting');
    expect(moodFor('error')).toBe('failed');
    expect(moodFor(undefined)).toBe('idle');
  });

  it('is deterministic per id and stable across releases', () => {
    expect(faceSvg('coder')).toBe(faceSvg('coder'));
    expect(faceSvg('coder')).not.toBe(faceSvg('planner'));
    expect(faceSvg('coder', { mood: 'working' })).not.toBe(faceSvg('coder'));
    expect({ orchestrator: faceSvg('orchestrator'), planner: faceSvg('planner'), coder: faceSvg('coder') }).toMatchSnapshot();
  });

  it('applies face overrides and renders an image with the bot name', () => {
    expect(faceSvg('coder', { face: { hue: 10 } })).not.toBe(faceSvg('coder'));
    applyCrew([{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: '', look: { body: '', eyes: '', mouth: '', top: '', side: '', pattern: '', color: '#3fb97c', accent: 'auto' } }]);
    render(<Face id="coder" size={40} />);
    const img = screen.getByRole('img', { name: 'Bolt' }) as HTMLImageElement;
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(faceUri('coder')).toContain(encodeURIComponent('<svg'));
  });

  it('animates as inline SVG: always, or on hover', () => {
    const { container } = render(
      <>
        <Face id="coder" mood="working" animate="always" />
        <Face id="planner" animate="hover" />
      </>,
    );
    const [always, hover] = [...container.querySelectorAll('span.face[role="img"]')];
    expect(always!.querySelector('svg.mo-root.mo-always, svg .mo-root.mo-always, .mo-root.mo-always')).toBeTruthy();
    expect(hover!.querySelector('.mo-root')).toBeTruthy();
    expect(hover!.querySelector('.mo-always')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
```

(Blobatar puts the `mo-root` class on the root `<svg>` or its first group depending on version — the selector list above covers both; keep whichever matches and drop the others.)

Append to `web/src/Canvas.test.tsx`:

```tsx
it('shows each step’s bot face with its mood, animated while it works', () => {
  const { container } = render(<Canvas nodes={nodes} edges={edges} statuses={run.nodes} />);
  expect(container.querySelectorAll('[data-node] [data-mood]')).toHaveLength(3);
  const code = container.querySelector('[data-id="code"] [data-mood]')!;
  expect(code.getAttribute('data-mood')).toBe('working');
  expect(code.tagName).toBe('SPAN');
  expect(container.querySelector('[data-id="gate"] [data-mood]')!.tagName).toBe('IMG');
});
```

Run: `npx vitest run --project web web/src/Face.test.tsx web/src/Canvas.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `web/src/Face.tsx`**

```tsx
import { blobatar } from 'blobatar';
import * as X from 'blobatar/expression';
import { useCrew, type FaceLook } from './crewStore';

export type Mood = 'idle' | 'working' | 'done' | 'failed' | 'waiting' | 'asleep' | 'stopped';
const EXPR = { idle: X.idle, working: X.thinking, done: X.happy, failed: X.sad, waiting: X.unsure, asleep: X.sleepy, stopped: X.mad } as const;
export const MOOD_EXPRESSION: Record<Mood, string> = { idle: 'idle', working: 'thinking', done: 'happy', failed: 'sad', waiting: 'unsure', asleep: 'sleepy', stopped: 'mad' };

export function moodFor(status?: string): Mood {
  switch (status) {
    case 'running':
      return 'working';
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    case 'awaiting':
    case 'paused':
      return 'waiting';
    case 'stopped':
      return 'stopped';
    default:
      return 'idle';
  }
}

export type Animate = 'hover' | 'always';

/** A bot's face, generated on this machine from its id (blobatar is bundled; blobatar.dev is never called). */
export function faceSvg(id: string, o: { mood?: Mood; face?: FaceLook; size?: number; animate?: Animate } = {}): string {
  return blobatar(id, {
    size: o.size ?? 48,
    normalize: false,
    background: 'squircle',
    expression: EXPR[o.mood ?? 'idle'],
    ...(o.animate ? { animate: o.animate } : {}),
    ...(o.face?.hue !== undefined ? { hue: o.face.hue } : {}),
    ...(o.face?.tone !== undefined ? { tone: o.face.tone } : {}),
    ...(o.face?.traits ? { traits: o.face.traits } : {}),
  });
}
/** Static faces only: an <img> cannot animate (CSS cannot reach inside it). */
export const faceUri = (id: string, o?: { mood?: Mood; face?: FaceLook; size?: number }) => `data:image/svg+xml;utf8,${encodeURIComponent(faceSvg(id, o))}`;

export function Face(props: { id: string; mood?: Mood; size?: number; label?: string; face?: FaceLook; animate?: Animate }) {
  const { crew } = useCrew();
  const c = crew[props.id];
  const size = props.size ?? 40;
  const face = props.face ?? c?.face;
  const label = props.label ?? c?.name ?? props.id;
  const mood = props.mood ?? 'idle';
  if (props.animate)
    return (
      <span
        className="face"
        role="img"
        aria-label={label}
        data-mood={mood}
        style={{ width: size, height: size }}
        // generated locally from a bot id by blobatar; no user markup reaches this string
        dangerouslySetInnerHTML={{ __html: faceSvg(props.id, { mood, face, size, animate: props.animate }) }}
      />
    );
  return <img src={faceUri(props.id, { mood, face, size })} width={size} height={size} alt={label} data-mood={mood} className="face" />;
}
```

If TypeScript rejects `traits` or `animate` (the library's `TraitOverrides` / `Animate` types), cast: `traits: o.face.traits as never`, `animate: o.animate as never`.

`web/src/main.tsx`: add `import 'blobatar/motion.css';` after the Arc foundation import (the package exports `./motion.css`). Add to `web/src/styles.css`: `.face { display: inline-block; line-height: 0; } span.face > svg { width: 100%; height: 100%; }`.

`web/src/crewStore.ts`: add `export interface FaceLook { hue?: number; tone?: number; traits?: Record<string, number> }`, `face?: FaceLook` to `Look`, `source?: string; whenToUse?: string; modelHint?: string` to `BotDef`, and `face?: FaceLook; source?: string; whenToUse?: string` to `CrewEntry`; in `applyCrew` copy `face: b.look.face, source: b.source, whenToUse: b.whenToUse`. Remove `MARK_STYLES`, `shapes`, `glyphs` and `style` from the store only if nothing else in `web/src` uses them after Task 13; otherwise leave them.

`web/src/Canvas.tsx`: in the node head, replace the glyph `<span className="glyph">…</span>` with `<Face id={crewFor(n, crew)} mood={mood} size={22} animate={mood === 'working' || mood === 'waiting' ? 'always' : undefined} />` where `const mood = moodFor(st?.status)` (import `Face`, `moodFor`). Add to `web/src/styles.css`: `.node-head .face { border-radius: 6px; flex: none; }`.

Delete the old `Sprite`, `Mark` and pebble code from `Face.tsx`; fix any import of them (Crew.tsx is rewritten in Task 13 — until then replace its `Sprite`/`Mark` uses with `<Face id={…} />` so it compiles).

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npx vitest run --project web && npm run typecheck && npm run build && grep -c "blobatar.dev" web/dist/assets/*.js || true`
Expected: tests PASS (the snapshot file `web/src/__snapshots__/Face.test.tsx.snap` is created — commit it), typecheck clean, build OK, grep count `0` for every file.

- [ ] **Step 5: Commit**

```bash
git add package.json web/src/Face.tsx web/src/Face.test.tsx web/src/__snapshots__ web/src/crewStore.ts web/src/main.tsx web/src/Canvas.tsx web/src/Canvas.test.tsx web/src/styles.css web/src/components/arc/slider web/src/Crew.tsx
git commit -m "web: generated, animated Blobatar faces with moods, in the crew and on the canvas"
```

---

### Task 13: Web — Crew tab with sources, faces and ECC import

**Files:**
- Modify: `web/src/Crew.tsx`
- Test: `web/src/Crew.test.tsx` (update + append)

**Interfaces:**
- Consumes: `Face` (Task 12); Arc `Slider`, `Tabs`, `Dialog`, `Badge`, `Button`; `ConfirmButton`, `useNotify`; server routes from Task 10.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests** (append to `web/src/Crew.test.tsx`; extend its `GET /api/crew` fixture with `ecc: null, eccDefault: 'v2.2.3'`, and add `'POST /api/crew/import': { ref: 'v2.2.3', added: ['go-reviewer'], updated: [], removed: [], skipped: [], notes: [], skills: 1, commands: 1 }` and `'DELETE /api/crew': { removed: ['go-reviewer'] }` to its routes)

```tsx
describe('crew sources and faces', () => {
  it('filters by source and shows when-to-use', async () => {
    routeApi({ ...routes, 'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', persona: '', look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go' }], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } }, 'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] } });
    renderApp(<Crew />);
    expect(await screen.findByText('Use for Go')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Built-in/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Built-in/ }));
    expect(screen.queryByText('Go Reviewer')).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /ECC/ }));
    fireEvent.click(screen.getByRole('tab', { name: /ECC/ }));
    expect(screen.getByText('Go Reviewer')).toBeTruthy();
  });

  it('imports ECC after confirming in a dialog', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: 'Import ECC…' }));
    expect(await screen.findByText(/v2\.2\.3/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import' })));
    expect(calls('POST', '/api/crew/import')[0]![2]).toEqual({ source: 'ecc' });
  });

  it('edits a face with sliders and saves it on the bot', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    const before = (await screen.findByRole('img', { name: 'Bolt preview' })).innerHTML;
    fireEvent.keyDown(screen.getByRole('slider', { name: /Hue/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('img', { name: 'Bolt preview' }).innerHTML).not.toBe(before);
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    expect(calls('PUT', '/api/crew/coder')[0]![2]).toMatchObject({ look: { face: { hue: expect.any(Number) } } });
  });

  it('shows no ECC wording when nothing is imported except the import button', async () => {
    renderApp(<Crew />);
    await screen.findByText('Bolt');
    expect(screen.queryByRole('tab', { name: /ECC/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove ECC' })).toBeNull();
  });
});
```

(Use this file's existing fixture names for the crew reply, bots reply and look; if the Arc Slider's role/name differs, query the input it renders by its label "Hue" — check `web/src/components/arc/slider/slider.tsx`.)

Run: `npx vitest run --project web web/src/Crew.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement** (in `web/src/Crew.tsx`)

- Remove the crew-style `SegmentedControl` and its `pickStyle` call, the look-part selects, swatches, colour inputs and the `POST /api/crew/preview` preview.
- Header: `Button` "Import ECC…" when `meta.ecc` is null, otherwise "Update ECC…" plus `<ConfirmButton label="Remove ECC" prompt="Remove every ECC bot and the vendored checkout?" confirmLabel="Remove" onConfirm={removeEcc} />` where `removeEcc` calls `DELETE /api/crew?source=ecc`, toasts `Removed ${n} ECC bots`, and reloads.
- Import dialog: Arc `Dialog` titled "Import ECC" with description "Adds ECC's agents as crew bots and its skills and commands to the skills list. Hooks and rules are not imported. Source: github.com/affaan-m/ECC (MIT)." and a line `Version ${meta.ecc?.ref ? `${meta.ecc.ref} → ` : ''}${meta.eccDefault}`; buttons Cancel / `Import` (`Button loading`) → `POST /api/crew/import { source: 'ecc' }` → toast `ECC ${d.ref}: ${d.added.length} added, ${d.updated.length} updated, ${d.removed.length} removed` → close → reload (`loadCrewDefs(true)` too).
- Filter: Arc `Tabs` above the grid with `All n`, `Built-in n`, `Custom n`, and `ECC n` only when any bot has a `source` starting with `ecc@`. Filtering uses `defs` (`builtin`, `source`).
- Cards: `<Face id={r.role} size={48} animate="hover" />` inside the edit button (`aria-label={`Edit ${r.name}`}`; `Face` reads the saved face overrides from the crew store); under the title show `def.whenToUse` (or `def.persona` for others, as today); a `Badge size="sm"` with `ECC` for imported bots.
- Editor drawer: Name, Title, Kind, Persona, Read-only as today; the persona `Textarea` of an imported bot shows a note "From ECC; an update replaces your edits". Face section: preview `<Face id={id || 'new-bot'} face={face} size={120} animate="hover" label={`${name || 'New bot'} preview`} />`, `<Slider label="Hue" min={0} max={359} step={1} value={face.hue ?? defaultHue} onValueChange={(v) => patchFace({ hue: v })} />` (`defaultHue` = 200 when unset, displayed but not saved until moved), `<Slider label="Tone" min={0} max={1} step={0.05} value={face.tone ?? 0.5} format={(v) => v.toFixed(2)} onValueChange={(v) => patchFace({ tone: v })} />`, and `Button variant="ghost"` "Reset to generated" that removes `look.face`. `patchFace` updates `edit.look.face`. Save sends the whole bot as today (`PUT /api/crew/:id`), so `look.face` reaches the server.
- Packs: each bot in a pack renders `<Face id={b.id} size={34} />`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project web && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/Crew.tsx web/src/Crew.test.tsx
git commit -m "web: crew tab with sources, Blobatar faces, face editor and ECC import"
```

---

### Task 14: Web — plan reasons and swaps, skills in the Builder

**Files:**
- Modify: `web/src/Team.tsx` (plan assignments)
- Modify: `web/src/Runs.tsx` (the `send` path type for TeamPanel)
- Modify: `web/src/Builder.tsx` (skills in the palette)
- Test: `web/src/Team.test.tsx` (append), `web/src/Builder.test.tsx` (append)

**Interfaces:**
- Consumes: `POST /api/runs/:id/swap`, `GET /api/skills`, `GET /api/skills/ecc/:name` (Tasks 8, 10); `Face`, Arc `Select`, `SearchField`, `Badge`.
- Produces: `TeamPanel` `send` path type becomes `'answers' | 'plan' | 'mode' | 'swap'`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/Team.test.tsx`:

```tsx
it('shows each assignment’s why and swaps a bot from the roster', async () => {
  const send = vi.fn().mockResolvedValue(true);
  const plan = { goal: 'Ship', success: [], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const, why: 'repo is Go' }, { bot: 'reviewer', goal: 'review', mode: 'read' as const, swapped: true as const }], limits: { allowWrites: true }, answers: [], roster: ['coder', 'reviewer', 'go-reviewer'] };
  renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
  expect(screen.getByText(/repo is Go/)).toBeTruthy();
  expect(screen.getByText('swapped by you')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('combobox', { name: /Bot/ })[0]!);
  fireEvent.click(await screen.findByRole('option', { name: 'go-reviewer' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith('swap', { assignment: 0, bot: 'go-reviewer' }));
});
```

(If opening Radix Select in jsdom needs `pointerDown`, use `fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })` then `keyDown` Enter, as other tests in this repo do for Arc Select — check `web/src/Builder.test.tsx`.)

Append to `web/src/Builder.test.tsx` (add routes `'GET /api/skills': [{ name: 'tdd-workflow', description: 'TDD', source: 'ecc', kind: 'skill' }]` and `'GET /api/skills/ecc/tdd-workflow': { name: 'tdd-workflow', prompt: 'PROMPT' }` to its `beforeEach`):

```tsx
it('adds an ECC skill as a step', async () => {
  renderApp(<Builder onStarted={() => {}} />);
  await waitFor(() => screen.getByDisplayValue('plan-code-review'));
  await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
  vi.mocked(api).mockClear();
  fireEvent.change(screen.getByLabelText('Find a skill'), { target: { value: 'tdd' } });
  await act(async () => fireEvent.click(await screen.findByRole('button', { name: /tdd-workflow/ })));
  await waitFor(() => {
    const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { title?: string; prompt?: string }[] } | undefined;
    expect(body?.nodes.at(-1)).toMatchObject({ title: 'tdd-workflow', prompt: 'PROMPT' });
  });
});
```

Run: `npx vitest run --project web web/src/Team.test.tsx web/src/Builder.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

`web/src/Team.tsx`: change the `send` prop type to include `'swap'`. Each plan assignment row becomes:

```tsx
<li key={`${a.bot}-${i}`} className="assign-row">
  <Face id={a.bot} size={36} animate="hover" />
  <div className="assign-main">
    <div>
      <b>{a.bot}</b> <Badge size="sm" tone={a.mode === 'write' ? 'warning' : 'neutral'}>{a.mode === 'write' ? 'can edit files' : 'read only'}</Badge>
      {a.swapped ? <Badge size="sm" tone="info">swapped by you</Badge> : null}
    </div>
    <div>{a.goal}{a.expected ? <small className="muted"> — expects: {a.expected}</small> : null}</div>
    {a.why ? <small className="muted">Why: {a.why}</small> : null}
  </div>
  {plan.roster?.length ? (
    <Select label="Bot" options={[...new Set([a.bot, ...plan.roster])].map((b) => ({ value: b, label: b }))} value={a.bot} onValueChange={(b) => b !== a.bot && void props.send('swap', { assignment: i, bot: b })} disabled={busy} />
  ) : null}
</li>
```

with CSS in `web/src/styles.css`: `.assign-row { display: flex; gap: 12px; align-items: flex-start; } .assign-main { flex: 1; min-width: 0; display: grid; gap: 2px; }`. (`a.bot` is always first in the options so the current value exists.)

`web/src/Runs.tsx`: the `TeamPanel send` adapter already forwards any path to `act(path, body)`; widen its type to include `'swap'`.

`web/src/Builder.tsx`: below the step palette, a "Skills" section:

```tsx
const [skills, setSkills] = useState<{ name: string; description: string; source: string; kind?: string }[]>([]);
const [skillQ, setSkillQ] = useState('');
useEffect(() => { api<typeof skills>('GET', '/api/skills?source=ecc').then(setSkills).catch(() => setSkills([])); }, []);
const shown = skills.filter((s) => !skillQ || `${s.name} ${s.description}`.toLowerCase().includes(skillQ.toLowerCase())).slice(0, 30);
async function addSkill(s: { name: string }) {
  try {
    const r = await api<{ name: string; prompt: string }>('GET', `/api/skills/ecc/${encodeURIComponent(s.name)}`);
    addNode(() => ({ kind: 'agent', role: 'coder', title: r.name.slice(0, 24), prompt: r.prompt }));
  } catch (e) {
    notify.fail(e);
  }
}
// JSX, only when skills.length > 0:
// <h4>Skills</h4>
// <SearchField label="Find a skill" value={skillQ} onValueChange={setSkillQ} placeholder="ECC skills and commands" />
// {shown.map((s) => <button key={s.name} className="palette-item" title={s.description} onClick={() => void addSkill(s)}><span>{s.name}</span><small>{s.kind === 'command' ? 'ECC command' : 'ECC skill'} · {s.description}</small></button>)}
```

(`addNode` takes a `make` function returning a partial node, as the palette does.)

- [ ] **Step 3: Run tests**

Run: `npx vitest run --project web && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/Team.tsx web/src/Runs.tsx web/src/Builder.tsx web/src/styles.css web/src/Team.test.tsx web/src/Builder.test.tsx
git commit -m "web: plan shows why per bot and lets you swap one; ECC skills in the builder"
```

---

### Task 15: Whole-track verification

**Files:** none new (fixes only if a check fails).

- [ ] **Step 1: Full checks**

```bash
npx vitest run --project web
npm run typecheck
npm run build
npx vitest run --project node --no-file-parallelism
grep -rn "blobatar.dev" web/dist || echo "no blobatar.dev in bundle"
```

Expected: web all pass; typecheck clean; build OK; server suite failures limited to the known baseline (re-run any evolve/team/team-api failure alone; it must pass alone).

- [ ] **Step 2: Real ECC import (network)**

```bash
node dist/cli.js crew import ecc --yes --home "$(mktemp -d)"
```

Expected: about 72 agents added (some with `ecc-` prefixes for `planner`, `architect`, `code-architect` only if clashing), 311 skills, 98 commands; any skipped files listed with a reason. Record the counts in the commit message of any fix, or in the PR description.

- [ ] **Step 3: Manual check in Chrome**

Start `node dist/cli.js serve` against a home where ECC is imported and a Go repo workspace exists; check: Crew tab tabs/faces/import/update/remove, face sliders save; start a team run in a Go repo with the mock or a real agent and confirm the plan lists `why` per bot, the swap select offers the roster and the swap shows "swapped by you"; Builder skills search adds a step; canvas faces change mood as a run progresses.

- [ ] **Step 4: Commit any fixes and push**

```bash
git push -u origin feature/crew-track
```
