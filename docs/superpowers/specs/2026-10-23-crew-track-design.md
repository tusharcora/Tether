# Crew track: Blobatar faces, ECC library, Maestro role routing — design

## Intent
Give every bot a unique generated face, give the crew a wide range of ready-made specialist agents, skills and commands from ECC (github.com/affaan-m/ECC, "Everything Claude Code", MIT), and let Maestro choose the right specialists for each task and say why.

Success: after `aorch crew import ecc`, the Crew tab shows about 80 bots, each with its own Blobatar face. A team run in a Go repo gets a plan where Maestro picked, say, `planner → coder → go-reviewer → security-reviewer` with a one-line reason each, and you can swap any of them before approving. ECC skills run from the skills list on any agent CLI. Nothing calls blobatar.dev, and nothing from ECC changes your Claude Code setup.

Decided with the user: Blobatar replaces the pixel looks in the web dashboard (the terminal header face stays). Import ECC agents, skills and commands; not hooks or rules. This track comes before the workbench and after the React + Arc migration (`2026-10-23-web-react-arc-design.md`), so its web UI is React + Arc.

## Today
- Crew registry: bots are JSON in `<home>/crew/<id>.json` (`BotDef`: id, name, title, kind, persona, readOnly, look); eight built-ins (`src/crew.ts`), editable as overrides. A custom bot's persona becomes its step instructions. `BOT_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/`.
- Web draws a bot as a pixel sprite or a "mark", depending on the crew style (`web/src/bots.tsx`).
- Maestro sees: in team planning `- id: title` (`team.ts planningPrompt`); in `orchestrate` built-in step types plus custom bots cut to 140 chars (`composer.ts crewLines`). `TeamPlan.assignments: {bot, goal, expected?, mode}`.
- Skills: `src/skills.ts`, `Skill.source: 'claude' | 'project' | 'aorch'`, `MAX_SKILLS = 200`. Claude Code skills run by telling a Claude step to invoke them by name.

## 1. Faces (Blobatar)
- `blobatar@2.7.0` and `@blobatar/react` (MIT, no dependencies, no network calls) are bundled into the web build. The hosted `blobatar.dev/avatar/...` API is never used.
- `<Face bot mood size>` (from the migration) now renders `<Blobatar name={bot.id} normalize={false} …>`; the seed is the bot id. Blobatar only changes faces on a major version (its ADR-0008), so both packages are pinned to exact 2.x versions and a snapshot test catches any change. Static faces render as `<img>` (cheap in long lists); `animate` switches to inline SVG. It is wrapped in Arc's Avatar for size, ring and status dot.
- Mood → expression: idle → `idle`, working → `thinking` (animate `always`), done → `happy`, failed → `sad`, waiting for you → `unsure`, asleep → `sleepy`, stopped → `mad`. Hover animates in lists.
- `Look` gains optional `face?: { hue?: number; tone?: number; traits?: Record<string, number> }`, edited in the Crew tab bot editor (Arc Sliders, live preview, "reset to generated"). Old pixel fields stay valid on disk and are ignored by the web. The crew-style picker is removed from the web; the TUI is unchanged.
- Tests: mood → expression map; `Face` renders the same output twice for the same id and a snapshot of three built-in bots' SVG strings (`blobatar(id)`) stays fixed; built web bundle contains no `blobatar.dev` URL.

## 2. ECC library
### Import
- `aorch crew import ecc [--ref v2.2.3]` runs `git clone --depth 1 --branch <ref> https://github.com/affaan-m/ECC <home>/vendor/ecc` (default ref pinned in code). Only the user runs it; nothing fetches automatically. `--update [--ref]` fetches a new ref and prints added / changed / removed agents and skills before writing. `aorch crew remove --source ecc` deletes everything imported and the vendor folder.
- Also in the web Crew tab: an "Import ECC" button (Dialog showing the ref and counts, then progress) calling `POST /api/crew/import` with `{ source: 'ecc', ref }`.
- Parsing reads only `agents/*.md`, `skills/*/SKILL.md`, `commands/*.md` and the "Available Agents" / "Agent Orchestration" sections of `AGENTS.md`. Frontmatter via the existing `parseFrontmatter`, extended for `tools`, `model`, `argument-hint`. Files that fail to parse are skipped and listed.

