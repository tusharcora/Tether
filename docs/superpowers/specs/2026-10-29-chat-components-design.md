# Chat and agent-work components: design

Date: 2026-10-29 · Branch: `feature/chat-components` (from main c51bb1f) · Mockup (approved, "write the spec and build it"): https://claude.ai/artifact/UMzU5xrg3MtHZhSVY66PGw (boards copied to `docs/design/chat-components/*.dc.html`)

## 1. Intent

Make Tether's agent work visible and alive, the way the owner's references show it (Phil Pitus: thinking process, context window, merge conflicts; Juliette: agent work components; used as visual reference only, no code copied): show what the agent is doing instead of a spinner, how full the context is, what it led to, and where every agent stands. All in Tether's palette (blue = live, green = done, amber = needs you, red = failed; no pink/purple).

## 2. Goals (this branch, phase A)

1. **Thinking timeline** in every Tether chat answer (⌘J mini chat, full-screen chat, All chats preview) replacing the collapsed "▸ Looked at … · N calls" line (board 1).
2. **Context window** ring in the chat composer with its popover and **Compact now** (board 2).
3. **Agent work**: a live **plan card** for runs, an **agents running** card, and shared building blocks (step track, tags, status, tool chips) (board 4), used where runs and agents already show.

Phase B (separate, after Teams Phase 1 lands on main): the **PR + merge-conflict card** (board 3), built on Teams' push/open-PR/merge code. Not in this branch.

## 3. Non-goals

- Inventing data: no fake branches, dead ends, test counts or token splits; when something is an estimate it says "about".
- Model reasoning text ("thinking tokens") display; the timeline is built from the steps Tether sees (tool calls, reads, runs).
- New dependencies.

## 4. Anti-goals

- A decorative dashboard; every element shows real data.
- Losing messages when compacting (originals are kept and Undo restores them).
- Motion that ignores `prefers-reduced-motion`.

## 5. What exists (reuse)

- Assistant chat: `src/assistant/turn.ts` (streams `tool` events: `ToolRun {id, code, output?, isError?, ms?}`, cites), `web/src/assistant/Thread.tsx`, `cards.tsx`, `Chat.tsx` / `ChatComposer`, `AIComposer` (AI Elements model selector), chats storage `src/assistant/history.ts` (per-chat files, 200-message cap).
- Adapters report usage: `claude.ts` (`usage.inputTokens/outputTokens`, `toolCalls`), `openai.ts` (prompt/completion tokens). Model context sizes: OpenRouter `/models` `context`, NVIDIA unknown, Claude models known.
- Free limits: OpenRouter free-request counter route; NVIDIA ~40/min note.
- Runs: engine node events/status (planner, coder, gate, approval nodes), Home "Running" section, team "Working now" (Teams branch), Goals loop/action nodes, `StatusBadge`, beui kit, faces.

## 6. Design

### 6.1 Thinking timeline (board 1)

- Built from the turn's stream: each tool call becomes a step with a short human label derived from what it did (e.g. "Searched the codebase", "Read 6 files about chats and routes", "Ran 12 assistant tests", "Opened run R-7D92"); files/runs/notes it touched become **chips** (type mark, name, "+N more"); a tool call that errored or was refused becomes a **dead end** step (dimmed, ✕, indented); consecutive calls of the same kind collapse into one step with a count.
- Header: "Thinking Ns" with a live timer while streaming; when the answer finishes: "Thought for Ns" (collapsed by default after finishing, click to expand) and a final **Finished thinking** row with a short summary (calls · files · runs).
- The current step shows a spinner and shimmering label. Steps animate in. Reduced motion: no shimmer/animation.
- Saved with the message (so reopening a chat shows the finished timeline).
- Labels: derived deterministically from the tool call (Code Mode script → which connectors/functions it used; reads/searches; run lookups). No extra model call. A helper maps a ToolRun to `{kind, label, chips}` and is unit-tested.

### 6.2 Context window (board 2)

