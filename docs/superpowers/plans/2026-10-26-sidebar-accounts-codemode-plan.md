# Tether: Linear sidebar, Connected accounts, Code Mode

**Spec:** `docs/superpowers/specs/2026-10-26-linear-sidebar-and-accounts-design.md` (§2 sidebar, §3 accounts, §4–5 Code
Mode). **Mockup:** `docs/design/AppSidebarLinear.dc.html` tab A. **Branch:** `feature/linear-sidebar-accounts`.
**Order:** A sidebar → B accounts → C Code Mode runtime → D Code Mode delivery, one commit (or a few) per task.

## Spike results (2026-10-26)

### `@cloudflare/codemode` 0.5.5: not used; the same shape is built in-house

- The `Executor` contract itself is pluggable (`execute(code, providers) → { result, error?, logs? }`), so a local
  executor would fit.
- The main entry (`dist/index.js`) and the connector base (`CodemodeConnector extends WorkerEntrypoint`) import
  `cloudflare:workers` at module load. Node cannot import that scheme. `generateTypesFromJsonSchema`, `normalizeCode`,
  the truncation helpers and the `search`/`describe` connector all live behind it.
- The Node-importable entries do not cover what we need. `./browser` drops every tool with `needsApproval`, which
  breaks our approvals. `./ai` and `./tanstack-ai` need the `ai` / `@tanstack/ai` SDKs and still import the Workers base.
  `./mcp` pulls in zod and the cfworker JSON Schema validator. The useful chunks are hashed files the `exports` map
  hides.
- So Tether keeps the library's **shape**: providers are namespaces of async methods, JSON Schema becomes TypeScript
  declarations, `codemode.search()`/`codemode.describe()` discover methods, and the executor returns
  `{ result, error, logs }`. It is implemented in `src/codemode/`, so swapping in the library later is a small change.
- No `ai` or `zod` dependency is added.

### Sandbox: QuickJS works with async host calls

- Spike: `quickjs-emscripten-core` with the `@jitl/quickjs-wasmfile-release-sync` variant. Host functions return
  QuickJS promises (`ctx.newPromise()`), and the host pumps `executePendingJobs()` when they settle.
- Checked: `await`, `Promise.all` over host calls, `console.log` capture, an interrupt after a deadline
  (`InternalError: interrupted`), `setMemoryLimit` (`out of memory`), thrown errors with a stack, and a never-settling
  promise caught by a wall timer.
- `require`, `process`, `fetch` and `setTimeout` are all `undefined` inside the sandbox.
- Each `run_code` gets a fresh WASM module. A timed-out run is simply dropped (garbage-collected), so a half-disposed
  runtime can never trip QuickJS's GC assertion.
- Types are stripped with Node's `module.stripTypeScriptTypes` (present on Node 22.13+ and in Electron 45) and are
  never checked.

### Per-run MCP routes (from each installed CLI's `--help`)

| CLI | Installed | Per-run route | Tether does |
| --- | --- | --- | --- |
| Claude Code 2.1.310 | yes | `--mcp-config <file> --strict-mcp-config`, `--allowedTools`, `--disallowedTools`, `--append-system-prompt` | `code` via MCP |
| Codex | **no** | `codex exec -c mcp_servers.<name>.command=… -c mcp_servers.<name>.args=[…]` (its documented TOML override flag) | `code` via MCP, marked *not verified against an installed binary* like the existing `codexSpec` |
| OpenCode 2.0.20 | yes | none usable. `opencode debug config` shows only the global dir and a project `opencode.json`. `OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT` are not loaded as sources. A project file would have to be written into the shared run worktree: read-only steps share it concurrently, it could be committed, and it could clash with the repo's own file. | falls back to `direct`; the Crew card says so |
| Gemini | **no** | Tether has no Gemini adapter. A custom CLI adapter named gemini has no known route. | falls back to `direct`; the card says so |

## Dependencies (runtime, so they land in `dependencies` and in the packaged app)

- `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync` (0.32.0): the sandbox the spec names. This is the
  `quickjs-emscripten` project split so that only the one release variant ships (about 1.5 MB). The umbrella package
  carries all four builds (9 MB).
- `@modelcontextprotocol/sdk` (1.32.x): the stdio server for `run_code` (the protocol handshake, `tools/list`,
  `tools/call`). It is also the client for `mcp.<server>` connectors: stdio and Streamable HTTP, version negotiation.
  We do not hand-roll a protocol that many third-party servers must interoperate with.
  - Cost: it carries express/hono transitively (about 25 MB in `node_modules`). Only the server/client/stdio/HTTP
    modules are imported.

## Global Constraints

