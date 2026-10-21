# Evolve (continuous harness improvement, after Harness²) — design

## Intent
Let bots get better with use. Borrow the *method* of Google Research's Harness² (propose–probe–compose over an agent's harness, plus a reflector that keeps evidence-backed lessons) while the model weights stay fixed. Native TypeScript on aorch's own runs, vault and bot definitions; no Python/Vertex dependency, works with every adapter. A later optional bridge to the real harness2 is possible once the proposal format exists.

Success: after runs accumulate, `aorch evolve <bot>` shows evidence-backed lessons and a proposed diff to that bot's harness; the user accepts, edits or rejects it; accepted changes are versioned and visible in later runs; rolling back is one command.

Decided with the user: "better" is judged by **run outcomes** and **user feedback**; improvements are **proposed and approved by the user** (no auto-apply in v1).

## Today (what exists)
Bot definitions with persona/title/kind (`src/bots.ts`, crew data), bindings of bots to agent/model (`src/bindings.ts`), skills (`src/skills.ts`), event-sourced runs with gates, reviewer verdicts, approvals, redo/amend events, cost and duration, the vault (`src/vault.ts`), supervisor (`src/supervisor.ts`).
Missing: a versioned per-bot harness, feedback capture, lessons, a proposal/approval flow, replay.

## 1. Bot harness (versioned)
Each bot gets `harness: { version, persona, guidance[], skills[] }` stored under `<home>/harness/<bot>/v<N>.json` with `current` pointer. Only guidance (short imperative notes added to the prompt), persona text and skill list are editable by Evolve. Permissions, limits, write access, bindings and tools are **not** editable. Version 1 is the bot's current definition. Each `node.started` records `harness: {bot, version}` so runs show what ran. `aorch harness <bot> [show|log|diff|rollback <v>]`.

## 2. Evidence
- **Outcome signals** derived from the event log per step: gate pass/fail, test results, reviewer verdict, redo count and `node.requeued`, handoff refusals/errors, user approval or rejection, cost and wall time vs the run median for similar steps.
- **Feedback**: thumbs up/down on a step's output (TUI `+`/`-`, dashboard buttons, chat "that was good/bad because …"), and user edits (diff between agent output/commit and the user's follow-up change) when available. Stored as `feedback` events (additive) with optional note.
- Both are keyed to `(run, node, bot, harness version)`.

## 3. Reflector (lessons)
After a run finishes, `reflect(run)` produces **lessons**: `{id, bot, text, evidence[{run,node,signal}], polarity, count}`. Rule-based extraction first (patterns such as "sent back twice for missing tests"), optional model pass to phrase and merge lessons. Lessons are written to the vault (`lessons/<bot>/…`) and merged by similarity; `count` and distinct runs raise confidence. A lesson with fewer than N (default 3) distinct supporting runs, or only one polarity-conflicting source, is kept as `tentative` and never proposed.

## 4. Propose
`aorch evolve <bot> [--since …]` collects confident lessons, then an editor agent (the user's configured Maestro/Boss binding) proposes a **small diff** to the harness: general edits and domain-specific edits (domain tagged by repo/workspace/language), each citing lesson ids. Constraints: ≤ 5 edits per proposal, no edit may exceed a size cap, no edit outside the editable fields; violations are dropped with a reason. Previously rejected edits (fingerprinted) are not re-proposed. A proposal is a `proposal` file, not yet a version.

## 5. Probe (optional, budgeted)
`--probe --budget $X [--tasks n]` replays up to `n` recent comparable tasks (read-only steps, or write steps in a throwaway worktree) through the current harness and each candidate. A judge compares outputs using the same outcome signals where computable (tests/gates re-run) and an LLM judge otherwise, with contrasts between runs rather than ground truth. Probe cost is capped by the budget and recorded; no budget, no probe. Candidates that don't beat the current harness are dropped.

## 6. Compose and approve
The composer merges surviving edits into one proposed version. The user sees the diff with evidence in the TUI (Evolve view), dashboard and chat, and accepts, edits or rejects each edit. Accepting writes `v<N+1>`, records `harness.adopted`, and notes it in the vault. Auto-accept is out of scope for v1; the proposal format leaves room for a policy field.

## 7. Surfaces
CLI: `aorch evolve`, `aorch lessons [bot]`, `aorch harness …`, `aorch feedback <run> <node> up|down [note]`. TUI: Crew tab shows harness version and pending proposals; evolve view with diff and evidence. Dashboard: Crew screen proposals and lessons. Maestro can say "bolt keeps missing tests" and offer to run evolve.

## 8. Safety
Editable surface is limited (above). Probes cost money: explicit budget required. Lessons and feedback text are data and fenced when put in prompts. Rollback is always available. Edits never touch other bots. Stored feedback and lessons are local only (`<home>`, vault).

## 9. Testing
Pure functions for signal extraction, lesson merging/confidence, proposal validation (caps, forbidden fields, rejected fingerprints), harness versioning/rollback; mock-adapter smoke: synthetic runs → lessons → proposal → accept → next run records the new version; probe test with the mock judge and budget exhaustion.

## Out of scope (v1)
Auto-apply, cross-user sharing of lessons, the real harness2 bridge, editing tools/plugins/scripts, benchmark suites.
