# Chat and agent-work components (phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thinking timeline in every Tether answer, a context ring with Compact now / auto-compact in the composer, and live agent-work cards (plan card, agents running, shared building blocks) where runs already show.

**Architecture:** Server: one pure, shared module (`src/assistant/context.ts`) does the context math for both sides; each turn saves what it sent (characters per part, the agent's reported prompt tokens, model size) on the reply; `compact.ts` folds older messages into a summary message with one model call and keeps the originals (marked) so Undo restores them. Web: the timeline is derived from the saved `ToolRun`s by a pure mapper; the plan card is derived from a `RunView` by a pure model; the cards reuse StatusBadge, Face, ConfirmButton, usePoll, beui's MorphPopover and the Studio tokens.

**Tech Stack:** TypeScript, Node http server, React 19, vitest (node + jsdom), Tailwind v4 in `web/src/assistant`, Studio CSS (`parts.css`, `home.css`, `runs.css`) elsewhere.

**Spec:** `docs/superpowers/specs/2026-10-29-chat-components-design.md` (boards: `docs/design/chat-components/{Main,Context,AgentWork}.dc.html`). §6.4 PR card is phase B and not in this plan.

## Global Constraints

- Palette: blue = live, green = done, amber = needs you, red = failed; no pink or purple.
- No invented data: estimates say "about"; no ETA unless Tether can estimate one (it cannot yet: omit).
- No new dependencies. Never touch `~/.aorch`. No money spent (mock adapter only).
- Accessibility: real buttons, `aria-live="polite"` for the current step, `prefers-reduced-motion` turns off shimmer/spin/pulse/entry animation.
- Compaction keeps the original messages (marked `compactedBy`) and Undo restores them. One model call per compaction.
- Comments: one-line whys; `// shortcut: <limit>, <when to upgrade>` for known limits. Commits: plain conventional messages, no trailers.
- Tailwind classes only under `web/src/assistant` and `web/src/components/*` (tw.css scans only those); Studio CSS classes elsewhere.

## Review Focus

- A turn that errors or is stopped mid-script: the timeline keeps the finished steps, the unfinished one is not left spinning (Task 5 test: `live` only while streaming).
- A chat saved before this branch (no `context` record, no `compact`): no ring, no crash, Compact now disabled (Task 7 test).
- Compaction failing (agent down, empty output): nothing is marked compacted, the chat file is unchanged, the person sees the error (Task 4 test).
- Undo after more turns happened since the compaction: originals come back, newer messages stay (Task 4 test).
- Stop all when one stop request fails (run not live in this server): the others still stop, the failure is reported (Task 10 test).

---

### Task 1: Shared context math

**Files:**
- Create: `src/assistant/context.ts`
- Modify: `src/assistant/types.ts` (ContextUse, ChatMessage fields, StreamEvent `compacted`)
- Test: `test/assistant-context.test.ts`

**Interfaces:**
- Produces (types.ts):
  - `interface ContextUse { parts: Record<'prompt'|'tools'|'memory'|'messages', [string, number][]>; tokens?: number; about?: true; agent: string; model?: string; size?: number; limit?: 'openrouter' | 'nvidia' }` (parts in characters; `tokens` = the agent's reported input tokens of the turn's first model call; `about` = tokens is Tether's estimate).
  - `ChatMessage` gains `context?: ContextUse`, `compact?: { count: number; auto?: true }`, `compactedBy?: string`.
  - `StreamEvent` gains `{ type: 'compacted'; messages: ChatMessage[] }`.
- Produces (context.ts): `RESERVED = 8000`, `AUTO_COMPACT = 0.9`, `KEEP = 4`, `MIN_FOLD = 2`, `estimate(chars): number` (= ceil(chars/4)), `knownSize(agent, model?): number | undefined` (claude: 200k, `[1m]` model: 1M), `contextView(u): ContextView | undefined`, `overflows(u, extraChars): boolean`, `foldable(messages): ChatMessage[]`, `latestContext(messages): { use: ContextUse; summary: boolean } | undefined`, `PART_LABEL`.
  - `ContextView = { parts: { key; label; tokens; items: [string, number][] }[]; used; size; pct; about; untilAuto }` with keys prompt, tools, memory, messages, reserved, free in that order.

- [ ] **Step 1: Write the failing tests**: `contextView` estimate path (tokens = ceil(chars/4), about true, reserved 8000, free = size − used, pct rounded); reported path where tokens ≥ estimate (difference becomes a Tools item "Agent's own prompt and tools", about false); reported path where tokens < estimate (items scaled down proportionally, sum equals tokens); unknown size → undefined; `untilAuto` = round(0.9·size) − used, never negative; `overflows` true just over 90% and false just under; `foldable` returns non-compacted messages before the last 4 and nothing for ≤4; `latestContext` picks the newest message with a record and says whether it is a summary; `knownSize('claude','opus')` 200000, `knownSize('claude','sonnet[1m]')` 1000000, `knownSize('mock')` undefined.
- [ ] **Step 2: Run** `npx vitest run test/assistant-context.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the types and `context.ts` (pure, no node imports: the web imports it).
- [ ] **Step 4: Run** the test → PASS. `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(assistant): context window math shared by the server and the dashboard`

### Task 2: Adapters report the prompt's tokens

**Files:**
- Modify: `src/types.ts` (`AgentUsage.promptTokens?: number` — input tokens of the call's first model request), `src/adapters/claude.ts` (first `assistant` event's `message.usage`: input + cache creation + cache read), `src/adapters/openai.ts` (first turn's `prompt_tokens`)
- Test: existing `test/` claude parse tests and `test/openrouter-adapter.test.ts` (or the openai adapter test file that fakes `/chat/completions`)

- [ ] **Step 1: Failing tests**: `parseClaudeLine` on two assistant lines with usage `{input_tokens: 10, cache_read_input_tokens: 1000}` then `{input_tokens: 50, ...}` sets `acc.usage.promptTokens` to 1010 and the result line keeps it; openai adapter with a two-turn fake (prompt_tokens 1200 then 1900) returns `usage.promptTokens === 1200`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (claude: keep `promptTokens` when the result line rewrites `acc.usage`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(adapters): report the tokens of a call's first request`

### Task 3: Each turn records what it sent

**Files:**
- Modify: `src/assistant/prompt.ts` (export `promptParts(i: PromptInput, text: string)`; history window skips `compactedBy` and `compact` messages; `summary` of the latest live summary message goes before "Conversation so far"), `src/assistant/turn.ts` (`AssistantCtx.modelInfo?(agent, model?): Promise<{ size?: number; limit?: 'openrouter' | 'nvidia' }>`; build `context` on the saved reply), `src/server.ts` (modelInfo: knownSize, OpenRouter models' `context`, OpenRouter `:free` → limit 'openrouter', endpoint host ending in `nvidia.com` → 'nvidia')
- Test: `test/assistant.test.ts`

**Interfaces:**
- Produces: `promptParts(i, text): ContextUse['parts']` minus tools — `{ prompt: [["Who Tether is", n], ["Project, page and runs", n]], memory: [["Notes from the graph", n]], messages: [[`${k} earlier messages`, n], ["Summary", n], ["This message", n], [`${k} attached files`, n]] }` (zero items dropped). Tools part (in turn.ts): `[["run_code", description minus connector lines], [<connector name>, line length]…, ["Code Mode notes", CODE_MODE_NOTE.length]]`.

- [ ] **Step 1: Failing test**: a turn with the Scripted agent (reports `usage.promptTokens: 4321`, ctx.modelInfo → `{ size: 200000 }`) saves `done.message.context` with `tokens 4321`, `size 200000`, `agent 'scripted'`, messages part containing "This message", tools part containing `run_code` and `Code Mode notes`; without usage the record has no `tokens`; prompt parts sum ≤ prompt length.
- [ ] **Step 2: Run** `npx vitest run test/assistant.test.ts` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `feat(assistant): save each turn's context use on the reply`

### Task 4: Compaction, Undo, auto-compact

**Files:**
- Create: `src/assistant/compact.ts`
- Modify: `src/assistant/turn.ts` (auto-compact before the prompt when `overflows(latest, message + attachments)`: compact with `auto`, save, emit `compacted`; a failure leaves the turn going on uncompacted), `src/assistant/routes.ts` (`POST /api/assistant/compact { ws, chat, undo? }` → `{ messages }`; 409 "nothing to compact yet" when fewer than MIN_FOLD; 502 with the agent's error), `src/assistant/summary.ts` (summary messages are not replies)
- Test: `test/assistant.test.ts`

**Interfaces:**
- Produces: `compactChat(c: AssistantCtx, chat: Chat, o: { agent: string; model?: string; auto?: boolean; signal: AbortSignal }): Promise<ChatMessage>` — folds `foldable(chat.messages)` (throws when < MIN_FOLD), one `run()` with nodeId `chat.compact`, readOnly, lean, no Code Mode, in a scratch dir; summary text ≤ 4000 chars; inserts the summary message `{ role: 'tether', text, compact: { count, auto? }, context }` right after the last folded message and sets `compactedBy` on the folded ones; mutates `chat` (caller saves). The summary's `context` is the latest record with its messages part re-measured and `tokens` shifted by the estimated difference, `about: true`.
- Produces: `undoCompact(chat: Chat): boolean` — removes the newest live summary message and clears `compactedBy` that points at it.
- Agent for a compaction: the latest record's agent/model, else Tether's binding.

- [ ] **Step 1: Failing tests**: (a) 10-message chat → POST compact → 6 messages carry `compactedBy`, a summary message with `compact.count 6` sits before the last 4, the file still has all 10 originals, the next turn's prompt has "Summary of the earlier conversation" and none of the folded texts; (b) undo after one more turn restores all, keeps the new turn, removes the summary; (c) agent failing → 502, file unchanged; (d) 3-message chat → 409; (e) auto: a chat whose latest record is at 95% of `size` runs a compaction before the turn, the stream has a `compacted` event, the summary has `auto: true`; at 50% no compaction.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**. Prompt: "Summarize this conversation between the person and Tether so it can go on without it. Keep decisions, facts, file paths, run ids and open questions. Plain prose, at most 200 words." + transcript (each message cut at 2000 chars, total cut at 60k: `// shortcut:` comment).
- [ ] **Step 4: Run** → PASS; run `test/assistant-history.test.ts test/assistant-summary.test.ts` too.
- [ ] **Step 5: Commit** `feat(assistant): compact a chat into a summary, keep the originals, undo and auto-compact`

### Task 5: Building blocks

**Files:**
- Modify: `web/src/ui/studio/steps.ts` (`StepLike.kind?`; queued approval → `gate`), `web/src/ui/studio/StepTrack.tsx` (board look: dots joined by lines; done ✓ green, working pulsing blue, waiting amber, gate amber ◆ outline, queued grey, failed red, skipped hairline), `web/src/ui/studio/parts.css`
- Create: `web/src/ui/studio/Tag.tsx` (`Tag({ tone: 'trigger' | 'agent' | 'asks'; children })`: red / blue / amber soft pill), `web/src/ui/studio/ToolChip.tsx` (`ToolChip({ label; mark?: string; title?: string })`: chip with a small mark)
- Test: `web/src/ui/studio/StepTrack.test.tsx`, `steps` tests, new `web/src/ui/studio/blocks.test.tsx`
- Status: the existing `StatusBadge` is the Status block (no new component).

- [ ] **Step 1: Failing tests**: segmentsFor marks a queued approval step `gate` and an approval that is awaiting `waiting`; StepTrack renders one `.sl-dot` per step with `s-gate`, keeps `role="img"` + the label; Tag renders text with `data-tone`; ToolChip renders mark and label.
- [ ] **Step 2: Run** `npx vitest run web/src/ui/studio` → FAIL.
- [ ] **Step 3: Implement**; reduced motion stops the pulse.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): step track, tag and tool chip building blocks`

### Task 6: Thinking timeline

**Files:**
- Create: `web/src/assistant/timeline.ts`, `web/src/assistant/Thinking.tsx`
- Modify: `web/src/assistant/Thread.tsx` (Thinking replaces `Tools` for saved and live replies), `web/src/assistant/useAssistant.ts` (`Streaming.startedAt: number`), `web/src/assistant/assistant.css` (shimmer/spin/in keyframes + reduced motion)
- Test: `web/src/assistant/timeline.test.ts`, `web/src/assistant/Thinking.test.tsx`

**Interfaces:**
- Produces: `type Chip = { kind: 'file' | 'run' | 'note' | 'tool'; label: string }`; `interface Step { id; kind: StepKind; label; chips: Chip[]; calls: number; dead?: true; live?: true }`; `stepOf(t: ToolRun): Step`; `timeline(tools: ToolRun[], streaming: boolean): Step[]`; `thinkingSummary(tools): string`.
- Labels (deterministic, from the script's literal connector calls): `tether.runs.get('X')` → "Opened run X" / "Opened N runs"; `repo.read` → "Read N files" (unknown args: "Read files"); `repo.search('p')` → `Searched the codebase for "p"` (merged: "Searched the codebase N times"); `repo.list` → "Looked through the folders"; `repo.diff` → "Looked at the uncommitted changes"; `tether.runs.list` → "Listed recent runs"; `tether.vault.search/read` → "Searched the notes" / "Read N notes"; `github.*` → "Checked GitHub"; `http.*` → "Called a web API"; `mcp.<s>.*` → "Used <s>"; `codemode.*` only → "Looked up the tools"; none → "Ran a script". Errored → dead end "Dead end: <first sentence of the error>". Consecutive same-kind, non-dead steps merge (calls summed, chips deduped).
- Summary: "N calls · N files · N runs · N notes" without zero parts.

- [ ] **Step 1: Failing tests**: each label rule; chips (`file` turn.ts, `run` R-7D92, tool GitHub); dead end from `isError`; merge of 3 reads into "Read 4 files" with calls 3; dead step breaks a merge; `live` only on the last step with no output while streaming, never when not streaming; summary line. Thinking: streaming shows "Thinking" + seconds and the steps, current step in an `aria-live="polite"` list; finished shows "Thought for 14s" collapsed, click expands, "Finished thinking" row with the summary.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; finished time = reply `at` − the previous "you" message's `at`.
- [ ] **Step 4: Run** `npx vitest run web/src/assistant` → PASS.
- [ ] **Step 5: Commit** `feat(web): thinking timeline in Tether's answers`

### Task 7: Context ring, popover, Compact now

**Files:**
- Create: `web/src/assistant/ContextRing.tsx`
- Modify: `web/src/components/composer/AIComposer.tsx` (`extra?: ReactNode` before Record), `web/src/assistant/Chat.tsx` (ChatComposer passes the ring), `web/src/assistant/useAssistant.ts` (`compacting: boolean`, `compact(undo?: boolean): Promise<void>`, `compacted` stream event replaces the messages), `web/src/assistant/api.ts` (`compact`), `web/src/assistant/Thread.tsx` (summary row: "N earlier messages summarized" / auto: "Tether summarized N earlier messages to make room", Show/Hide originals, Undo on the newest summary; compacted messages hidden until shown)
- Test: `web/src/assistant/ContextRing.test.tsx`, `web/src/assistant/Thread`-level test in `Chat.test.tsx` or `Assistant.test.tsx`

- [ ] **Step 1: Failing tests**: no record or no size → no ring; ring button `aria-label="Context 23% used"`; popover shows "Context 23%", "about" when estimated, the six legend rows, focusing/hovering Tools shows its items; OpenRouter limit row from `GET /api/accounts/openrouter/allowance` ("32 of 50", "resets 20:00"); NVIDIA row "about 40 a minute"; footer "Nk until auto-compact" + Compact now calls `compact()`; disabled with fewer than MIN_FOLD foldable; while compacting "Summarizing older messages…"; latest record from a summary → "Compacted: N messages → summary + last 4" + Undo calls `compact(true)`. Thread: compacted messages hidden, Show reveals them, Undo button present on the newest summary only.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with beui `MorphPopover`; bar colours sky/emerald/amber/blue/zinc (board).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): context ring with compact now and undo`

### Task 8: Plan card

**Files:**
- Create: `web/src/runs/planModel.ts`, `web/src/runs/PlanCard.tsx` (`PlanCard({ run, compact? })`, `LivePlan({ runId, onGo })` polling `/api/runs/:id` every 2.5 s until the run ends)
- Modify: `web/src/assistant/cards.tsx` (LiveRunSteps → LivePlan), `web/src/runs/RunPage.tsx` (compact card above the graph), `web/src/goals/LoopFlow.tsx` (in-flight run node shows LivePlan), `web/src/runs/runs.css`
- Test: `web/src/runs/planModel.test.ts`, `web/src/runs/PlanCard.test.tsx`

**Interfaces:**
- Produces: `type PlanState = 'done' | 'live' | 'waiting' | 'gate' | 'todo' | 'failed' | 'skipped'`; `interface PlanRow { id; title; state: PlanState; right?: string; subs: { text: string; newest: boolean }[] }`; `planRows(r: RunView): PlanRow[]`; `costLine(r: RunView): string` ("$1.40 of $5.00" with `settings.maxCostUsd` or `team.budgetUsd`, else "$1.40").
- Row rules: done → `fmtDur(finishedAt − startedAt)`; running → badge verb ("Writing", "Testing", "Reading", "Retrying") and subs = `recent(node.live, 3)` (src/activity.ts), newest flagged; awaiting → "Needs you"; queued approval → gate "Asks first" (Tag); queued → todo; error → "Failed"; skipped → "Skipped".

- [ ] **Step 1: Failing tests** from `makeRun` fixtures: done/live/todo/gate rows in pipeline order with durations; live subs newest last; awaiting approval; cost line with and without a cap; team run still planning → card says "Tether is planning…"; compact card shows a StepTrack and the live step's newest sub-step.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; update `cards` and RunPage tests that looked for the old steps list.
- [ ] **Step 4: Run** `npx vitest run web/src/runs web/src/assistant web/src/goals` → PASS.
- [ ] **Step 5: Commit** `feat(web): live plan card for runs in chat, the run page and goals`

### Task 9: Agents running card

**Files:**
- Create: `web/src/home/AgentsRunning.tsx` (`AgentsRunning({ rows: RunRow[]; onGo; onChanged? })`, `RunningNow({ onGo })` polling `/api/runs`)
- Modify: `web/src/home/Running.tsx` (the card replaces the list when ≥1 run is live), `web/src/assistant/Chat.tsx` + `Assistant.tsx` (mini chat empty state shows RunningNow), `web/src/home/home.css`
- Test: `web/src/home/Running.test.tsx`, new `web/src/home/AgentsRunning.test.tsx`

- [ ] **Step 1: Failing tests**: header "2 agents running"; a working row has the face, the task and `nowLine`, no ETA text; a waiting row says "Ready to review" and Review goes to `{ tab: 'runs', id }`; Stop all asks first ("Stop 2 runs?"), then POSTs `/api/runs/<id>/stop` for each; one 409 still stops the other and reports the failure; Running with no live run says "Nothing running."
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with Face, ConfirmButton, useNotify.
- [ ] **Step 4: Run** `npx vitest run web/src/home web/src/assistant` → PASS.
- [ ] **Step 5: Commit** `feat(web): agents running card on Home and in the mini chat`

### Task 10: Real check, full verification, push

- [ ] `npm run typecheck`, `npm test` (baseline: 3 triggers tests fail on macOS /private/var; evolve/handoff/local/runchat/accounts/crew-cli/team may time out under load: rerun alone), `npm run build`.
- [ ] Temp home: `node dist/cli.js serve --home <tmp> --port <free>`, `node dist/cli.js workspace add <scratch repo> --home <tmp>`, link orchestrator to `mock`; send a message, look at the thinking header and a saved chat with tools (written into the temp home), the ring on a chat whose record has a size, Home Running with a live mock run, a run page.
- [ ] `git push`; write `.superpowers/tether/chat-components-report.md` (untracked).
