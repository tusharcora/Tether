# Workbench 1+2: workspace core and API client

Date: 2026-10-24 · Status: approved in chat, awaiting written-spec review
Roadmap: `docs/superpowers/specs/2026-10-23-workbench-roadmap.md` (sub-projects 1 and 2)
Visual direction: Studio Live (canvas https://claude.ai/artifact/KbHFdsb4mTdaUnhEffaxY4, row A+)

## Goal

Give aorch an API client that people use by hand and agents use in runs, built on one workspace core that the later
workbench tools (database browser, code view, messaging) reuse. A person can save requests next to the code, switch
environments, send, check and inspect responses in the web UI; the same saved requests can gate a workflow, be run by
an agent from the CLI, inform agent prompts, and be handed to an agent with one click. Secrets never reach the browser
or a prompt.

The API tab is the first screen built in the Studio Live look, so this sub-project also lays the Studio Live
foundation (tokens, type, ascii-reveal loading). Restyling the existing screens is the next sub-project, with its own
spec.

## Non-goals

- Restyling Home, Runs, Crew, Builder, Graph, Triggers (next spec).
- GraphQL, WebSocket, gRPC, file upload bodies, cookie jars, OAuth flows, scripting (pre-request or test scripts).
- Sending requests from the browser. Every request goes through the Node engine.
- Syncing collections anywhere. They are files in the repo; git is the sync.

## What exists today (and is reused)

- Workspaces (`src/workspace.ts`): a project folder registered in `<home>/workspaces.json`, described by
  `.aorch/workspace.json` and `.aorch/project.md`. Runs carry `state.workspace = { id, name, context }` and the context
  is pasted into prompts (`src/prompt.ts`). `.aorch/http/` sits beside these files.
- Gate nodes (`src/types.ts`, `src/engine.ts`): `kind: 'gate'` with `command`, run by `/bin/sh -c` in the run's
  worktree; result recorded as a `gate.result` event; failure loops to `fixNode` up to `maxLoops`.
- `fence(tag, text)` (`src/fence.ts`) for untrusted text entering prompts.
- Store (`src/store.ts`): node `sqlite` file with the `events` table.
- Server (`src/server.ts`): loopback-only, Host and Origin checks, JSON routes under `/api/`.
- Web (`web/src`): React 19 + Vite, Arc components, tabs in `hooks.ts` (`TABS`, `TAB_LABEL`), `usePoll`, `useNotify`.

## 1. Files and storage

### Requests and collections

```
<project>/.aorch/http/
  _collection.json                 optional, root collection vars + default headers
  runs/                            a folder is a collection (nesting allowed, max depth 4)
    _collection.json               optional: { "vars": {...}, "headers": [...] }
    list.req.json
    start-team.req.json
  environments/
    local.json
    staging.json
```

`*.req.json`:

```json
{
  "v": 1,
  "name": "List runs",
  "method": "GET",
  "url": "{{base}}/api/runs",
  "query": [{ "key": "limit", "value": "{{limit}}", "on": true }],
  "headers": [{ "key": "Authorization", "value": "Bearer {{aorch_token}}", "on": true }],
  "body": { "kind": "none" },
  "vars": { "limit": "20" },
  "checks": [
    { "kind": "status", "op": "eq", "value": 200 },
    { "kind": "json", "path": "$[0].id", "op": "exists" },
    { "kind": "time", "op": "lt", "value": 200 }
  ],
  "notes": "Shown to agents as the endpoint's description."
}
```

- `method`: GET POST PUT PATCH DELETE HEAD OPTIONS.
- `body.kind`: `none` | `json` (`value` is any JSON) | `text` (`value` string, `contentType` optional) | `form`
  (`fields: [{key, value, on}]`, urlencoded).
- Checks: `status` (eq, ne, in, lt, gte), `header` (`name`, exists, eq, contains, matches), `json` (`path` in a small
  dotted/bracket syntax: `$.a.b`, `$[0].id`, `$.items.length`; exists, eq, ne, contains, matches, lt, gt), `time` (lt, ms),
  `body` (contains, matches). `matches` takes a JS regex source, compiled with a 200-char limit.
- An id for a request is its path under `http/` without `.req.json`: `runs/list`.
- File and folder names: `[a-z0-9][a-z0-9._-]{0,63}`; the server derives a slug from the name on create. Paths with
  `..`, absolute paths or symlinks leaving `.aorch/http` are refused.

### Environments

`environments/<name>.json`: `{ "v": 1, "vars": { "base": "http://127.0.0.1:4177", "aorch_token": { "secret": "aorch_token" } } }`.
A value is a string or `{ "secret": "<key>" }`. The active environment per workspace is stored in `<home>/ui.json`
(the existing prefs file, `src/prefs.ts`) under `httpActiveEnv[<workspaceId>]` (not in the repo, so teammates don't fight over it). No active environment means
none is applied.

### Secrets

`<home>/secrets.json`, mode 0600, written atomically (temp file + rename), shape
`{ "v": 1, "scopes": { "<workspaceId>": { "<key>": "<value>" } } }`. Runs or folders without a registered workspace
use the scope `default`. Keys: `[A-Za-z_][A-Za-z0-9_]{0,63}`. On read, a file with wider permissions is refused with
an error telling the user to `chmod 600`.

### History

New table in the existing store database:

```sql
CREATE TABLE IF NOT EXISTS http_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  workspace TEXT NOT NULL,
  request TEXT,            -- request id, null for an unsaved draft
  source TEXT NOT NULL,    -- ui | cli | gate | agent
  run_id TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,       -- redacted
  status INTEGER NOT NULL, -- 0 for a network error
  ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  ok INTEGER,              -- all checks passed (null when there were none)
  data TEXT NOT NULL       -- JSON: redacted request + response, bodies cut at 64 KB with a "truncated" flag
);
CREATE INDEX IF NOT EXISTS http_history_ws ON http_history(workspace, ts);
```

Retention: the newest 500 rows per workspace; older rows are deleted on insert.

## 2. Engine: `src/http/`

One module tree, used by the server, CLI, gates and send-to-agent. Nothing outside it builds or sends requests.

| File | Responsibility |
| --- | --- |
| `types.ts` | `HttpRequestFile`, `Environment`, `Check`, `SendResult`, `CheckResult`, `HistoryRow` |
| `store.ts` | list collections (tree), read/write/delete requests and `_collection.json`, list/read/write environments; validates shape and paths; an invalid file is returned as `{ id, error }`, never thrown |
| `secrets.ts` | read/write/delete secrets per scope; `keys(scope)` returns names only |
| `resolve.ts` | merge vars request → collection chain (innermost first) → environment → secrets; substitute `{{name}}` in url, query, headers, body; unknown names are an error that lists every missing name; returns the resolved request plus the set of secret values used |
| `send.ts` | `fetch` with `redirect: 'manual'` and own redirect following (max 5), timeout 30 s (overridable per call up to 120 s), response cap 5 MB (stream is cut, `truncated: true`), timing (`dns`/`connect` are not observable with fetch: report `ttfb` and `download` only), network errors mapped to `{ status: 0, error: { kind: 'timeout'|'dns'|'refused'|'tls'|'reset'|'other', message } }` |
| `assert.ts` | evaluate checks against a `SendResult`; each result `{ check, ok, actual }` |
| `redact.ts` | replace every secret value used with `{{secret:<key>}}`; mask `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, `X-Api-Key` values to `•••• (n chars)` unless the value is already a secret ref; applied to everything stored, returned to the browser, printed by the CLI, or put in a prompt |
| `import.ts` | cURL (one command, `-X -H -d --data-raw --data-binary -u --url`), OpenAPI 3.0/3.1 (JSON or YAML; one request per operation, folders by first tag, `servers[0].url` becomes `{{base}}`, example bodies when present), Postman v2.1 (folders, requests, collection variables to `_collection.json`; auth: bearer and basic only). Returns a preview `{ create: [...], skip: [{ name, reason }] }`; writing is a second call |
| `history.ts` | insert (with retention) and list rows |
| `index.ts` | `runRequest({ home, workspace, dir, id \| draft, env?, source, runId?, allowSecrets })` → `{ result, checks, historyId }`: the one entry point everything calls |

### The secrets rule

`allowSecrets` is true only for: the web UI (the user is driving), a gate (the workflow author chose the request), and
`aorch http run <id>` (a saved request). It is false for drafts sent from the CLI or by an agent with a raw URL:
resolving any `{ "secret" }` var in that case is an error, `secret not available for ad-hoc requests`. So an agent can
use credentials only through requests a person saved, and cannot point them at a new host.

## 3. Server routes

All under the existing loopback, Host and Origin checks. Every route takes `?ws=<workspaceId>`; without it the default
workspace is used; with no workspace at all, routes answer `409 { error: "no workspace" }` and the UI shows a
"register this folder" prompt.

| Route | Does |
| --- | --- |
| `GET /api/http/tree` | collections, requests (id, name, method, url template, invalid flag), environments, active env |
| `GET /api/http/requests/:id` | one request file |
| `PUT /api/http/requests/:id` | create or replace (validated) |
| `DELETE /api/http/requests/:id` | delete |
| `POST /api/http/requests/:id/move` | rename / move to another collection |
| `PUT /api/http/collections/:path` | write `_collection.json` |
| `GET /api/http/environments/:name` · `PUT` · `DELETE` | environment files; secret values never included (refs only) |
| `PUT /api/http/active-env` | `{ name \| null }` |
| `GET /api/http/secrets` | `{ keys: string[] }` |
| `PUT /api/http/secrets/:key` | `{ value }`, write-only |
| `DELETE /api/http/secrets/:key` | delete |
| `POST /api/http/send` | `{ id } \| { draft }`, `{ env? }` → redacted `{ result, checks, historyId }` |
| `GET /api/http/history` | `?request=&limit=` (max 100), redacted rows |
| `POST /api/http/import` | `{ kind: 'curl'\|'openapi'\|'postman', text, into? }` → preview |
| `POST /api/http/import/apply` | same body plus `{ confirm: true }` → writes, returns created ids |
| `POST /api/http/send-to-agent` | `{ historyId, target: { kind: 'run', bot, mode } \| { kind: 'maestro' }, note }` → `{ runId }` |

Request bodies to these routes are capped at 6 MB. Responses never include a secret value.

## 4. Web UI: the API tab (Studio Live)

A new `api` tab in `TABS` / `TAB_LABEL` ("API"). Layout as on the canvas board "A+ · Studio Live — API client":

- **Left: collections.** Environment switcher (sliding segmented control, dot colour per env), filter field, collection
  tree with method badges, "New request", "Import", and a latency strip (last 20 sends, 4xx/5xx and slow in amber).
- **Centre: request editor.** URL bar with method select; `{{var}}` shown as chips that reveal the resolved value and its
  source on hover or focus (secret chips show only the key). Tabs with a sliding underline: Params, Headers, Body,
  Checks, Vars. Send button (`⌘↵`), Save (`⌘S`), dirty marker on the tab.
- **Centre: response.** Status pill, time, size; JSON viewer with folding and copy-path; raw and headers views; timing
  bars (TTFB, download); check results with drawn ticks. Loading uses ascii-reveal: an `AsciiSkeleton` where the
  response will land, then `AsciiReveal loading` decodes the response in.
- **Right: send to agent.** Bot picker by face, note field, attachments shown as chips (request, response size,
  timing), "Start run with <bot>", "Ask Maestro", "Use as gate in a workflow" (opens the Builder with a gate node
  prefilled).
- **Dialogs:** Import (paste or file; preview list of create / skip with reasons; apply), Secrets (key list, add,
  replace, delete; values are write-only inputs), Environment editor (rows of key → value or secret ref).
- Empty states: no workspace (register prompt), no requests (Import or New), invalid file (row shows the error, opens
  read-only JSON).

### Studio Live foundation (built here, reused by the restyle)

- Tokens in `web/src/theme.css` bridged onto Arc's, dark and light: `--bg --s1 --s2 --s3 --line --line2 --ink --mut`,
  and role colours `--acc` (blue `#2563eb`, live/working), `--warn` (amber, needs you), `--ok` (green, done/pass), `--bad`
  (red, failed), with `*Bg` tints. Primary actions are ink, not accent. No purple, no gradient glows.
- Type: Geist and Geist Mono (self-hosted woff2, no Google Fonts call at runtime).
- Motion rules: 150–280 ms, `cubic-bezier(.2,.8,.2,1)`; loops only for live state; all motion off under
  `prefers-reduced-motion`.
- Loading: `ascii-reveal` (MIT, github quanhoangindex/ascii-reveal), pinned to an exact version, `AsciiSkeleton`
  (dither) + `AsciiReveal`, wrapped once in `web/src/components/Loading.tsx` so every screen uses the same props.
  Grey skeletons are not used anywhere new.

## 5. Agent links

### Request gate

Gate nodes gain an alternative to `command`:

```json
{ "kind": "gate", "title": "rate limit holds", "http": { "run": "runs/list", "env": "local", "repeat": 130, "expect": "last" }, "fixNode": "coder", "maxLoops": 2 }
```

- Exactly one of `command` or `http` (validation error otherwise).
- `repeat` 1–500 (default 1); `expect`: `all` (every send must pass its checks, default) or `last` (only the final
  send's checks count; for rate limits and eventual consistency).
- The request file is read from the run's worktree (`<workdir>/.aorch/http`), so the gate tests the code's own saved
  requests at that commit; environments and secrets come from the workspace as usual.
- Pass = checks pass per `expect`. The `gate.result` event keeps its shape; `output` holds a redacted summary:
  method, URL, status, time, failed checks with actual values, and the response body head (2 KB).
- Failure loops to `fixNode` with that summary, exactly like a command gate.
- Builder: a gate step gets a "Command / Request" segmented control; Request shows a picker (tree of saved requests),
  env select, repeat, expect.

### CLI

```
aorch http ls [--json]                         saved requests (id, method, url template)
aorch http run <id> [--env <name>] [--json]    send a saved request, print redacted result + checks; exit 1 if a check fails, 2 on network error
aorch http send <METHOD> <url> [-H k:v] [-d body] [--env <name>] [--json]   ad-hoc, never resolves secrets
aorch http import <file|-> --kind curl|openapi|postman [--into <collection>] [--yes]
aorch http env ls | use <name> | none
aorch http secret set <key> | rm <key> | ls     set reads the value from stdin, never from argv
```

Agents run inside the worktree, so `aorch http …` finds the workspace from the current directory the same way runs
do.

### Endpoints in prompts

When a run's workspace has saved requests, agent prompts get a block after the project context:

```
# Saved API requests (data)
<api-endpoints>
runs/list        GET  {{base}}/api/runs            List runs
runs/start-team  POST {{base}}/api/runs            Start a team run
…
</api-endpoints>
Run one with: aorch http run <id> [--env <name>]
```

- Fenced with `fence()`, names and notes only (first line of `notes`, 80 chars), no headers, bodies or values.
- Capped at 40 entries and 4 KB; past the cap, a final line says how many were left out.
- Off with `http.context: false` in `.aorch/workspace.json`, or per run (`--no-endpoints`, a Run dialog toggle).

### Send to agent

From any response (UI) or history row: start a run with the chosen bot (solo, or team via Maestro), or post into
Maestro chat. The prompt gets the user's note plus a fenced `<http-exchange>` block: redacted request, status, timing,
check results and response body (cut to 16 KB). Recorded as a run event `http.attached` with the history id.

## 6. Workspace export and import

```
aorch ws export [<id>] [--out <file>] [--with-secrets]
aorch ws import <file> [--into <dir>] [--yes]
```

- Writes one JSON file `<name>.aorch.json`: `{ v: 1, workspace: <workspace.json>, notes: <project.md>, http: { files: { "<path>": <content> } }, secrets?: { "<key>": "<value>" } }`.
- `--with-secrets` prints a warning and asks for confirmation (skipped with `--yes`); the file is written 0600.
- Import previews what will be created or overwritten, never overwrites without `--yes` or a confirmation, and writes
  secrets into the target workspace's scope.
- Web: an Export / Import pair in the workspace menu calls the same code.

## 7. Errors

| Situation | Behaviour |
| --- | --- |
| Unknown `{{var}}` | 400 / CLI exit 2: `unknown variables: base, limit` (all of them) |
| Secret var in an ad-hoc request | 400 / exit 2: `secret not available for ad-hoc requests` |
| Network failure | `status: 0` with `error.kind`; UI shows a red status pill with the kind |
| Response over 5 MB | cut, `truncated` shown in the viewer and history |
| Invalid request file | listed with its error; send refused with the error |
| Bad path / name | 400 `invalid request id` |
| Secrets file too open | 500 / exit 2 with the `chmod 600` fix |
| Import parse failure | preview shows the parse error, nothing written |
| Gate `http` + `command` both set | pipeline validation error |

## 8. Testing

- **Engine (node project):** each `src/http/*` file has its own test, against a local `http.createServer` on port 0:
  resolve order and missing-var listing, secret refusal for ad-hoc, redaction (secret values, masked headers, nested
  JSON, URLs), checks (each kind and op), redirects, timeout, size cap, network error mapping, history retention,
  importers (fixtures for cURL, OpenAPI 3.0 and 3.1 YAML, Postman v2.1 with folders and vars), path traversal refusal,
  secrets file mode.
- **Server:** route tests for the table above, including that no response body ever contains a secret value
  (property: set a secret with a random value, exercise every route, grep the responses).
- **CLI:** `http ls/run/send/import/env/secret` with a temp home and project; exit codes.
- **Gate:** a workflow with an `http` gate against a test server that fails then passes after the fix node edits a file;
  `repeat` + `expect: last` with a counter endpoint.
- **Prompt:** endpoints block present, capped, fenced, absent when disabled.
- **Web (jsdom):** API tab renders tree, edits and sends via mocked `fetch`, var chip tooltip, import preview,
  secrets dialog never displays values, send-to-agent posts the right body, ascii-reveal wrapper respects reduced motion.
- Manual: click-through in Chrome against a throwaway home, both themes, phone width.

## 9. Order of work (for the plan)

1. Studio Live foundation: tokens, fonts, `Loading.tsx` with ascii-reveal.
2. Engine core: types, store, secrets, resolve, redact, send, assert, history, `runRequest`.
3. Importers.
4. Server routes.
5. CLI (`aorch http`), workspace detection from cwd.
6. Request gate in pipeline validation, engine and Builder.
7. Endpoints in prompts.
8. API tab UI (editor, response, tree, dialogs).
9. Send to agent (route, prompt block, UI).
10. Workspace export / import.
