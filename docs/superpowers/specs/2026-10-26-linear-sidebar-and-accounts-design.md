# Linear-style sidebar, Connected accounts and Code Mode

Date: 2026-10-26 · Branch: `feature/linear-sidebar-accounts` (from `main` @ 93f686a, after Tether PR #5)

## 1. Intent

The owner found the Tether sidebar "too basic" and chose, from five mockups, the **Linear** variation (A on the canvas
board "sidebar variations", copied to `docs/design/AppSidebarLinear.dc.html`, tab A), adjusted: **Search, Home, Inbox
(needs you) and Runs at the top**, **Settings at the bottom**. The Notion-style board (`AppSidebarNotion`) is the
recorded backup and is not built.

The owner also wants to sign in with GitHub, Google and more, and chose option **(a)**: *connect accounts to the local
app* — built in-house, no Clerk, no login screen (the app is single-user on loopback; a login would add friction and no
security).

Success: the sidebar looks and behaves like the approved board, every current function still reachable; Settings →
Accounts connects GitHub in one click (or reuses the `gh` login already on the Mac), shows who is connected, and Tether's
GitHub features (PR triggers, cloning, comments) use that connection.

## 2. Sidebar (replaces the §6.1 sidebar from the Tether spec)

Width 244 px; dense rows (28 px, 13 px text); Studio Live tokens in both themes.

**Top bar**: project switcher (project tile + name + ⌄ → menu of projects with status, *Open folder… ⌘O*, *Remove from
Tether*, *Reveal in Finder*) and a **compose** button (new run, ⌘N / `C`).

**Top items**, in this order:
1. **Search** — opens ⌘K (shows the ⌘K hint).
2. **Home** — `#/home`.
3. **Inbox** — the needs-you list (today's Home "Needs you" section, given its own route `#/inbox` with the same
   inline actions); count on the right.
4. **Runs** — `#/runs`; count of live runs.

**Workspace** section: Code, Builder, Crew, API client, Graph, Triggers — each shows a `G` + letter shortcut on hover
(`G C` Code, `G B` Builder, `G R` Crew, `G A` API client, `G G` Graph, `G T` Triggers; also `G H` Home, `G I` Inbox,
`G U` Runs) — Linear's two-key navigation, ignored while typing in a field.

**Runs** section: the current project's recent runs (live first, then needs-you, then the last 5 finished), each with a
**status glyph**: half-filled blue circle = running, dashed amber circle = needs you, green check = done, red ✕ =
failed, grey ring = queued/paused; title truncated; short id (`R-144`) right-aligned; click opens the run. Header shows
the count; "View all" goes to Runs.

**Favorites** section: pins (the existing `/api/pins`) — workflows, runs, files, saved requests; hover ⋯ to unpin; drag
to reorder.

Sections fold with a click on their header (state remembered); hover shows ⋯ / ＋ like Linear.

**Bottom**: **Settings** row (⌘,) above a divider, then the **account row** — initials avatar, name, and a connection
chip ("GitHub" with a green dot when connected, "Connect" otherwise) that opens Settings → Accounts.

**Collapse**: ⌘\ hides the sidebar fully; a floating sidebar peeks when the pointer reaches the left edge (as in the
Notion backup — the Linear app does the same); a ☰ button in the screen header docks it again. Below 900 px the bottom
bar stays as today.

**Icons** (owner, 2026-10-26): use the **Notion backup's line icons** (`.mockup`/canvas board `AppSidebarNotion`), not the
Linear board's text glyphs — lucide-style outline icons at 16–17 px, stroke 1.7, `currentColor`, from the existing
`lucide-react` dependency where one matches: Search `search`, Home `house`, Inbox `inbox`, Runs `play`, Code `code`,
Builder `workflow`, Crew `users`, API client `arrow-left-right`, Graph `waypoints`, Triggers `zap`, Settings `settings`,
Favorites rows by kind (`file`, `workflow`, `play`, `arrow-right`), compose `square-pen`. The run **status glyphs** in the
Runs section stay custom (they encode state).

**Accessibility**: `nav` landmark, `aria-current="page"`, section headers are disclosure buttons, status glyphs carry
text labels (`aria-label="Running"`), shortcuts listed in the ⌘K help.

Removes the current Sidebar component's layout; routes, ⌘K, BottomBar and pins API are reused.

## 3. Connected accounts

### 3.1 What it is
A **Settings → Accounts** panel listing providers. Each shows: status (connected as `@login` / not connected), scopes,
when connected, *Connect* / *Disconnect*. The account row in the sidebar mirrors the primary account (GitHub).

### 3.2 GitHub (built now)
Two ways in, in this order:
1. **Reuse the GitHub CLI login** — if `gh auth status` reports a logged-in account, Accounts shows "Signed in via GitHub
   CLI as @login" with a *Use this* button. Tether then reads the token on demand with `gh auth token` (never stored by
   Tether). This is zero-setup and matches how PR triggers already call `gh`.
2. **Sign in with GitHub (device flow)** — *Connect* shows a one-time code and opens `https://github.com/login/device`
   in the system browser; Tether polls GitHub until approved, then stores the token in the **macOS Keychain** (service
   `dev.tether.app`, account `github`) via the `security` CLI; on other platforms a 0600 file in `~/.aorch/secrets/`
   (same rule as the existing secrets store). Needs a GitHub **OAuth App client id** with device flow enabled — read
   from `TETHER_GITHUB_CLIENT_ID` or Settings; until set, the device-flow button explains how to create one (one-time
   owner step) and the CLI option still works.

