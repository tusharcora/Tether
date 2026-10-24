# aorch web as a workbench — roadmap

## Intent
Bring the ideas of adOmnia (adomnia-dev.com, github.com/Andrea-Cavallo/adOmnia, MIT) to the aorch web dashboard: the tools a developer otherwise uses separately (code editor, API client, database browser, messaging client) in one app that shares context, with no account, no telemetry, and workspace data kept locally unless exported. Decided with the user: both a general workbench **and** tools that share context with agent runs.

Each sub-project gets its own spec, plan and build.

## Order
0. Web on React + Arc — `2026-10-23-web-react-arc-design.md`
7–9. Crew track (Blobatar faces, ECC library, Maestro routing) — `2026-10-23-crew-track-design.md`
1+2. Workspace core and API client (next spec)
3. Database browser: Postgres, MySQL, SQLite first; Mongo, Redis later
4. Code view: Monaco editor and file tree over a repo or a run worktree, xterm terminal, git diff
5. Messaging client: Kafka, RabbitMQ, MQTT, NATS publish/consume with one shared log
6. Project scan and Ctrl-K entity router: routes, tables, topics, `.env` values found in the repo, opened in any tool

## Decisions already made for 1+2 (to carry into its spec)
- Collections and non-secret environments live in the repo: `<project>/.aorch/http/` (folder = collection, one `*.req.json` per request, `environments/*.json`). Secret values live in `<home>/secrets.json` (0600) and files hold `{ "secret": "<key>" }` references. History in the sqlite DB, redacted.
- One Node-side HTTP engine (`src/http/`: store, resolve, send, assert, import, redact) used by the web UI, the CLI, gates and send-to-agent. The browser never sends requests or sees secrets.
- Agent links, all in v1: a request gate (`http: { run, env }` on gate nodes, failures loop to `fixNode`); `aorch http run|ls` for agents to call; saved endpoints as prompt context (capped, can be turned off); "send to agent" from a response.
- Own JSON format with cURL, OpenAPI 3 and Postman v2.1 import. `.aorch` workspace export bundles `http/` and, only if asked, secrets.
- Loopback-only server, same `Host`/`Origin` checks.

## Out of scope for now
adOmnia's debuggers, profilers, load testing, gRPC/SOAP, mock server and proxy, power tools, plugins, LAN collaboration.