- Tokens and secrets never reach the browser or logs. `/api/accounts` returns only
  `{ provider, login, avatarUrl?, scopes, via, connectedAt }`. MCP header and env values are never returned (names
  only). The Code Mode session token lives in a 0600 file, never on argv or in env.
- The GitHub token is stored in the Keychain via the `security` CLI (service `dev.tether.app`, account `github`). Values
  go over stdin (`security -i`), never on argv. The store sits behind a `SecretStore` adapter: tests use a fake
  `security` binary, and other platforms use a 0600 file in `<home>/secrets/`.
- Users' global CLI configs are never edited. Per-run files go in a temp dir and are removed when the step ends.
- Code runs locally only (QuickJS in the Tether process).
  - Limits: 10 s wall, 64 MB, 200 connector calls, 16 KB result (with a truncation note).
  - `repo.*` goes through `resolveInWorkspace`, and secrets files are refused.
  - `repo.write` only works on writable steps.
  - GitHub comments/merges, unsafe HTTP methods and MCP tools flagged `destructiveHint` need approval: an approved
    upstream approval step or auto-approve, else an Inbox approval (team runs) or a refusal naming how to get one
    (workflow runs).
- Studio Live: no purple/indigo, no gradient or glow, ink primary buttons. Status colours: blue live, amber needs you,
  green done, red failed. Motion 150–280 ms with loops only for live state; reduced motion respected. Both themes, AA
  contrast. `rules.test.ts` stays green and its allow-list is never widened.
- Tests never touch `~/.aorch` or the owner's server on 4177. Scratch homes come from `mkdtemp`. The real `gh` login is
  never adopted or altered outside the manual check.
- Commits: conventional, staged by explicit path, no trailers, no push; never `.mockup/` or `.superpowers/`.

## Interfaces

```ts
// web — routes
type Screen = 'home' | 'inbox' | 'runs' | 'code' | 'builder' | 'crew' | 'api' | 'graph' | 'triggers';
useGoKeys(onGo: (s: Screen) => void, onCompose: () => void): void   // G+letter within 1 s; C = compose; not in fields
// src/accounts
interface SecretStore { get(account): Promise<string|undefined>; set(account, value): Promise<void>; delete(account): Promise<void> }
keychainStore(bin = 'security'): SecretStore; fileStore(home): SecretStore; defaultStore(home): SecretStore
PROVIDERS: ProviderDef[]   // { id, name, kind: 'device'|'pkce'|'cli', endpoints, scopes, available, note? }
publicAccounts(home): PublicAccount[]   // never a token
adoptGh(home, exec): Promise<PublicAccount>; startDevice(...)/deviceState(...); githubToken(home, deps)
ghExec(home, base?: Exec): Exec   // adds GH_TOKEN for `gh` when connected via device flow
pkcePair(): { verifier, challenge, state }; checkCallback(url, state): { code } | { error }
// src/codemode
jsonSchemaToTs(schema): string; signature(m: Method): string
interface Method { name; summary; params?: JSONSchema; returns?: string; write?: true; outside?: (args) => string | undefined; run(args, ctx) }
interface Connector { name; summary; methods(): Promise<Method[]> }
execute(code, call: (path, args) => Promise<unknown>, limits): Promise<{ result?; error?; logs; calls; truncated }>
class CodeSession { runCode(code): Promise<RunCodeOutput>; metrics(); asks(); description(); close() }
CodeModeHost.open(session) → { sessionFile, mcp: { command, args, env? }, close() }   // loopback, bearer token per session
mcpMain(sessionFile)   // stdio server with exactly one tool, run_code
// adapters
AgentRequest.codeMode?: { runner: CodeRunner; mcp?: McpLaunch; note: string; readsOnly?: boolean }
AgentAdapter.codeMode?: 'mcp' | 'native'
AgentResult.usage?: { inputTokens?; outputTokens?; toolCalls?; turns? }
PipelineNode.toolStyle?: 'code' | 'direct'; Binding.toolStyle?, Binding.codeReads?
event { type: 'node.metrics', node, toolStyle, roundTrips?, runCode, connectorCalls, inputTokens?, outputTokens? }
```

## Tasks

### A. Sidebar, Inbox route, G-key navigation
- Files:
  - `web/src/ui/studio/Sidebar.tsx` (rewritten, Linear), `SideParts.tsx` (rows, sections, menus),
    `RunGlyph.tsx`, `ProjectSwitcher.tsx`, `AccountRow.tsx`, `useGoKeys.ts`, `nav.ts` (spec icons, Inbox), `shell.css`
  - `web/src/hooks.ts` (`inbox` screen)
  - `web/src/home/Inbox.tsx` (NeedsYou on its own route)
  - `App.tsx` (hidden/peek/dock, compose, G keys, account chip)
  - `CommandMenu.tsx` (shortcut hints)