Scopes requested: `repo`, `read:user`, `admin:repo_hook` (webhooks for triggers). Tokens never reach the browser: the
server exposes only `{ provider, login, avatarUrl?, scopes, via: 'gh'|'device', connectedAt }`.

Tether's GitHub calls (PR triggers, clone, comment) use the connected account: `gh` path unchanged when connected via CLI;
for device-flow tokens, commands get `GH_TOKEN` in their environment so `gh` uses it.

### 3.3 Google and others
The provider list is a small registry (`id`, `name`, `kind: 'device' | 'pkce' | 'cli'`, endpoints, scopes). **Google is
listed as "coming when a feature needs it"** — there is no Google-backed feature in Tether yet, so connecting would store
a token nothing uses. The registry and the generic PKCE loopback flow (RFC 8252: system browser → `http://127.0.0.1:<port>/
oauth/callback`, state + PKCE S256) are built and unit-tested now so adding Google (or GitLab, Linear, Slack) later is a
registry entry plus the feature that uses it.

### 3.4 Server
- `GET /api/accounts` → provider list with public status.
- `POST /api/accounts/github/cli` → adopt the `gh` login (verifies with `gh api user`).
- `POST /api/accounts/github/device` → starts device flow, returns `{ userCode, verificationUri, expiresIn, interval }`;
  `GET /api/accounts/github/device` → `{ state: 'pending'|'connected'|'expired'|'denied', account? }` (server polls GitHub).
- `DELETE /api/accounts/:provider` → forgets the connection (removes the Keychain item; for `gh`, only Tether's adoption —
  never logs `gh` out).
- All behind the existing loopback/Host/Origin guards; tokens never serialised to clients or logs; redaction applied.

## 4. Code Mode for Tether-run agents

Owner request (2026-10-26): make agents use Cloudflare's **Code Mode** instead of MCP for tool calls, for fewer tokens and
better agent efficiency.

**Where it applies.** Tether has no MCP surface. Vendor CLIs (Claude Code, Codex, OpenCode, Gemini — `claude.ts`,
`cli.ts`) run their own tool loops with their own built-in tools; Tether cannot change those and they are already
code-first (shell). The one loop Tether owns is **`src/adapters/openai.ts`** (Ollama, LM Studio, llama.cpp, OpenRouter),
which today offers JSON tools (`list_files`, `read_file`, `search`, `write_file`) one call per round-trip. Code Mode is
built there.

**Design.**
- The model gets **one tool, `run_code`**, whose description embeds a small **TypeScript declaration** of the API it may
  call (generated from one definition, like Cloudflare's tool→TS conversion):
  `repo.list(dir?)`, `repo.read(path, {from?, to?})`, `repo.search(pattern, {path?, max?})`, `repo.write(path, text)` (only
  when the step is writable), `repo.diff()`, `tether.note(text)` (adds to the step output), `tether.ask(question)` (raises
  an Inbox question — ends the step waiting, as asks do today), and `console.log` for returning results.
- The model writes a short async JS/TS snippet (TS is stripped with a type-erasing transform; no type-checking); Tether
  runs it in a **local QuickJS sandbox (WebAssembly, `quickjs-emscripten`)**: no filesystem, network, process, timers
  beyond the API; **5 s CPU / 64 MB / 200 API calls per snippet**; API calls are bridged to the host, which applies the same
  `resolveInWorkspace` path gate as the Code screen, the secrets rule (no `.env*`/keys reads) and the step's write
  permission. Code runs on this Mac only — never on Cloudflare (repos are private; the app is local).
- The snippet's return value + logs (capped at 16 KB, truncated with a note) are the tool result. Errors come back as a
  short stack the model can fix on the next turn.
- A per-workflow/bot option `toolStyle: 'code' | 'json'` (default `code`; `json` keeps today's tools as a fallback for
  models that can't write code well), shown in the Builder inspector and the Crew "Runs on" section.
- Metrics: the run timeline records tool round-trips and tokens per step, so the saving is visible (compare `json` vs
  `code` on the same task).

**Later (not now)**: offer Tether's own abilities (Inbox ask, vault notes, handoffs) to vendor CLIs through a single
code-mode tool — that needs an MCP server and is a separate spec.

## 5. Testing (Code Mode)
- **Node**: TS-declaration generation from the API definition; sandbox limits (CPU timeout, memory, call cap) and escapes
  (no `require`, `process`, `fetch`, filesystem); path gate and secrets refusals via the bridge; write refused on a
  read-only step; `tether.ask` ends the step as a question; output truncation; `json` fallback unchanged; an end-to-end
  adapter test with a fake OpenAI-compatible server that answers with a `run_code` call and checks one round-trip
  replaces several.

## 6. Testing
- **Web**: sidebar layout and order (top items, Workspace, Runs glyphs by status, Favorites, Settings at bottom), G-key
  navigation (and not while typing), Inbox route and actions, collapse + peek + dock, fold state, account chip states,
  Accounts panel (CLI adopt, device-flow code display + polling states, disconnect).
- **Node**: accounts registry; `gh` adoption with a fake `gh`; device flow against a fake GitHub (pending → connected,
  expired, denied, slow_down); Keychain adapter with a fake `security` binary; token never present in any `/api/*`
  response; `GH_TOKEN` passed to `gh` commands for device-flow accounts; PKCE helper (verifier/challenge/state) and
  loopback callback validation.
- **Manual**: Chrome check of the sidebar in both themes on real data; on this Mac, adopt the existing `gh` login.

## 7. Out of scope
Hosted/multi-user accounts, a login screen, Clerk; Google/GitLab/Linear connections (registry only); per-project
accounts; GitHub App installation flow; changing vendor CLIs' tool use; an MCP server; running code on Cloudflare.