### Agents → bots
`BotDef` gains `source?: string` (e.g. `ecc@v2.2.3`), `whenToUse?: string`, `modelHint?: 'opus' | 'sonnet'`.
- id: the agent `name`; if it clashes with a built-in or an existing non-ECC bot, `ecc-<name>` (e.g. `ecc-planner`). If still invalid for `BOT_ID_RE`, it is shortened and the import reports it. Re-import updates bots with the same `source` prefix and never touches others.
- persona: the agent body (the prompt). whenToUse: `description` cut to 300 chars. title: the name in words ("go reviewer").
- kind: `*-reviewer` → `verdict` (aorch appends its own `VERDICT: PASS|FAIL` instruction); else `agent`. readOnly: `tools` does not include Write, Edit or MultiEdit.
- modelHint is used only when the bot runs on the claude adapter and its bot link sets no model.
- Persona trust: same as a custom bot the user wrote, since the user chose to import; the body is fenced as role instructions as custom personas are today.

### Skills and commands
- `Skill.source` gains `'ecc'`; `Skill` gains `kind?: 'skill' | 'command'` and `path`. ECC skills and commands are listed from `<home>/vendor/ecc` and do not count against `MAX_SKILLS` (their own cap: 600).
- They run on any adapter: the step prompt gets the SKILL.md or command body as fenced instructions, plus the task as the argument, instead of relying on Claude Code's skill lookup.
- TUI skills list and `aorch skills` show the source; filter with `aorch skills --source ecc` and `/` search. Web: a searchable skills Select in the Builder "add step" menu.

### Not imported
Hooks and rule packs: Claude Code specific and they would change agent behaviour outside aorch.

## 3. Maestro role routing
- New `src/roster.ts`: `buildRoster({ workspace, task, crew }): RosterEntry[]` and `rosterText(entries)`, used by team planning, `orchestrate` (`composer.ts`) and manager handoffs. A line is `id (kind[, read-only]) — whenToUse`, cut to 100 chars; built-ins use their persona when they have no `whenToUse`.
- Workspace filter: languages detected from files in the repo (go.mod → go; package.json + .ts/.tsx → typescript, react if `react` is a dependency; pyproject/requirements → python, django/fastapi by dependency; Cargo.toml → rust; pom.xml/build.gradle → java/kotlin; Package.swift → swift; etc.). Bots named `<lang>-reviewer`, `<lang>-build-resolver` (and ECC domain bots tagged in a small map) are included only when their language matches. Built-ins are always included. Cap 40 entries; when over, keep built-ins, language matches, then general ECC bots in `AGENTS.md` table order.
- Routing hints: the "Agent Orchestration" rules from ECC's `AGENTS.md`, rewritten to roster ids that exist, appended as a short block (max 12 lines). Only present when ECC is imported.
- Plan: `TeamPlan.assignments[]` gains `why: string` (max 160 chars, required for new plans, absent in old events). Validation rejects bots not in the roster.
- Swap: before approval, each assignment has a bot picker (web: Arc Select with faces and whenToUse; TUI: `s` on an assignment) limited to the roster. A swap is recorded as a `plan.edit` event (additive) and Maestro's `why` is kept with "swapped by you". The manager may hand off only to bots in the approved plan (unchanged).
- `orchestrate`: the allowed step list includes roster bots; the reply's `rationale` becomes per-step `why`.

## 4. API and events
- `GET /api/crew` adds `source`, `whenToUse`, `face`. `POST /api/crew/import` (loopback, Origin-checked like every write), `DELETE /api/crew?source=ecc`.
- New `GET /api/skills?source=` lists skills with source and kind (the web has no skills endpoint today).
- Events: `plan.edit {assignment, from, to}` additive; old logs fold unchanged.

## 5. Errors
- Import: no `git` or no network → clear message, nothing written; partial parse → imported what parsed, lists skipped files; an id clash with a user bot → `ecc-` prefix and a note.
- Roster: no workspace → no language filter, cap still applies.
- Plan with an unknown bot or missing `why` → existing invalid-plan retry path.

## 6. Testing
- Fixture `test/fixtures/ecc/` with a few real agent, skill and command files and an `AGENTS.md` excerpt (MIT notice kept).
- Unit: frontmatter → bot mapping (kind, readOnly, clash prefix, id length), re-import update and remove-by-source, skill/command listing and prompt assembly, language detection, roster filter and cap order, routing hints with only existing ids, plan `why` validation, `plan.edit` fold.
- Web smoke tests: Crew tab with imported bots and faces; plan card swap calls the endpoint.
- Manual: import ECC for real, start a team run in a Go and a TypeScript repo, check the roster and reasons, swap one bot, run to completion with the mock adapter.
