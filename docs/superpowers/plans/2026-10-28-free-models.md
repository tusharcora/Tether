# Free models via OpenRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect OpenRouter with one browser approval, run the crew and the ⌘J assistant on `:free` models, show which
models are free and how many free requests are left, and pause (never fail) a run that runs out.

**Architecture:** Pure OpenRouter helpers in `src/openrouter.ts` (auth URL, key exchange, allowance, 429 kind, model
tags) used by three places: the account (`src/accounts/openrouter.ts`, reusing `pkce.ts`'s loopback listener), the
OpenAI-compatible adapter (`account:` keys, attribution headers, 429 handling that returns a `limit` signal), and the
engine (a `node.limited` event turns that signal into an `awaiting` step, so the run pauses like an approval and resumes
by timer, Resume or Switch model). The web adds an OpenRouter row in Settings → Accounts, a first-launch row on Home, a
model picker in Crew's Runs on, tags in the assistant's model menu, and an amber bar on a paused run.

**Tech Stack:** Node 22 (`node:http`, `node:crypto`, global `fetch`), TypeScript, React 19, vendored beui kit, Vitest +
Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-28-free-models-design.md` (§9 and §11 are decided; do not reopen them).
Mockups: `~/Documents/PROJECTS/.mockups/free-models/project/{Main,Accounts,Picker,Paused}.dc.html` (content reference;
build with the app's components and tokens, not the mockups' inline styles).

## Global Constraints

- Work only in `.claude/worktrees/free-models` on `feature/free-models`. No new dependencies; do not commit `package-lock.json`.
- Keys never in config files, logs, argv, URLs or API responses; the SecretStore (Keychain on macOS) and process memory only.
- The loopback listener binds `127.0.0.1` only and checks `state` (timing-safe, `checkCallback`).
- `account:openrouter` wins over `OPENROUTER_API_KEY`; connect switches an env-based `openrouter` endpoint to it.
- Default free model: `nvidia/nemotron-3.5-super-vl:free` (one constant); fallback: the first `:free` model with `tools`.
- Free limits: 20/min and 50/day (1000/day after 10 credits); the day is the UTC day; `GET /api/v1/key` →
  `data.free_model_daily_requests {used, limit, remaining}`.
- Attribution headers on OpenRouter requests only: `HTTP-Referer: https://tether.tusharcs0112.workers.dev`, `X-Title: Tether`.
- Copy (verbatim): "Run Tether on free models" · "Connect OpenRouter once. Approve in your browser, no key to copy. 50
  free requests a day." · "Out of free requests for today" · "Out of free requests until HH:MM · Switch model" ·
  "chat only · can't edit files" · "Kept in the worktree. Nothing is lost." · "Use free models for the crew".
- Existing behaviour for claude/codex/opencode/local models and env-key endpoints is unchanged.
- UI: Studio tokens only (`--ok/--okBg` for the free pill, `--warn/--warnBg` for needs-you amber), no raw hex, no purple;
  beui `Button`, `Input`/`SearchField`, `StatusBadge`, `ListRow`; accessible names on every control.
- Commits: plain conventional messages, no trailers, no mention of AI tools.

## Decisions the spec leaves to the builder

- Provider kind `'pkce-key'`; account `via: 'browser'`, `login: 'Tether'` (the key label: OpenRouter tells us no user name).
- Callback URL `http://localhost:<port>/oauth/callback` (OpenRouter documents `localhost` on any port, not `127.0.0.1`);
  the listener still binds `127.0.0.1`.
- Event `{ type: 'node.limited'; node; resetsAt }`; `NodeState.limit = { resetsAt }`; attention kind `'free_limit'`.
- Only `:free` models are classified on a 429 (a paid model's 429 keeps today's HTTP error). Per-minute: wait
  `X-RateLimit-Reset` (ms epoch) if present else 15 s, doubling, at most 3 retries; past that, daily.
- Resume timer: armed in the engine when a run pauses on the limit and re-armed at server start for every paused run
  with a limited step, firing 30 s after `resetsAt`; `unref`'d so CLI processes still exit. "Wait until HH:MM" only
  acknowledges (the timer is already armed; the bar's copy promises it).
- Models list cached in memory 1 h; allowance not cached server-side (screens poll it at most every 60 s).
- Free defaults bind only built-in model bots (`kind` agent, verdict or orchestrator): Tether, Scout, Brick, Bolt, Lens,
  Boss. Imported bots keep the default agent.
- Assistant/planning/consult calls show the adapter's error text "Out of free requests until HH:MM · Switch model"; the
  assistant's thread turns "Switch model" into a button that opens Crew on the Tether bot (its Runs on).

## Review Focus

- A forged or stale callback (wrong `state`, an `error=` param, a second hit) never stores a key → Task 4 test.
- `GET /api/accounts` and every OpenRouter route body never contain the key, even right after connect → Task 4 test.
- OpenRouter unreachable: models route answers the last cached list or `{ error: "can't reach OpenRouter" }`; allowance
  answers 502, the picker still lets you type a model → Task 6 test.
- A run paused on the limit that is then stopped can be resumed and reruns the step → Task 3 test.
- A paid model's 429 is not turned into a pause → Task 2 test.

---

### Task 1: OpenRouter helpers

**Files:** Create `src/openrouter.ts`, `test/openrouter.test.ts`, `test/fixtures/openrouter-models.json` (5 real rows:
nemotron-3.5-super-vl:free, nemotron-3.5-content-safety:free (no tools), recursive/flint-v1.0:free, anthropic/claude-sonnet-4.5,
openrouter/auto (pricing -1)).

**Produces:**
- `OR_API = 'https://openrouter.ai/api/v1'`, `FREE_DEFAULT`, `CREDITS_URL = 'https://openrouter.ai/settings/credits'`
- `isOpenRouter(baseUrl: string): boolean` (host `openrouter.ai`)
- `authUrl(o: { callbackUrl; challenge; state }): string` → `https://openrouter.ai/auth?callback_url&code_challenge&code_challenge_method=S256&key_label=Tether&state`
- `exchangeKey(code, verifier, f = fetch): Promise<string>` → POST `${OR_API}/auth/keys` JSON `{code, code_verifier, code_challenge_method:'S256'}`; error carries the HTTP status only
- `interface Allowance { used; limit; remaining; resetsAt }`, `nextUtcMidnight(now = Date.now())`, `allowance(key, f = fetch, now?)`
- `limitKind(key | undefined, f = fetch): Promise<'minute' | 'daily'>` (`remaining > 0` or unknown → minute)
- `limitMessage(resetsAt): string` → `Out of free requests until HH:MM · Switch model` (local time)
- `interface OrModel { id; name; provider; free; tools; images; context; price?: { in: number; out: number } }` ($ per 1M)
- `tagModels(json: unknown): OrModel[]` (free first, then paid; name without the "Vendor: " prefix and " (free)" suffix)
- `freeDefault(models): { id; fallback: boolean } | undefined`

- [ ] Test `authUrl` params exactly; `exchangeKey` posts the JSON body to the exchange URL and returns `key`, throws `HTTP 400` without echoing the body; `allowance` maps `free_model_daily_requests` and `resetsAt === nextUtcMidnight(now)`; `nextUtcMidnight(Date.UTC(2026,9,28,23,59))` → `Date.UTC(2026,9,29)`; `limitKind` minute/daily/unknown; `limitMessage` HH:MM; `tagModels(fixture)` tags (free/tools/images/context/price 3 and 15), skips the -1 price; `freeDefault` constant present → `{fallback:false}`, absent → first free+tools `{fallback:true}`.
- [ ] Run `npx vitest run test/openrouter.test.ts` → FAIL; implement; → PASS. Commit `feat: openrouter helpers (auth url, key exchange, allowance, model tags)`.

### Task 2: Account keys and 429 handling in the OpenAI adapter

**Files:** Create `src/accounts/keys.ts`; modify `src/adapters/openai.ts`, `src/adapters/index.ts`, `src/config.ts`
(`makeRegistry` passes `cfg.home`), `src/providers.ts` (`listProviders` keySet for `account:`), `src/types.ts`
(`AgentResult.limit?: { resetsAt: number }`); test `test/openrouter-adapter.test.ts`.

**Produces:** `accountKey(home, provider, store?): Promise<string | undefined>` (SecretStore read once, then memory),
`setAccountKey(home, provider, value | undefined)`; `new OpenAICompatAdapter(id, cfg, home?)`;
`defaultRegistry(custom, endpoints, home?)`; `AgentResult.limit`.

- [ ] Tests (fetch stubbed with `vi.stubGlobal`): an `account:openrouter` endpoint sends `Bearer <stored key>` and the two attribution headers; a non-OpenRouter endpoint gets no attribution headers; with `OPENROUTER_API_KEY` set too, the account key is used; no chunk or result contains the key; a `:free` model's 429 with `remaining 5` and `X-RateLimit-Reset` ≈ now retries and logs `per-minute limit · retried after 0s`; with `remaining 0` the result has `limit.resetsAt === nextUtcMidnight()` and `error === limitMessage(...)`; a paid model's 429 keeps `openrouter: HTTP 429…` with no `limit`.
- [ ] FAIL → implement (`headers()` becomes async) → PASS; existing `npx vitest run test/providers.test.ts test/local.test.ts` still pass. Commit `feat: account keys and free-limit handling in the openai adapter`.

### Task 3: Pause a step on the daily limit

**Files:** Modify `src/types.ts` (event, `NodeState.limit`, fold, `AttentionKind`), `src/engine.ts`
(`runAgentAttempt`, `resume`, `armLimitTimers`), `src/attention.ts`, `src/prompt.ts` caller (resumed note), web `KIND_LABEL`
(`web/src/home/NeedsYou.tsx`) and `describeEvent` (`web/src/api.ts`); test `test/free-limit.test.ts`.

**Produces:** `{ type: 'node.limited'; node: string; resetsAt: number }`; `Engine.resume(runId, { …, switchTo?: { agent: string; model?: string } })`;
`Engine.armLimitTimers(): void`; attention item `{ kind: 'free_limit', title: 'Out of free requests for today', actions: ['open'] }`.

- [ ] Tests with a scripted adapter (first call returns `{ exitCode: 1, error, limit: { resetsAt } }`, later calls succeed): run ends `paused`, the step is `awaiting` with `limit`, a file it wrote is still in the worktree, attention lists `free_limit` (not `paused`); `resume` reruns it to `done` and its prompt carries the resumed note; `resume` with `switchTo` records `node.amended` with the new model; a stopped limited run resumes and reruns the step; `armLimitTimers` with `resetsAt` in the past resumes the run by itself.
- [ ] FAIL → implement → PASS; `npx vitest run test/engine.test.ts test/attention.test.ts` still pass. Commit `feat: pause a run step on the free daily limit and resume it`.

### Task 4: Connect OpenRouter (account)

**Files:** Modify `src/accounts/pkce.ts` (extract `loopbackCode`), `src/accounts/registry.ts` (`openrouter`, kind
`'pkce-key'`), `src/accounts/store.ts` (`via: 'browser'`), `src/accounts/routes.ts`, `src/providers.ts`
(`useAccountEndpoint(cfg)`); create `src/accounts/openrouter.ts`; tests in `test/accounts.test.ts`.

**Produces:** `loopbackCode(o: { url: (redirectUri: string, pair: { challenge; state }) => string; open; timeoutMs?; host?: string }): Promise<{ code; redirectUri; verifier }>`;
`class OpenRouterAccount(cfg, registry, deps: { fetch?; store?; usable?: () => Promise<boolean>; timeoutMs? })` with
`account()`, `start(open?): Promise<{ url }>`, `flow(): OrFlow`, `disconnect()`, `useForCrew(): string[]`, `defaults()`;
routes `POST /api/accounts/openrouter` → `{ url }`, `GET /api/accounts/openrouter/flow`, `DELETE /api/accounts/openrouter`.

- [ ] Tests: existing `runPkceFlow` tests pass unchanged; full flow with a fake exchange (fetch the callback URL with the right state) stores the key in the store, records the account, writes `endpoints.openrouter.apiKey === 'account:openrouter'` (env endpoint switched), registers the adapter, and neither `accounts.json`, `aorch.config.json` nor any route body contains the key; wrong state → flow `error`, nothing stored; disconnect deletes the key and the account and keeps the endpoint.
- [ ] FAIL → implement → PASS. Commit `feat: connect OpenRouter with a browser approval (PKCE, key in the keychain)`.

### Task 5: Free defaults and first launch

**Files:** Modify `src/providers.ts` (`anyUsable`), `src/bindings.ts` (`bindFree(home, model): string[]`),
`src/accounts/openrouter.ts`, `src/accounts/routes.ts`, `src/server.ts` (pass `usable`, reset doctor/models caches);
tests in `test/accounts.test.ts`, `test/bindings.test.ts`, `test/providers.test.ts`.

**Produces:** `anyUsable(cfg, detected: Record<string, { ok: boolean }>): boolean`; `bindFree` binds unbound built-in
model bots and returns their ids; `GET /api/accounts` openrouter entry adds `setup: boolean` (nothing usable) and
`defaults: { model, fallback, bots: string[] } | null`; `POST /api/accounts/openrouter/crew` → `{ bound: string[] }`.

- [ ] Tests: `anyUsable` false for {claude:not ok, ollama:not ok, openrouter endpoint with `env:` key unset}, true for a healthy CLI, a running local server or an endpoint whose key is set (`account:` counts when connected); `bindFree` leaves `coder` bound to `claude` alone and never binds `approval`/`tester`; connect with `usable → false` binds the crew, with `usable → true` binds nothing and `/crew` then binds.
- [ ] FAIL → implement → PASS. Commit `feat: free model defaults for the crew and first-launch detection`.

### Task 6: Models and allowance routes, shared registry, CLI

**Files:** Modify `src/accounts/routes.ts` (`GET /api/accounts/openrouter/models`, `GET /api/accounts/openrouter/allowance`),
`src/serve.ts` (server uses the engine's registry; `engine.armLimitTimers()`), `src/cli.ts` (`tether accounts
[status | connect openrouter | disconnect openrouter]`, help line); tests in `test/accounts.test.ts`.

- [ ] Tests: models route returns tagged models and serves the cached list when the next fetch fails (and `{ error }` with 502 when there is none); allowance returns the mapped counter for a connected account and 409 when not connected.
- [ ] FAIL → implement → PASS. Commit `feat: openrouter models and free-request routes, accounts CLI`.

### Task 7: Settings → Accounts row

**Files:** Modify `web/src/settings/accountsApi.ts`, `web/src/settings/Accounts.tsx`, `web/src/settings/settings.css`;
create `web/src/settings/FreeCounter.tsx` (bar + "N of M free requests left today · resets HH:MM"); test
`web/src/settings/Accounts.test.tsx`.

- [ ] Tests: not connected → "Connect OpenRouter" posts and polls the flow; connected → counter "32 of 50 free requests left today", "Add $10 of credits ↗" link to `CREDITS_URL`, defaults chips, "Use free models for the crew" (shown when `defaults` is null) posts `/crew`, Disconnect.
- [ ] FAIL → implement → PASS. Commit `feat(web): OpenRouter in Settings → Accounts with the free counter`.

### Task 8: Home first-launch row

**Files:** Modify `web/src/home/NeedsYou.tsx`, `web/src/home/Home.tsx`, `web/src/App.tsx` (pass the accounts poll); test `web/src/home/NeedsYou.test.tsx`.

- [ ] Tests: with `setup: true` the row shows the spec copy, Connect OpenRouter (primary) starts the flow, I have keys goes to `{ tab: 'settings', id: 'agents' }`; with `setup: false` no row.
- [ ] FAIL → implement → PASS. Commit `feat(web): first-launch row to run Tether on free models`.

### Task 9: Model picker in Runs on, tags in the assistant menu

**Files:** Create `web/src/crew/ModelPicker.tsx`; modify `web/src/crew/RunsOn.tsx`, `web/src/crew/crew.css`,
`web/src/components/composer/AIComposer.tsx` (optional `tags`), `web/src/assistant/Chat.tsx`; tests
`web/src/crew/RunsOn.test.tsx`, `web/src/components/composer/AIComposer.test.tsx`.

- [ ] Tests: agent `openrouter` shows the picker (groups Free · OpenRouter / Paid · OpenRouter / Agents & local, search, Free only filter, footer counter); a free model without tools reads "chat only · can't edit files" and picking it for a writing bot shows the warning; other agents keep the input + datalist; AIComposer rows show `free`/`tools`/`images` tags when given.
- [ ] FAIL → implement → PASS. Commit `feat(web): OpenRouter model picker with free, tools and image tags`.

### Task 10: Paused-run bar and limit messages

**Files:** Create `web/src/runs/LimitBar.tsx`; modify `web/src/runs/RunPage.tsx`, `web/src/runs/RunHeader.tsx` (meta
"N/M free requests"), `web/src/assistant/Thread.tsx` (Switch model button); tests `web/src/runs/RunPage.test.tsx`,
`web/src/assistant/*.test.tsx`.

- [ ] Tests: a paused run with a limited step shows "Out of free requests for today", "Bolt picks up where it stopped at HH:MM, or keep going now on another model.", Add credits ↗ (opens `CREDITS_URL`), Switch model… (picker; choosing posts `/resume` with `{ agent: 'openrouter', model }`), Wait until HH:MM; files note "Kept in the worktree. Nothing is lost."; an assistant error with the limit message shows a Switch model button.
- [ ] FAIL → implement → PASS. Commit `feat(web): paused-run bar for the free limit`.

### Task 11: Verify and push

- [ ] Real checks without a key: `authUrl` opened shape, `GET /models` live through the route, UI via `npm run build` + `AORCH_HOME=$(mktemp -d) npm run dev`.
- [ ] `npm run typecheck`, `npm test`, `npm run build` (known baseline: 3 triggers tests on /private/var, evolve/team timeouts).
- [ ] `git push`; write `.superpowers/tether/free-models-report.md`.
