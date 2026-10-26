# Linear-style sidebar and Connected accounts

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

## 4. Testing
- **Web**: sidebar layout and order (top items, Workspace, Runs glyphs by status, Favorites, Settings at bottom), G-key
  navigation (and not while typing), Inbox route and actions, collapse + peek + dock, fold state, account chip states,
  Accounts panel (CLI adopt, device-flow code display + polling states, disconnect).
- **Node**: accounts registry; `gh` adoption with a fake `gh`; device flow against a fake GitHub (pending → connected,
  expired, denied, slow_down); Keychain adapter with a fake `security` binary; token never present in any `/api/*`
  response; `GH_TOKEN` passed to `gh` commands for device-flow accounts; PKCE helper (verifier/challenge/state) and
  loopback callback validation.
- **Manual**: Chrome check of the sidebar in both themes on real data; on this Mac, adopt the existing `gh` login.

## 5. Out of scope
Hosted/multi-user accounts, a login screen, Clerk; Google/GitLab/Linear connections (registry only); per-project
accounts; GitHub App installation flow.
