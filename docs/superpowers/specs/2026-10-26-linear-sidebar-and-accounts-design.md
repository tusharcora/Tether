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

## 4. Code Mode for every agent

Owner request (2026-10-26): all agents in Tether — Claude Code, Codex, OpenCode, Gemini and the OpenAI-compatible
models — use Cloudflare's **Code Mode** pattern for tool calls instead of many individual tools, for fewer tokens and
better efficiency. Code Mode (developers.cloudflare.com/agents/tools/codemode): the model gets **one code-execution
tool**; tools are exposed as **typed methods**; the model writes a short script that composes calls, loops, filters and
returns only what it needs; large catalogs are found on demand with **`codemode.search()`** and **`codemode.describe()`**
instead of loading every definition into context.

### 4.1 The Tether Code Mode runtime (one, shared)
- **Connectors** exposed as typed methods inside the sandbox:
  - `repo` — `list`, `read(path,{from,to})`, `search(pattern,{path,max})`, `diff()`, `write(path,text)` (write only on
    writable steps) — through the Code screen's `resolveInWorkspace` gate and secrets rule.
  - `tether` — `ask(question)` (Inbox; ends the step waiting, as asks do today), `note(text)`, `handoff(...)` (the existing
    handoff feature, where the step allows it), `vault.search/read/write`, `runs.list/get`.
  - `github` — via the connected account (§3): repos, PRs, issues, comments, checks.
  - `http` — run a saved API-client request by name (the API tab's collections, env + secrets resolved server-side).
  - **`mcp.<server>`** — every MCP server the owner configures in Settings → Tools (stdio or HTTP) becomes a connector;
    its tools become typed methods (JSON Schema → TypeScript). This is Cloudflare's MCP integration: agents never see
    those servers' tool lists, only the methods they discover and call.
- **Discovery**: `codemode.search(query)` returns matching connectors/methods (name + one line); `codemode.describe(target)`
  returns the TypeScript signature + docs. The tool description carries only the connector names and these two
  functions, so context stays small however many tools exist.
- **Sandbox**: generated JS/TS (types stripped, not checked) runs **locally** in a QuickJS WebAssembly sandbox
  (`quickjs-emscripten`, async host bridge): no filesystem, network, process or timers except through connectors;
  **10 s wall / 64 MB / 200 connector calls per run**; result (return value + `console.log`) capped at 16 KB with a
  truncation note; errors return a short stack. Never runs on Cloudflare — repos and secrets stay on this Mac.
- **Library**: use `@cloudflare/codemode` (0.5.x) for the tool → TypeScript generation, the `search`/`describe` shape and
  MCP-connector wiring **if** it accepts a custom (non-Workers) executor; its default executor needs Cloudflare's Worker
  Loader, so the implementer verifies first and otherwise implements the same shape in-house. Recorded in the plan.
- **Approvals**: connector methods that change things outside the repo (GitHub comments/merges, HTTP requests marked
  unsafe, MCP tools flagged destructive) require the step's existing approval gate or an Inbox approval.

### 4.2 How each agent gets it
- **Claude Code** (`claude.ts`): Tether writes a per-run MCP config and starts the agent with `--mcp-config <file>
  --strict-mcp-config`. The config points at **Tether's Code Mode MCP server** (stdio, `tether codemode-mcp --run <id>`),
  which exposes exactly **one tool, `run_code`**. `--strict-mcp-config` means the owner's own MCP servers reach Claude only
  as `mcp.*` connectors inside Code Mode, not as dozens of direct tools. Claude's built-in Read/Edit/Bash stay (they are its
  native editing loop); a per-bot option **"Code Mode only for reading"** also passes `--disallowedTools Grep Glob` so
  repository exploration goes through `repo.search`/`repo.read` in one script.
- **Codex, OpenCode, Gemini** (`cli.ts`): the same MCP server, registered through each CLI's MCP config mechanism (a
  per-run config file / flag, never editing the user's global config). CLIs without MCP support fall back to plain runs
  and the Crew card says so.
- **OpenAI-compatible models** (`openai.ts` — Ollama, LM Studio, llama.cpp, OpenRouter): `run_code` is offered natively in
  the adapter's own loop (no MCP hop) and replaces today's `list_files`/`read_file`/`search`/`write_file`.
- **Prompting**: every agent's system prompt gains a short Code Mode note (use `run_code` to compose several reads,
  searches and connector calls in one script; return only what is needed).
- **Option** per workflow step and per bot: `toolStyle: 'code' | 'direct'` (default `code`; `direct` = today's behaviour) in
  the Builder inspector and Crew "Runs on".
- **Metrics**: the run timeline records, per step, tool round-trips, `run_code` executions, connector calls and tokens, so
  the saving is visible (`direct` vs `code` on the same task).

## 5. Testing (Code Mode)
- **Node**: JSON Schema → TypeScript generation; `codemode.search`/`describe`; sandbox limits (timeout, memory, call cap)
  and escapes (no `require`, `process`, `fetch`, filesystem); path gate and secrets refusals via the bridge; write refused
  on a read-only step; `tether.ask` ends the step as a question; approvals required for outside-world connector calls;
  output truncation; an MCP connector against a fake stdio MCP server; the Code Mode MCP server lists exactly one tool and
  runs a script end to end; `claude.ts`/`cli.ts` build the per-run `--mcp-config` (+ `--strict-mcp-config`,
  `--disallowedTools` when chosen) without touching global config; `openai.ts` with a fake OpenAI-compatible server
  answering one `run_code` call in place of several direct calls; `direct` toolStyle unchanged.

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
accounts; GitHub App installation flow; removing vendor CLIs' built-in edit/shell tools; running code on Cloudflare.