- Behaviour:
  - Layout: 244 px, 28 px rows.
  - Top: Search ⌘K, Home, Inbox (count), Runs (live count).
  - Workspace: six items with `G x` hints.
  - Runs section: live, then needs-you, then the last 5 finished, with status glyphs.
  - Favorites: pins with ⋯ unpin and drag reorder.
  - Bottom: Settings ⌘, and the account row.
  - Sections fold, and the fold state is remembered.
  - ⌘\ hides the sidebar, the left edge peeks it, and ☰ docks it.
  - Below 900 px the bottom bar is unchanged.
- Tests: `Sidebar.test.tsx` (rewritten), `useGoKeys.test.tsx`, `Inbox.test.tsx`, `hooks.test.tsx` (inbox route),
  `CommandMenu.test.tsx` (shortcuts), `App.test.tsx` (hide/peek/dock).

### B. Connected accounts
- Server files: `src/accounts/{registry,secretStore,store,github,pkce,routes}.ts`.
  - Wired via `server.ts`.
  - `pr.ts` / `cli.ts` / `server.ts` use `ghExec(home)`.
- Web files: `web/src/settings/Accounts.tsx` (Settings → Accounts), `SettingsDrawer.tsx` (section + scroll target), the
  sidebar account chip.
- Node tests: `accounts.test.ts`.
  - The registry.
  - `gh` adoption with a fake `gh` (logged in / out, `gh api user` failing).
  - Device flow against a fake GitHub: pending → connected, slow_down, expired, denied.
  - The Keychain adapter with a fake `security`.
  - A token never appears in any `/api/accounts*` response.
  - `GH_TOKEN` reaches `gh` for device accounts only.
  - PKCE pair and callback validation.
  - Device flow without a client id returns the setup explanation.
- Web tests: `Accounts.test.tsx` (CLI adopt, device code + polling states, disconnect, setup text), and account chip
  states in `Sidebar.test.tsx`.

### C. Code Mode runtime
- Files:
  - `src/codemode/{schema,catalog,sandbox,session,limits}.ts`
  - `src/codemode/connectors/{repo,tether,github,http,mcp}.ts`
  - `src/codemode/mcpServers.ts` (`<home>/mcp.json`, `/api/codemode/mcp`)
  - web: Settings → Tools "MCP servers" list/add/remove in `web/src/settings/McpServers.tsx`
- Tests: `codemode-runtime.test.ts`.
  - Schema → TS and search/describe.
  - Limits: timeout, memory, call cap.
  - Escapes: no `require`/`process`/`fetch`/fs.
  - Path gate and secrets refusals; write refused on a read-only step.
  - `tether.ask` ends the step as a question.
  - Approvals; truncation.
  - An MCP connector against a fake stdio MCP server (`test/fixtures/fake-mcp.mjs`).
  - The github connector through a fake exec.
- Web tests: `McpServers.test.tsx`.

### D. Code Mode delivery
- Files:
  - `src/codemode/{host,mcpMain,delivery,prompt}.ts`
  - `src/cli.ts` (`tether codemode-mcp --session <file>`)
  - `src/adapters/{claude,cli,openai}.ts`
  - `src/engine.ts` (session per step, asks/approvals back into the step, `node.metrics`)
  - `src/types.ts`, `src/bindings.ts`, `src/pipeline.ts` (`toolStyle`)
  - web: `builder/Inspector.tsx` (Tools: Code Mode / Direct), `crew/RunsOn.tsx` (+ "Code Mode only for reading", the
    fallback note), `api.ts` `describeEvent` (metrics line)
- Tests: `codemode-delivery.test.ts`.
  - The MCP server lists exactly one tool and runs a script end to end over stdio.
  - `claude.ts` args: `--mcp-config`, `--strict-mcp-config`, `--allowedTools mcp__tether__run_code`, plus
    `--disallowedTools Grep Glob` when chosen. `HOME` is untouched, and no file is written outside the temp dir.
  - `cli.ts` codex `-c` args. The opencode/custom fallback.
  - `openai.ts` with a fake server answering one `run_code` call.
  - `direct` unchanged.
  - Engine: `node.metrics` recorded; `tether.ask` → user ask.
- Web tests: the Inspector and RunsOn toggles, and the metrics line.

### Real checks
- Scratch-home server on a free port: check the sidebar in a browser.
- One Claude Code smoke run (model `haiku`) on a throwaway git repo with a scratch home. The read-only task should use
  `run_code`. Confirm from the stream that the tool list holds exactly one Tether tool and that `run_code` ran.
