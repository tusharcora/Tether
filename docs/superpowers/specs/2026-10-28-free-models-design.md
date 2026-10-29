# Free models via OpenRouter: design

Date: 2026-10-28 · Branch: `feature/free-models` (from main `cd94845`) · Mockup (approved): https://claude.ai/artifact/BpJa3QcyWiQDwfKXRb5rT4 (source `~/Documents/PROJECTS/.mockups/free-models/project/*.dc.html`)

## 1. Intent

Anyone who downloads Tether should be able to do real work in it **without paying anyone**, using OpenRouter's free models (for example `nvidia/nemotron-3.5-super-vl:free`). They may be slower or weaker than paid models, and the app is honest about that. Setup must not send the person off to find and paste an API key: one click, one browser approval, done.

This is project 1 of the owner's roadmap (then: Hermes-style ideas, Tether as the main agent for web/images/voice/browser, Teams, non-LLM models in workflows). "Omnirouter" in the owner's request means OpenRouter.

## 2. Goals

1. **Connect OpenRouter** with one click: OAuth PKCE in the system browser, the key lands in the secret store (macOS Keychain), never shown or pasted.
2. **Free models work out of the box** after connecting: crew bots and the ⌘J assistant get a free default model.
3. **Free models are visible as free**: tagged in the model picker, with a "Free only" filter, and with tool/image support shown so people know which can edit files.
4. **The daily free allowance is visible**: "32 of 50 free requests left today · resets 20:00" in Settings → Accounts and the picker footer.
5. **Running out never fails a run**: the run **pauses** with three ways on (wait for the reset, switch model, add credits). Per-minute limits retry by themselves.

## 3. Non-goals

- No Tether-paid model access, subscriptions or billing (Cursor model). Tether stays a free app; the person's own OpenRouter account carries the usage.
- No shared key shipped in the app.
- No changes to Fireworks / Groq / Together / other presets: they stay env-var keys for advanced users (they already exist in `src/providers.ts`).
- No new provider beyond OpenRouter in this project.
- No dark/light or phone-width redesign of these screens beyond what the app's existing styles give.

## 4. Anti-goals (a failure even if it "works")

- A run that **errors** because the free allowance ran out, losing the worktree's progress.
- A key visible in any file, log, URL, process list or API response.
- Silently changing a bot the person bound on purpose (for example Lens on `claude`).
- A picker that offers a free model for a writing step when that model cannot call tools, without saying so.

## 5. Facts the design rests on (checked 2026-10-28)

- **OpenRouter OAuth PKCE** (docs: openrouter.ai/docs/guides/overview/auth/oauth): authorize at `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256` (optional `key_label`, `state`). Localhost callbacks are allowed **on any port**. Exchange: `POST https://openrouter.ai/api/v1/auth/keys` with JSON `{code, code_verifier, code_challenge_method}` → `{ key }`. Codes expire after 10 minutes. No client id or secret. The approval page lets the person set a credit limit on the new key.
- **Free limits** (OpenRouter limits doc): `:free` models are limited to 20 requests/minute and 50/day (fewer than 10 credits ever purchased) or 1000/day (10 or more). The day is the **UTC day**. `GET /api/v1/key` returns `data.free_model_daily_requests {used, limit, remaining}`, plus `is_free_tier`, `limit`, `limit_remaining`. The per-minute limit is not reported.
- **429 on free models** has body `{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}}}`. `X-RateLimit-Reset` may be present; `Retry-After` is not guaranteed. Per-minute and daily 429s look the same.
- **Models list**: `GET https://openrouter.ai/api/v1/models` returns each model's `id`, `name`, `context_length`, `pricing` (prompt/completion strings, `"0"` for free), `supported_parameters` (contains `"tools"` when tool calling works) and `architecture.input_modalities` (contains `"image"` for vision). Free variants' ids end in `:free`.
- `nvidia/nemotron-3.5-super-vl:free`: free, tool calling, image+video input, 1M context (released 2026-10-15).

## 6. What exists today (reuse, don't rebuild)