- A ring button in `AIComposer` (beside dictate) showing % used; click opens the popover:
  - **Context N% · Xk of Yk · <model>**: Y = the answering model's context size (known for Claude models and OpenRouter; NVIDIA/unknown: "size unknown", ring hidden).
  - Segmented bar + legend: **Tether's prompt, Tools, Memory, Messages, Reserved (reply), Free**; hover a part → breakdown (e.g. Tools: run_code, MCP servers by name, Code Mode notes). Sizes: from the last turn's real input-token count when the adapter reports it, split across parts by measured character share; otherwise an estimate (chars/4) marked "about".
  - **Limits** rows that apply to the current model: OpenRouter free requests (used/limit, reset time), NVIDIA "about 40 a minute".
  - **Compact now**: one model call summarizes older messages into a summary message; the chat keeps the summary + the last few messages for future turns; the original messages stay in the chat file (marked compacted) and are shown collapsed ("38 earlier messages summarized · Show"); **Undo** restores. Auto-compact: when a turn would exceed ~90% of the context, compact first and say so in the thread. Footer shows "Xk until auto-compact" / "Summarizing older messages…" / "Compacted …".

### 6.3 Agent work (board 4)

- **Building blocks** (one small set, reused): `StepTrack` (done ✓ green, current pulsing blue, pending grey, approval gate amber ◆), `Tag` (Trigger red, Agent blue, Asks first amber), `Status` (Running pulsing blue, Done green ✓, Waiting dashed grey, Failed red), `ToolChip` (tool/connector name with mark).
- **Plan card** for a run: the run's steps in order (from its pipeline/nodes) with time per finished step, the current step with live sub-steps (its latest events, newest highlighted), pending steps dimmed, approval/gate steps shown as **Asks first**; cost so far / limit in the header. Used: in chat when a proposal's run starts (the card replaces the plain "started" line and stays live), on the run page above the graph (compact), and for a Goal's current run.
- **Agents running** card: "N agents running · Stop all": one row per active run/agent with face, task, current activity, rough time left when Tether can estimate it (else omit), spinner; finished-awaiting rows show "Ready to review" + **Review** (opens the run/approval); **Stop all** stops the listed runs (confirm). Used: Home's **Running** section (replaces the plain list when ≥1 run is live) and the mini chat empty state.

### 6.4 Phase B: PR + merge conflicts (board 3), for later

PR card with commit lanes, branch tags, pushing/opening states, conflicts with highlighted commits and a Resolve action (an agent run merging main into the branch), checks chips from GitHub, Ready to merge + Merge (approver rules), Merged; a status chip above the composer. Built on Teams' ship/merge code after it lands on main.

## 7. Constraints

- Match the boards and the app's look (Studio Live tokens, beui kit + Tailwind where the assistant already uses it, faces, existing action nodes).
- Everything accessible: real buttons, labels, `aria-live` for the timer/current step (polite), reduced motion.
- Tests: ToolRun → step mapping, timeline states (streaming, finished, error → dead end, collapsing repeats), context math (sizes, estimate vs reported, unknown size), compaction (summary stored, originals kept, Undo, auto-compact threshold), plan card from run fixtures (done/current/pending/gate), agents running (Stop all, Review), building blocks render.

## 8. Decided by the owner

- Build these components wherever they fit; references are the four @pitus_ posts and the @shedsgns post; boards 1–4 approved.

## 9. Left to the builder

- Exact label wording rules, step grouping thresholds, how many messages compaction keeps, auto-compact threshold (~90%), poll intervals.

## 10. My calls (owner: check)

- PR card is phase B after Teams Phase 1 (avoids building ship/merge twice).
- Thinking steps come from tool calls, not model reasoning; no invented branches.
- Token parts are split by measured share of the real input count when reported, else estimated and labelled "about".
- Compaction keeps originals and is undoable; one model call per compaction.
- Agents running card replaces Home's Running list when something is live.