- `src/providers.ts`: `PRESETS` already includes `openrouter` (`https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`), endpoints live in `<home>/aorch.config.json` as `{baseUrl, apiKey: "env:NAME"}`; `keyRef` refuses literal keys.
- `src/adapters/openai.ts`: the OpenAI-compatible adapter with its own tool loop / Code Mode; resolves `env:` keys in `headers()`; `/models` listing; a model with no tool support already fails writable steps with a clear message.
- `src/accounts/`: `registry.ts` (`ProviderDef`, kinds `device|pkce|cli`), `pkce.ts` (loopback listener, `pkcePair`, `checkCallback`, `runPkceFlow` for standard OAuth), `secretStore.ts` (Keychain via `security -i` on darwin, 0600 file elsewhere), `store.ts`, `routes.ts` (`/api/accounts…`), web `settings/Accounts.tsx`.
- `src/bindings.ts`: per-bot `{agent, model, toolStyle, codeReads}` bindings; `applyBindings` fills steps from them. The ⌘J assistant runs on the Tether bot's binding.
- Web, as of main `cd94845` (PR #12 tool screens merged): **Settings** is one page over the current screen with cards Accounts, Agents & tools, Appearance, Storage, Server, About and a floating section list (`web/src/ui/studio/SettingsPage.tsx`); the sidebar account chip opens it at `accounts`. **Crew** is a role lineup + library bench with a docked bot card; a bot's agent and model are set in its **Runs on** section (`web/src/crew/RunsOn.tsx`): a `Picker` for Agent plus a free-text Model `Input` with a `<datalist>` of `agents[x].models`, the Code Mode / Direct switch, and the hint "Small models may do better with Direct tool calls".
- Runs pause when a node is `awaiting` (`engine.ts` → `finish(runId,'paused')`), which is how approvals and questions work; Home "Needs you" and Inbox read attention items (`AttentionKind` includes `'paused'`).

## 7. Design

### 7.1 Connect OpenRouter (accounts)

- New provider entry `openrouter` in `registry.ts`, `available: true`, a new kind (for example `'pkce-key'`) because the flow is not standard OAuth: no client id, `callback_url` instead of `redirect_uri`, JSON exchange returning `{key}` instead of an access token.
- Reuse `pkce.ts`'s loopback listener, `pkcePair`, `checkCallback` (state check) and timeout. Add only the OpenRouter-specific authorize URL and exchange. `key_label` = `Tether`. Send `state` and check it.
- On success store the key in the secret store under the account id (Keychain on macOS), record the account (`store.ts`) with the time connected, and make sure an endpoint `openrouter` exists in config with `apiKey: "account:openrouter"` (see 7.2). Never log, return or persist the key anywhere else.
- **Disconnect** deletes the stored key and the account. It leaves the endpoint and bindings in place; they then show "not connected" (the existing health check reports the missing key).
- Entry points: Home "Needs you" row (7.5), Settings → Accounts row, `tether` CLI (`tether accounts connect openrouter`, same flow, prints the browser URL as a fallback).

### 7.2 Keys from the secret store

- Extend the key reference format with `account:<provider>`: the adapter resolves it from the secret store. Keychain reads are async (`security -i`), so resolve when the registry/adapter is built and on connect/disconnect, and keep the value in memory only; `headers()` stays synchronous.
- If both `OPENROUTER_API_KEY` and a connected account exist, the connected account wins for the `openrouter` endpoint. An existing env-based `openrouter` endpoint is switched to `account:openrouter` on connect.
- Send OpenRouter's optional attribution headers (`HTTP-Referer: https://tether.tusharcs0112.workers.dev`, `X-Title: Tether`) on OpenRouter requests only.

### 7.3 Free defaults

- Note: an unbound bot (no entry in `bots.json`) is not idle; it runs on `claude` by default (`hintFor`, `assistantAgent`).
- **Owner decided:** on connect, unbound crew bots (including the Tether bot, which the ⌘J assistant uses) are bound to `{agent: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free'}` **only when no usable agent exists** (no healthy `claude`/`codex`/`opencode`, no other endpoint with a key, no running local server: the same test as 7.5's first-launch row). When a usable agent exists, nothing is rebound; the OpenRouter row in Accounts shows a **Use free models for the crew** button that applies the same binding to unbound bots on request. **Bots the person bound on purpose are never changed** in either case.
- Settings → Accounts shows the free defaults as chips (mockup board 2). The default model id is a single constant; if OpenRouter's list no longer has it, fall back to the first `:free` model that supports tools and say so in the row.

### 7.4 Model picker

- Where it lives: in the Crew docked bot card's **Runs on** section, when Agent is `openrouter` the free-text Model input becomes this picker (other agents keep the input + datalist). Mockup board 3 drew the pre-#12 side panel; follow the current docked card layout, same content. The ⌘J assistant's existing model menu (`AIComposer`, PR #13: Auto or a model of the bound agent, per project) lists OpenRouter models with the same `free`/`tools`/`images` tags when the Tether bot is bound to `openrouter`; it still only switches the model, not the agent.
- The picker lists OpenRouter models grouped **Free · OpenRouter**, **Paid · OpenRouter**, **Agents & local** (claude, codex, opencode, ollama… as today).
- Each OpenRouter row shows name, provider, and tags from the models list: `free` (green pill), `tools`, `images`, context size. Paid rows show price per 1M in/out.
- **Free only** filter and a search box ("Search 300+ models").
- A free model without `tools` is shown dimmed with "chat only · can't edit files". Picking it for a writing bot (Bolt, Brick in write mode) shows that warning inline; it is still allowed for read-only bots and chat.
- Footer: the free-requests counter (7.6).
- The models list is fetched from OpenRouter's `/models` (no key needed), cached in memory with a modest lifetime (for example 1 hour), and served by a Tether API route so the web UI never calls OpenRouter directly.

### 7.5 Home first launch

- When no model is usable (no OpenRouter account, no healthy agent CLI, no endpoint with a key, no local server), Home's **Needs you** shows one row: "Run Tether on free models · Connect OpenRouter once. Approve in your browser, no key to copy. 50 free requests a day." with **Connect OpenRouter** (primary) and **I have keys** (opens the Settings page at the Agents & tools card). Mockup board 1. It goes away once anything usable exists.
- (My call, builder check) **No model chip on Home's Start-run composer**: a run spans several bots with their own bindings, so one chip would mislead. Mockup board 1's chip is dropped.

### 7.6 Free-requests counter

- A Tether route returns `{used, limit, remaining, resetsAt}` from OpenRouter's `GET /api/v1/key` (`free_model_daily_requests`), `resetsAt` = next UTC midnight, displayed in local time ("resets 20:00").
- Refresh: on Settings/picker open, after each run step that used OpenRouter, and at most every 60 s while a screen shows it. Never on every model call.
- Shown in the Settings page's **Accounts** card (the OpenRouter row; board 2's left section nav is the page's existing floating section list) (bar + "Add $10 of credits ↗" link to OpenRouter's credits page: 1,000 a day), picker footer, and the run meta line ("50/50 free requests").

### 7.7 Rate limits and pausing

- In the OpenAI adapter, for the `openrouter` endpoint, a 429 is classified by asking `GET /api/v1/key`:
  - `free_model_daily_requests.remaining > 0` → **per-minute limit**: wait (`X-RateLimit-Reset` if present, else 15 s, then backoff), retry up to a small cap, and log one line in the run output ("per-minute limit · retried after 12s"). Past the cap, treat as daily.
  - `remaining == 0` → **daily limit**: the step does not fail. It becomes `awaiting` with a new attention reason (for example `free_limit`) so the run pauses with the worktree intact, exactly like an approval.
- The paused run (mockup board 4): amber "needs you" badge, graph node "paused · step N", log line "run paused · 50 of 50 free requests used today", file list "Kept in the worktree. Nothing is lost.", and an amber bar in the approval-bar position: "Out of free requests for today · Bolt picks up where it stopped at 20:00, or keep going now on another model." Buttons **Add credits ↗**, **Switch model…**, **Wait until 20:00** (primary).
  - **Wait**: the run resumes by itself after the UTC reset. Implementation choice for the builder: a timer in the server (re-armed on server start from persisted paused runs).
  - **Switch model…**: opens the picker for this run's paused step; choosing a model resumes the step on it (this run only, bindings untouched).
  - **Add credits ↗**: opens OpenRouter's credits page in the system browser; the run stays paused; after adding credits the person presses Resume (the counter shows the new limit).
- The step resumes from where it stopped: the worktree keeps file changes; the model conversation for that step restarts with the step prompt plus a note of what is already changed (the same way an interrupted step is resumed today, if that exists; otherwise a fresh attempt on the same worktree).
- (My call, builder check) **Only run steps pause.** OpenRouter calls outside a pausable step (the ⌘J assistant turn, manager planning/review, bot-to-bot consults, `@ASK` follow-ups) end with a clear message instead: "Out of free requests until 20:00 · Switch model", the link opening the relevant picker (assistant model menu, or the bot's Runs on). The 429 classifier returns one shared `daily limit` signal; the step path turns it into a pause, the others into this message.
- The paused-for-limit item appears in Home "Needs you", Inbox and the assistant launcher badge like any other attention item.

## 8. Constraints

- Follow the app's current look (Studio Live dark/light tokens, Linear sidebar, list rows with inline actions, ink/white primary buttons, amber = needs you, mono status text): the approved mockup boards are the reference.
- Keys never in config files, logs, argv, URLs or API responses; the secret store only. The loopback listener binds 127.0.0.1 only and checks `state`.
- Works when OpenRouter is unreachable: the picker shows the last cached list or "can't reach OpenRouter", runs fail with the adapter's existing "cannot reach" message.
- Existing behavior for Claude/Codex/OpenCode/local models and env-key endpoints is unchanged.
- Tests for: the OpenRouter auth URL and exchange (mocked fetch), `account:` key resolution, 429 classification (per-minute vs daily), the pause/resume path, free tagging from a `/models` fixture, and first-launch detection.

## 9. Decided by the owner

- OpenRouter (the owner's "Omnirouter"), free `:free` models, no key copy/paste: one browser approval.
- Running out pauses the run with Wait / Switch model / Add credits, and the counter is shown ahead of time (Cursor-style honesty, but Tether does not pay for models).
- The four mockup boards (Home first launch, Settings → Accounts, Crew → Bolt picker, paused run).

## 10. Left to the builder

- Exact names: provider kind, attention reason, route paths, constants.
- Cache lifetimes and retry cap (within the limits above).
- How the resume timer is persisted.
- Component reuse in the web UI (use the existing beui kit, `StatusBadge`, `ApprovalBar` layout, Crew side panel).

## 11. My calls (owner: check these)

- No model chip on Home's Start-run composer; the ⌘J assistant's existing model menu shows OpenRouter's tagged models instead (7.4, 7.5).
- Only run steps pause on the daily limit; assistant/planning/consult calls end with a clear message + Switch model link (7.7).
- `account:openrouter` wins over `OPENROUTER_API_KEY` when both exist.
- The models list is fetched without a key, cached 1 h.
- Free tool-less models are allowed but warned, not hidden.
