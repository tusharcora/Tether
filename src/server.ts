import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { AdapterRegistry } from './adapters/index.js';
import { listPipelines, pipelinesDir, readPipeline, writePipeline, type Config } from './config.js';
import type { Engine } from './engine.js';
import { CREW, CREW_STYLES, lookPixels, refreshCrew } from './bots.js';
import { GLYPHS, SHAPES, initialsOf, shapeOf, symbolOf } from './marks.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { BOT_ID_RE, BUILTIN_IDS, KIND_BLURB, LOOK_PARTS, BOT_KINDS, loadCrew, removeBot, sanitizeBot, saveBot, type BotDef } from './crew.js';
import { PACKS, findPack, reid } from './packs.js';
import { alreadyRan, fetchPr, loadSettings, matchRule, parseWebhook, saveSettings, startPrRun, verifySignature, type Exec } from './pr.js';
import { GithubAccount, ghExec } from './accounts/github.js';
import { NvidiaAccount, type NvidiaDeps } from './accounts/nvidia.js';
import { OpenRouterAccount, type OpenRouterDeps } from './accounts/openrouter.js';
import { accountsRoute } from './accounts/routes.js';
import { knownSize } from './assistant/context.js';
import { assistantRoute } from './assistant/routes.js';
import { isOpenRouter } from './openrouter.js';
import { codemodeRoute } from './codemode/routes.js';
import { Goals } from './goals/loop.js';
import { goalsRoute } from './goals/routes.js';
import { teamsRoute } from './teams/routes.js';
import { OWNER } from './teams/store.js';
import { Teams } from './teams/teams.js';
import { checkWorkflow, classifyFailure, dryRunVerdict, ensureIds, ensureWebhookSecret, findRule, lastDelivery, parsePrTarget, refusal, readDeliveries, recordDelivery, triggerStatus, upsertRule, webhookSetupInfo } from './triggers.js';
import { aorchHomeMessage, getWorkspace, initWorkspace, isAorchHome, listWorkspaces, removeWorkspace, type Workspace } from './workspace.js';
import { checkPins, loadPins, savePins } from './pins.js';
import { rgVersion } from './tools.js';
import { BundleError, applyBundle, bundleFileName, exportWorkspace, parseBundle, planBundleImport, type Bundle } from './wsexport.js';
import { link, loadBindings, unlink } from './bindings.js';
import { anyUsable } from './providers.js';
import { commitDiff, diffCommitted } from './git.js';
import { NAME_RE, normalizePipeline, preflight } from './pipeline.js';
import type { Store } from './store.js';
import { ACTIVITY_LIMIT, ACTIVITY_MAX, activityFeed, parseCursor } from './activityFeed.js';
import { attentionReader } from './attention.js';
import { PREVIEW_TASK_MAX, rosterPreview } from './rosterPreview.js';
import { rowLive } from './runLabels.js';
import { VAULT_ACTIVITY_LIMIT, VAULT_ACTIVITY_MAX, vaultActivity } from './vaultActivity.js';
import { rowExtras } from './runRows.js';
import { planWaiting, type Answer, type RunState } from './types.js';
import { MAX_ANSWER_TEXT, TEAM_MAX_BUDGET_USD, TeamError, cleanAnswerText } from './team.js';
import type { Vault } from './vault.js';
import { adopt, decline, EvolveOpError, evolveSummary, findBot, harnessView, lessonView, proposalsFor, proposalView, revert, scrubPaths } from './evolveops.js';
import { listProposals } from './evolve.js';
import { peekHarness } from './harness.js';
import { loadLessons, type Lesson } from './lessons.js';
import { eccInfo, gitFetch, importEcc, removeEcc, type Fetch } from './eccImport.js';
import { aorchSkills, eccSkillPrompt, eccSkills, findSkill } from './skills.js';
import { ECC_REF } from './ecc.js';
import { HttpError, readJson, reqObject, send } from './serverkit.js';
import { httpRoute } from './http/routes.js';
import { codeRoute } from './codeRoutes.js';
import { HttpClientError, statusFor } from './http/errors.js';

export interface ServerOptions {
  engine: Engine;
  store: Store;
  vault: Vault;
  registry: AdapterRegistry;
  cfg: Config;
  host?: string;
  port?: number;
  /** Directory of the built dashboard. Optional: the API works without it. */
  webDir?: string;
  /** Runs `gh`/`git` for PR triggers; tests replace it. */
  exec?: Exec;
  /** Fetches the ECC checkout for `POST /api/crew/import`; defaults to cloning it. Tests copy a fixture instead. */
  eccFetch?: Fetch;
  /** The GitHub account behind Settings → Accounts; tests give one with a fake `gh`, GitHub and Keychain. */
  github?: GithubAccount;
  /** The OpenRouter account's exchange and secret store; tests fake both. */
  openrouter?: OpenRouterDeps;
  /** The NVIDIA account's API and secret store; tests fake both. */
  nvidia?: NvidiaDeps;
}

/** Imported personas can be 24 000 chars; the crew list sends at most this much of each (a save keeps the rest). */
const LIST_PERSONA_MAX = 2000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const MAX_LIST = 20;
/** A workspace as the pickers, the sidebar and Open folder… see it. */
const wsRow = (w: Workspace) => ({ id: w.id, name: w.name, path: w.path, isDefault: !!w.isDefault, exists: w.exists, repos: w.repos });
/** Optional single-line string, trimmed; empty means absent. */
function reqString(b: Record<string, unknown>, k: string, max = 200): string | undefined {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `"${k}" must be a string`);
  const t = v.trim();
  if (/[\n\r]/.test(t)) throw new HttpError(400, `"${k}" must be a single line`);
  if (t.length > max) throw new HttpError(400, `"${k}" is too long (max ${max})`);
  return t || undefined;
}
function reqBool(b: Record<string, unknown>, k: string): boolean | undefined {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new HttpError(400, `"${k}" must be true or false`);
  return v;
}
/** Optional list of short strings, as an array or a comma-separated string; returned comma-joined. */
function reqList(b: Record<string, unknown>, k: string): string | undefined {
  const v = b[k];
  if (v === undefined || v === null) return undefined;
  const items = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : (() => { throw new HttpError(400, `"${k}" must be an array of strings`); })();
  const out: string[] = [];
  for (const x of items) {
    if (typeof x !== 'string') throw new HttpError(400, `"${k}" must be an array of strings`);
    const t = x.trim();
    if (!t) continue;
    if (t.length > 64 || /[\n\r]/.test(t)) throw new HttpError(400, `"${k}" has an entry that is too long or not one line`);
    out.push(t);
  }
  if (out.length > MAX_LIST) throw new HttpError(400, `"${k}" has too many entries (max ${MAX_LIST})`);
  return out.length ? out.join(',') : undefined;
}
const idParam = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'malformed id');
  }
};

/** Map an Evolve refusal to an HTTP status by its code. The message never carries this machine's paths (home becomes <home>; other fs errors get a fixed text and are logged here). */
function evolveError(e: unknown, home: string): HttpError {
  if (e instanceof HttpError) return e;
  const raw = (e as Error)?.message ?? String(e);
  const fsErr = typeof (e as NodeJS.ErrnoException)?.code === 'string' && /^E[A-Z]+$/.test((e as NodeJS.ErrnoException).code!);
  if (e instanceof EvolveOpError) return new HttpError(e.code === 'invalid' ? 400 : e.code === 'not_found' ? 404 : 409, scrubPaths(raw, home));
  console.error(`[aorch] evolve: ${raw}`);
  return new HttpError(500, fsErr ? `could not read or write the harness files (${(e as NodeJS.ErrnoException).code})` : scrubPaths(raw, home));
}

const MAX_ANSWERS = 20;
/** Map an engine refusal on a team route to an HTTP status by its code. Anything the engine did not mean to refuse is a 500. */
/**
 * Workspace export/import failures: a bad bundle or target (BundleError) is the caller's (400); a store refusal keeps
 * its status (400/404/409/413, and 500 with the chmod fix for a secrets file that is too open); anything else, from a
 * file-system error to a bug, is ours: 500 with the message.
 */
export function bundleError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof BundleError) return new HttpError(400, e.message);
  if (e instanceof HttpClientError) return new HttpError(statusFor(e.code), e.message);
  return new HttpError(500, e instanceof Error ? e.message : String(e));
}

function teamError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  const msg = (e as Error).message;
  if (!(e instanceof TeamError)) return new HttpError(500, msg);
  switch (e.code) {
    case 'unknown_run':
      return new HttpError(404, msg);
    case 'not_team':
    case 'unknown_question':
    case 'invalid':
      return new HttpError(400, msg);
    case 'already_answered':
    case 'conflict':
      return new HttpError(409, msg);
    case 'resume_failed':
      return new HttpError(500, msg);
  }
}
/**
 * Check the whole batch against the run's pending cards before anything is applied: shapes, known cards, valid options,
 * free text only where the card allows it. Already answered cards are 409.
 */
function checkAnswers(body: unknown, s: RunState): Answer[] {
  const b = reqObject(body);
  if (s.status !== 'running' && s.status !== 'paused') throw new HttpError(409, `this run is not active (${s.status})`);
  if (!Array.isArray(b.answers) || !b.answers.length) throw new HttpError(400, '"answers" must be a non-empty array');
  if (b.answers.length > MAX_ANSWERS) throw new HttpError(400, `too many answers (max ${MAX_ANSWERS})`);
  const out: Answer[] = [];
  const seen = new Set<string>();
  for (const a of b.answers) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new HttpError(400, 'each answer must be an object');
    const r = a as Record<string, unknown>;
    if (typeof r.question !== 'string' || !r.question) throw new HttpError(400, 'each answer needs a "question" id');
    if (r.option !== undefined && typeof r.option !== 'string') throw new HttpError(400, '"option" must be a string');
    if (r.text !== undefined && typeof r.text !== 'string') throw new HttpError(400, '"text" must be a string');
    if (typeof r.text === 'string' && r.text.length > MAX_ANSWER_TEXT) throw new HttpError(400, `"text" is too long (max ${MAX_ANSWER_TEXT})`);
    if (seen.has(r.question)) throw new HttpError(400, `question "${r.question}" is answered twice in one request`);
    seen.add(r.question);
    const q = s.pending.find((x) => x.id === r.question);
    if (!q) {
      const answered = s.answers.some((x) => x.question === r.question) || (s.userAsks ?? []).some((x) => x.question.id === r.question && x.answer);
      throw new HttpError(answered ? 409 : 400, answered ? `already answered: ${r.question}` : `unknown question: ${r.question}`);
    }
    const text = cleanAnswerText(r.text);
    if (r.option !== undefined && !q.options.some((o) => o.id === r.option)) throw new HttpError(400, `"${r.option}" is not an option of ${q.id}`);
    if (r.option === undefined && !text) throw new HttpError(400, `${q.id} needs an "option" or "text"`);
    if (r.option === undefined && !q.allowOther) throw new HttpError(400, `${q.id} does not take free text; pick one of its options`);
    out.push({ question: q.id, ...(r.option !== undefined ? { option: r.option as string } : {}), ...(text ? { text } : {}), by: 'user' });
  }
  // planning cards come before any worker's question, so a batch never holds both; a worker's question needs a live or paused run
  const asks = new Set((s.userAsks ?? []).map((a) => a.question.id));
  const nAsks = out.filter((a) => asks.has(a.question)).length;
  if (nAsks && nAsks !== out.length) throw new HttpError(400, 'answer planning cards and worker questions in separate requests');
  if (nAsks && s.status !== 'running' && s.status !== 'paused') throw new HttpError(409, `this run is not active (${s.status})`);
  return out;
}

const isLoopback = (h: string) => h === '127.0.0.1' || h === '::1' || h === 'localhost' || h === '[::1]';

/** Host header must name a loopback host: blocks DNS-rebinding against a loopback-bound server. */
function hostOk(req: IncomingMessage): boolean {
  const h = req.headers.host;
  if (!h) return false;
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
  return isLoopback(name);
}

/** State-changing requests must come from this origin (or from a non-browser client with no Origin). */
function originOk(req: IncomingMessage): boolean {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const u = new URL(o);
    return isLoopback(u.hostname) && u.host === req.headers.host;
  } catch {
    return false;
  }
}

async function readRaw(req: IncomingMessage, max = 5_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new HttpError(413, 'request body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function startServer(o: ServerOptions): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const host = o.host ?? '127.0.0.1';
  if (!isLoopback(host) && process.env.AORCH_ALLOW_REMOTE !== '1') {
    throw new Error(
      `refusing to bind ${host}: this API starts agents and writes files with no authentication. ` +
        'Bind loopback, or set AORCH_ALLOW_REMOTE=1 if you have put authentication in front of it.',
    );
  }
  const { engine, store, vault, registry, cfg } = o;
  const attention = attentionReader(store);
  // a team's loop starts its runs through its team (made just below; the hooks are only called after both exist)
  const goals: Goals = new Goals({ home: cfg.home, store, engine, registry, hooks: { start: (g, p) => teams.loopRun(g, p), blocked: (g) => teams.blocked(g) } });
  const github = o.github ?? new GithubAccount(cfg.home, { exec: o.exec });
  /** `gh` for PR triggers, with the connected account applied (GH_TOKEN for a device-flow sign-in). */
  const exec = o.exec ?? ghExec(cfg.home);
  const teams: Teams = new Teams({ home: cfg.home, store, engine, registry, goals, vault, exec });
  type Detected = { ok: boolean; version?: string; detail?: string; reportsCost: boolean; supportsResume: boolean };
  let doctorCache: { at: number; data: Record<string, Detected> } | undefined;
  /** Each adapter's detect() result (installed, version), kept for 30 s. */
  async function doctor() {
    if (!doctorCache || Date.now() - doctorCache.at > 30_000) {
      const out: Record<string, Detected> = {};
      for (const id of registry.ids()) out[id] = { ...(await registry.get(id).detect()), reportsCost: registry.get(id).reportsCost, supportsResume: registry.get(id).supportsResume };
      doctorCache = { at: Date.now(), data: out };
    }
    return doctorCache.data;
  }
  let modelsCache: { at: number; data: Record<string, { ok: boolean; version?: string; detail?: string; models: string[] }> } | undefined;
  // connecting or disconnecting adds or cuts off an agent: the cached health and model lists go
  const dropCaches = () => void ((doctorCache = undefined), (modelsCache = undefined));
  const openrouter = new OpenRouterAccount(cfg, registry, { usable: async () => anyUsable(cfg, await doctor()), ...o.openrouter, onChange: dropCaches });
  const nvidia = new NvidiaAccount(cfg, registry, { ...o.nvidia, onChange: dropCaches });
  /** The answering model's context size and free-tier limit, for the chat's context ring. */
  const modelInfo = async (agent: string, model?: string): Promise<{ size?: number; limit?: 'openrouter' | 'nvidia' }> => {
    const base = cfg.endpoints[agent]?.baseUrl ?? '';
    if (agent === 'openrouter' || isOpenRouter(base)) {
      const size = model ? (await openrouter.models()).models.find((m) => m.id === model)?.context : undefined;
      return { ...(size ? { size } : {}), ...(model?.endsWith(':free') ? { limit: 'openrouter' } : {}) };
    }
    let host = '';
    try {
      host = new URL(base).hostname;
    } catch {
      /* not an endpoint */
    }
    return { size: knownSize(agent, model), ...(host === 'nvidia.com' || host.endsWith('.nvidia.com') ? { limit: 'nvidia' } : {}) };
  };

  const runView = (id: string) => {
    const s = store.state(id);
    if (!s) throw new HttpError(404, `unknown run ${id}`);
    const live = rowLive(engine, { id, kind: s.kind, status: s.status, pending: s.pending.length, planReady: planWaiting(s), lastTs: store.lastTs(id) });
    return { ...s, live };
  };


  /** GitHub pull_request webhook. Reachable through a tunnel, so it skips the loopback Host/Origin checks and is authenticated by the HMAC signature instead. */
  async function githubWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const secret = process.env.AORCH_WEBHOOK_SECRET || loadSettings(cfg.home).webhookSecret || '';
    if (!secret) throw new HttpError(503, 'no webhook secret set. Run: aorch pr secret');
    const raw = await readRaw(req);
    if (!verifySignature(secret, raw, req.headers['x-hub-signature-256'] as string | undefined)) throw new HttpError(401, 'bad signature');
    const event = req.headers['x-github-event'] as string | undefined;
    if (event === 'ping') return send(res, 200, { ok: true, pong: true });
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'not JSON');
    }
    const at = () => new Date().toISOString();
    const pr = parseWebhook(event, body);
    if (!pr) {
      return send(res, 202, { ignored: 'not a pull_request event' });
    }
    const rules = loadSettings(cfg.home).rules ?? [];
    const rule = matchRule(rules, pr);
    if (!rule) {
      // only worth a log line when a trigger for this repo listens for this action and still said no; everything else is noise
      const no = refusal(rules, pr);
      if (no) recordDelivery(cfg.home, { at: at(), trigger: no.rule.id, source: 'webhook', repo: pr.repo, pr: pr.number, outcome: 'ignored', reason: no.why });
      return send(res, 202, { ignored: 'no rule matches' });
    }
    refreshCrew(cfg.home);
    const ref = { provider: 'github' as const, repo: pr.repo, number: pr.number, url: `https://github.com/${pr.repo}/pull/${pr.number}` };
    // answer GitHub at once (it gives up after 10s); the run goes on in the background
    startPrRun({ home: cfg.home, engine }, ref, { workflow: rule.workflow, comment: rule.comment, workspace: rule.workspace, agent: rule.agent, model: rule.model })
      .then((r) => {
        recordDelivery(cfg.home, { at: at(), trigger: rule.id, source: 'webhook', repo: pr.repo, pr: pr.number, outcome: 'started', runId: r.runId });
        console.error(`[aorch] PR ${pr.repo}#${pr.number} -> run ${r.runId} (${rule.workflow})`);
      })
      .catch((e: Error) => {
        recordDelivery(cfg.home, { at: at(), trigger: rule.id, source: 'webhook', repo: pr.repo, pr: pr.number, outcome: classifyFailure(e.message), reason: e.message.slice(0, 300) });
        console.error(`[aorch] PR ${pr.repo}#${pr.number} skipped: ${e.message}`);
      });
    return send(res, 202, { accepted: true, workflow: rule.workflow });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;
    const m = req.method ?? 'GET';
    let g: RegExpMatchArray | null;
    if (p.startsWith('/api/http/')) return httpRoute({ home: cfg.home, store, engine }, req, res, url);
    if (p.startsWith('/api/code/')) return codeRoute({ home: cfg.home, store, engine }, req, res, url);
    if (p === '/api/accounts' || p.startsWith('/api/accounts/')) return accountsRoute({ home: cfg.home, github, openrouter, nvidia }, req, res, url);
    if (p === '/api/assistant' || p.startsWith('/api/assistant/'))
      return assistantRoute({ home: cfg.home, store, engine, registry, vault, needs: () => attention.items((r, lastTs) => rowLive(engine, { ...r, lastTs })), modelInfo, goals }, req, res, url);
    if (p.startsWith('/api/codemode/')) return codemodeRoute(cfg.home, req, res, url, github);
    if (p === '/api/goals' || p.startsWith('/api/goals/')) return goalsRoute({ home: cfg.home, store, goals }, req, res, url);
    if (p === '/api/teams' || p.startsWith('/api/teams/') || p.startsWith('/api/agents/')) return teamsRoute({ home: cfg.home, teams, vault }, req, res, url);
    if (p === '/api/runs' && m === 'POST') refreshCrew(cfg.home);

    if (p === '/api/health' && m === 'GET') {
      return send(res, 200, { ok: true, adapters: registry.ids(), vault: vault.root, home: cfg.home }), true;
    }
    if (p === '/api/doctor' && m === 'GET') return send(res, 200, await doctor()), true;
    if (p === '/api/tools' && m === 'GET') {
      // the mock adapter is for tests and demos, not a tool to install
      const agents = Object.entries(await doctor())
        .filter(([id]) => id !== 'mock')
        .map(([id, d]) => ({ id, ok: d.ok, ...(d.version ? { version: d.version } : {}) }));
      const rg = rgVersion();
      return send(res, 200, { agents, rg: { ok: !!rg, ...(rg ? { version: rg } : {}) } }), true;
    }
    if (p === '/api/pins' && m === 'GET') return send(res, 200, { pins: loadPins(cfg.home) }), true;
    if (p === '/api/pins' && m === 'PUT') {
      const pins = checkPins(await readJson(req));
      savePins(cfg.home, pins);
      return send(res, 200, { pins }), true;
    }

    // ---- crew: bot <-> agent/model links (read live by the engine at every run start) ----
    if (p === '/api/bots' && m === 'GET') {
      if (!modelsCache || Date.now() - modelsCache.at > 30_000) {
        const out: Record<string, { ok: boolean; version?: string; detail?: string; models: string[]; codeMode: 'mcp' | 'native' | null }> = {};
        await Promise.all(
          registry.ids().map(async (id) => {
            const a = registry.get(id);
            const d = await a.detect();
            let models: string[] = [];
            if (d.ok && a.listModels) {
              try {
                models = (await a.listModels()).slice(0, 200);
              } catch {
                /* best effort */
              }
            }
            out[id] = { ok: d.ok, version: d.version, detail: d.detail, models, codeMode: a.codeMode ?? null };
          }),
        );
        modelsCache = { at: Date.now(), data: out };
      }
      refreshCrew(cfg.home);
      const b = loadBindings(cfg.home);
      const crew = Object.entries(CREW).map(([role, c]) => ({ role, name: c.name, title: c.title, kind: c.def?.kind ?? 'agent', binding: b[role] ?? null }));
      return send(res, 200, { crew, escalate: b.escalate ?? null, agents: modelsCache.data }), true;
    }
    if ((g = p.match(/^\/api\/bots\/([a-z][a-z0-9_-]{0,31})$/))) {
      const role = g[1]!;
      if (role !== 'escalate' && !(role in CREW)) throw new HttpError(404, `unknown bot "${role}"`);
      refreshCrew(cfg.home);
      if (CREW[role]?.def?.kind === 'approval') throw new HttpError(400, `${CREW[role]!.name} is a person, not a model`);
      if (m === 'PUT') {
        const body = await readJson(req);
        const agent = typeof body.agent === 'string' ? body.agent : '';
        if (!registry.ids().includes(agent)) throw new HttpError(400, `unknown agent "${agent}"`);
        const model = typeof body.model === 'string' ? body.model.trim() : '';
        if (model.length > 200 || /[\n\r]/.test(model)) throw new HttpError(400, 'invalid model name');
        if (body.toolStyle !== undefined && body.toolStyle !== 'code' && body.toolStyle !== 'direct') throw new HttpError(400, '"toolStyle" must be "code" or "direct"');
        link(cfg.home, role, { agent, ...(model ? { model } : {}), ...(body.toolStyle === 'direct' ? { toolStyle: 'direct' as const } : {}), ...(body.codeReads === true ? { codeReads: true } : {}) });
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        unlink(cfg.home, role);
        return send(res, 200, { ok: true }), true;
      }
    }

    // ---- crew roster: the bots themselves (looks, personas), built-in and your own ----
    if (p === '/api/crew' && m === 'GET') {
      const px = (b: BotDef) => ({ ...b, ...(b.source && b.persona.length > LIST_PERSONA_MAX ? { persona: b.persona.slice(0, LIST_PERSONA_MAX), personaTruncated: true } : {}), pixels: lookPixels(b.look), mark: { shape: shapeOf(b.id), symbol: symbolOf(b.name), initials: initialsOf(b.name) } });
      const style = loadPrefs(cfg.home).crew ?? 'pebble';
      const crewNow = loadCrew(cfg.home);
      const evo = evolveSummary(cfg.home, crewNow.map((b) => b.id));
      return send(res, 200, { evolve: evo, style, styles: Object.entries(CREW_STYLES).filter(([k]) => k !== 'classic').map(([id, blurb]) => ({ id, blurb })), shapes: SHAPES, glyphs: GLYPHS, bots: loadCrew(cfg.home).map(px), packs: PACKS.map((k) => ({ id: k.id, name: k.name, blurb: k.blurb, bots: k.bots.map(px) })), parts: LOOK_PARTS, kinds: BOT_KINDS.map((k) => ({ kind: k, blurb: KIND_BLURB[k] })), ecc: eccInfo(cfg.home) ?? null, eccDefault: ECC_REF }), true;
    }
    if (p === '/api/crew/style' && m === 'PUT') {
      const style = String((await readJson(req)).style ?? '');
      if (!(style in CREW_STYLES)) throw new HttpError(400, `unknown style "${style}"; options: ${Object.keys(CREW_STYLES).join(', ')}`);
      savePrefs(cfg.home, { crew: style });
      return send(res, 200, { style }), true;
    }
    if (p === '/api/crew/preview' && m === 'POST') {
      const { bot, error } = sanitizeBot({ id: 'preview', name: 'preview', kind: 'agent', ...(await readJson(req)) });
      if (!bot) throw new HttpError(400, error ?? 'invalid look');
      return send(res, 200, lookPixels(bot.look)), true;
    }
    if ((g = p.match(/^\/api\/crew\/packs\/([a-z0-9-]{1,24})$/)) && m === 'POST') {
      const pack = findPack(g[1]!) ?? (() => { throw new HttpError(404, 'unknown pack'); })();
      const have = loadCrew(cfg.home).filter((b) => !b.source);
      if (have.length + pack.bots.length > 67) throw new HttpError(400, 'too many bots; remove some first');
      const fresh = reid(pack.bots, new Set(have.map((b) => b.id)));
      for (const b of fresh) saveBot(cfg.home, b);
      refreshCrew(cfg.home);
      return send(res, 200, { added: fresh.map((b) => b.id) }), true;
    }
    if (p === '/api/crew/import' && m === 'POST') {
      const b = (await readJson(req)) as { source?: unknown; ref?: unknown };
      if (b.source !== 'ecc') throw new HttpError(400, 'source must be "ecc"');
      const ref = typeof b.ref === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(b.ref) ? b.ref : undefined;
      const diff = await importEcc(cfg.home, { ref, fetch: o.eccFetch ?? gitFetch });
      refreshCrew(cfg.home);
      return send(res, 200, diff), true;
    }
    if (p === '/api/crew' && m === 'DELETE') {
      if (url.searchParams.get('source') !== 'ecc') throw new HttpError(400, 'source must be "ecc"');
      const removed = removeEcc(cfg.home);
      refreshCrew(cfg.home);
      return send(res, 200, { removed }), true;
    }
    if (p === '/api/skills' && m === 'GET') {
      const src = url.searchParams.get('source');
      const all = [...aorchSkills(cfg.home), ...eccSkills(cfg.home)].filter((s) => !src || s.source === src);
      return send(res, 200, all.map((s) => ({ name: s.name, description: s.description, source: s.source, ...(s.kind ? { kind: s.kind } : {}) }))), true;
    }
    if ((g = /^\/api\/skills\/ecc\/([A-Za-z0-9][A-Za-z0-9:_.-]{0,63})$/.exec(p)) && m === 'GET') {
      const skill = findSkill(eccSkills(cfg.home), `ecc:${g[1]}`);
      if (!skill) throw new HttpError(404, 'no such ECC skill');
      return send(res, 200, { name: skill.name, prompt: eccSkillPrompt(skill) }), true;
    }
    if ((g = p.match(/^\/api\/crew\/([a-z][a-z0-9_-]{0,23})$/))) {
      const id = g[1]!;
      if (!BOT_ID_RE.test(id)) throw new HttpError(400, 'bad id');
      if (m === 'GET') {
        // the full saved bot, for the editor: the list truncates long imported personas
        const bot = loadCrew(cfg.home).find((b) => b.id === id);
        if (!bot) throw new HttpError(404, 'no such bot');
        return send(res, 200, bot), true;
      }
      if (m === 'PUT') {
        const crewNow = loadCrew(cfg.home);
        const was = crewNow.find((b) => b.id === id);
        // only a brand-new id counts against the limit; editing any existing bot (yours, a built-in, an import) never does
        if (!was && crewNow.filter((b) => !b.source).length >= 67) throw new HttpError(400, 'too many bots; remove some first');
        const { personaTruncated, source: _source, modelHint, ...body } = (await readJson(req)) ?? {};
        void _source;
        // An imported bot stays imported: its source is kept, its when-to-use and model hint carry over unless the body
        // sets them, and the list's truncated persona (or a missing one) never replaces the full saved one. A PUT cannot
        // make a bot imported (that would dodge the user-bot caps), so source and modelHint are dropped for any other id.
        const merged = was?.source
          ? {
              whenToUse: was.whenToUse,
              modelHint: modelHint ?? was.modelHint,
              ...body,
              ...(personaTruncated === true || typeof body.persona !== 'string' ? { persona: was.persona } : {}),
              source: was.source,
              id,
            }
          : { ...body, id };
        const { bot, error } = sanitizeBot(merged);
        if (!bot) throw new HttpError(400, error ?? 'invalid bot');
        saveBot(cfg.home, bot);
        refreshCrew(cfg.home);
        const saved = loadCrew(cfg.home).find((b) => b.id === id)!;
        return send(res, 200, { ...saved, pixels: lookPixels(saved.look) }), true;
      }
      if (m === 'DELETE') {
        const r = removeBot(cfg.home, id);
        if (r === 'none' && BUILTIN_IDS.has(id)) throw new HttpError(400, 'built-in bots cannot be removed');
        refreshCrew(cfg.home);
        return send(res, 200, { ok: true, result: r }), true;
      }
    }

    // ---- evolve: harness versions, lessons and proposals (proposals are made by the CLI's aorch evolve; here they are only reviewed) ----
    if ((g = p.match(/^\/api\/harness\/([^/]+)$/)) && m === 'GET') {
      try {
        return send(res, 200, harnessView(cfg.home, idParam(g[1]!))), true;
      } catch (e) {
        throw evolveError(e, cfg.home);
      }
    }
    if ((g = p.match(/^\/api\/harness\/([^/]+)\/rollback$/)) && m === 'POST') {
      const bot = idParam(g[1]!);
      const b = reqObject(await readJson(req));
      try {
        findBot(cfg.home, bot);
        if (b.version === undefined) throw new HttpError(400, '"version" is required');
        return send(res, 200, { harness: revert(cfg.home, bot, b.version) }), true;
      } catch (e) {
        throw evolveError(e, cfg.home);
      }
    }
    if (p === '/api/lessons' && m === 'GET') {
      try {
        const want = url.searchParams.get('bot');
        const bots = want !== null ? [findBot(cfg.home, want)] : loadCrew(cfg.home);
        const out: Lesson[] = [];
        for (const bt of bots) {
          try {
            out.push(...loadLessons(cfg.home, bt.id));
          } catch {
            /* an unreadable lessons file reads as none here; the CLI reports it */
          }
        }
        return send(res, 200, { lessons: out.slice(0, 400).map(lessonView) }), true;
      } catch (e) {
        throw evolveError(e, cfg.home);
      }
    }
    if (p === '/api/proposals' && m === 'GET') {
      try {
        const want = url.searchParams.get('bot');
        if (want !== null) {
          const bt = findBot(cfg.home, want);
          const cur = peekHarness(cfg.home, bt).version;
          let lessons: Lesson[] = [];
          try {
            lessons = loadLessons(cfg.home, bt.id);
          } catch {
            /* shown without lesson text */
          }
          return send(res, 200, { bot: bt.id, version: cur, proposals: proposalsFor(cfg.home, bt.id, 20).map((x) => proposalView(cfg.home, x, lessons, cur)) }), true;
        }
        // no bot: the open proposals of every bot (at most 10 each)
        const all = loadCrew(cfg.home).flatMap((bt) => {
          const open = listProposals(cfg.home, bt.id, 'open');
          const cur = open.length ? peekHarness(cfg.home, bt).version : 0;
          return open.map((x) => proposalView(cfg.home, x, [], cur));
        });
        return send(res, 200, { proposals: all.slice(0, 200) }), true;
      } catch (e) {
        throw evolveError(e, cfg.home);
      }
    }
    if ((g = p.match(/^\/api\/proposals\/([^/]+)\/(accept|reject)$/)) && m === 'POST') {
      const id = idParam(g[1]!);
      const b = reqObject(await readJson(req));
      try {
        if (g[2] === 'reject') return send(res, 200, { proposal: proposalView(cfg.home, decline(cfg.home, id), []) }), true;
        // picks are 1-based numbers ([1, 3]) or "kept"; the CLI's text form ("1,3") is not taken here
        if (typeof b.pick === 'string' && b.pick !== 'kept') throw new HttpError(400, '"pick" must be a list of edit numbers starting at 1 (like [1, 3]), or "kept"');
        const r = await adopt(cfg.home, id, b.pick ?? undefined, vault);
        let lessons: Lesson[] = [];
        try {
          lessons = loadLessons(cfg.home, r.proposal.bot);
        } catch {
          /* shown without lesson text */
        }
        return send(res, 200, { harness: r.harness, proposal: proposalView(cfg.home, r.proposal, lessons, r.harness.version), ...(r.vaultNote ? { vaultNote: r.vaultNote } : {}) }), true;
      } catch (e) {
        throw evolveError(e, cfg.home);
      }
    }

    // ---- workspaces (for pickers) ----
    if (p === '/api/workspaces' && m === 'GET') return send(res, 200, listWorkspaces(cfg.home).map(wsRow)), true;
    // Open folder…: register a folder as a project. Nothing is written into the folder (`tether workspace init` does that).
    if (p === '/api/workspaces' && m === 'POST') {
      const dir = (await readJson(req)).path;
      if (typeof dir !== 'string' || !isAbsolute(dir)) throw new HttpError(400, '"path" must be an absolute folder path');
      if (!existsSync(dir)) throw new HttpError(400, `${dir} does not exist`);
      if (!statSync(dir).isDirectory()) throw new HttpError(400, `${dir} is not a folder`);
      if (isAorchHome(dir, cfg.home)) throw new HttpError(400, aorchHomeMessage(dir, cfg.home));
      const r = initWorkspace(cfg.home, dir, { write: false });
      return send(res, r.existed ? 200 : 201, wsRow(r.workspace)), true;
    }
    if ((g = p.match(/^\/api\/workspaces\/([a-z][a-z0-9_-]{0,31})$/)) && m === 'DELETE') {
      let gone: boolean;
      try {
        gone = removeWorkspace(cfg.home, g[1]!);
      } catch (e) {
        throw bundleError(e);
      }
      if (!gone) throw new HttpError(404, `unknown workspace "${g[1]}"`);
      return send(res, 200, { removed: g[1] }), true;
    }
    if ((g = p.match(/^\/api\/workspaces\/([a-z][a-z0-9_-]{0,31})\/export$/)) && m === 'GET') {
      const w = getWorkspace(cfg.home, g[1]!);
      if (!w) throw new HttpError(404, `unknown workspace "${g[1]}"`);
      // never with secrets: secret values must not reach the browser (only the CLI has --with-secrets)
      let r: ReturnType<typeof exportWorkspace>;
      try {
        r = exportWorkspace(cfg.home, w);
      } catch (e) {
        throw bundleError(e);
      }
      return send(res, 200, { fileName: bundleFileName(w), bundle: r.bundle, skipped: r.skipped }), true;
    }
    if (p === '/api/workspaces/import' && m === 'POST') {
      const b = reqObject(await readJson(req, 6_000_000));
      let bundle: Bundle;
      try {
        bundle = parseBundle(b.bundle);
      } catch (e) {
        throw bundleError(e);
      }
      if (typeof b.into !== 'string' || !isAbsolute(b.into)) throw new HttpError(400, '"into" must be an absolute folder path');
      try {
        if (b.confirm !== true) return send(res, 200, planBundleImport(bundle, b.into, cfg.home)), true;
        const r = applyBundle(cfg.home, bundle, b.into);
        return send(res, 200, { workspace: r.workspace.id, written: r.written }), true;
      } catch (e) {
        throw bundleError(e);
      }
    }

    // ---- triggers: PR rules with ids, status and a delivery log. The webhook secret is only ever returned by POST /api/triggers/setup/secret. ----
    if (p === '/api/triggers' && m === 'GET') {
      const rules = loadSettings(cfg.home).rules ?? [];
      return send(res, 200, rules.map((r) => ({ ...r, status: triggerStatus(r, cfg.home), last: lastDelivery(cfg.home, r.id!) ?? null }))), true;
    }
    if (p === '/api/triggers' && m === 'POST') {
      const b = reqObject(await readJson(req));
      const repo = reqString(b, 'repo', 100);
      if (!repo) throw new HttpError(400, '"repo" is required (owner/repo, or * for any mapped repo)');
      const str = (k: string) => reqString(b, k);
      const settings = loadSettings(cfg.home);
      let out;
      try {
        out = upsertRule(
          settings.rules ?? [],
          { repo, workflow: reqString(b, 'workflow', 64), workspace: str('workspace'), agent: str('agent'), model: str('model'), events: reqList(b, 'events'), labels: reqList(b, 'labels'), comment: reqBool(b, 'comment') ?? false, drafts: reqBool(b, 'drafts') ?? false, forks: reqBool(b, 'forks') ?? false, id: reqString(b, 'id', 63), enabled: reqBool(b, 'enabled') },
          { hasWorkspace: (id) => !!getWorkspace(cfg.home, id), workspaceRepos: (id) => getWorkspace(cfg.home, id)?.repos, hasAgent: (id) => registry.has(id), checkWorkflow: (r) => checkWorkflow(cfg.home, r) },
        );
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      saveSettings(cfg.home, { ...settings, rules: out.next });
      return send(res, 200, { ...out.rule, status: triggerStatus(out.rule, cfg.home), last: lastDelivery(cfg.home, out.rule.id!) ?? null, warnings: out.warnings, replaced: out.replaced }), true;
    }
    if (p === '/api/triggers/deliveries' && m === 'GET') {
      const trigger = url.searchParams.get('trigger') || undefined;
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 50) || 50));
      return send(res, 200, readDeliveries(cfg.home, { trigger, limit })), true;
    }
    if (p === '/api/triggers/setup' && m === 'GET') {
      return send(res, 200, webhookSetupInfo(cfg.home)), true;
    }
    if (p === '/api/triggers/setup/secret' && m === 'POST') {
      if (process.env.AORCH_WEBHOOK_SECRET) throw new HttpError(409, 'the secret comes from the AORCH_WEBHOOK_SECRET environment variable; change it there');
      const { secret } = ensureWebhookSecret(cfg.home, true);
      return send(res, 200, { secret, secretHint: secret.slice(-4) }), true;
    }
    if ((g = p.match(/^\/api\/triggers\/([^/]+)\/test$/)) && m === 'POST') {
      const settings = loadSettings(cfg.home);
      const tid = idParam(g[1]!);
      let r;
      try {
        r = findRule(settings.rules ?? [], tid);
      } catch (e) {
        throw new HttpError(404, (e as Error).message);
      }
      const b = reqObject(await readJson(req));
      const prText = reqString(b, 'pr', 300);
      if (!prText) throw new HttpError(400, '"pr" is required (a PR link, owner/repo#number, or a number)');
      const fire = reqBool(b, 'fire') === true;
      let ref;
      try {
        ref = parsePrTarget(prText, r);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      let info;
      try {
        info = await fetchPr(ref, exec);
      } catch (e) {
        throw new HttpError(502, (e as Error).message);
      }
      const prevRun = alreadyRan(cfg.home, ref, info.headSha);
      const verdict = dryRunVerdict(r, { repo: ref.repo, labels: info.labels, draft: info.draft, fork: info.fork }, prevRun ? { sha: info.headSha, runId: prevRun } : undefined);
      const pr = { repo: ref.repo, number: ref.number, title: info.title, url: ref.url };
      if (!verdict.matches || !fire) {
        return send(res, 200, { matches: verdict.matches, why: verdict.why, fired: false, pr, ...(verdict.matches ? { note: 'dry run, nothing started' } : {}) }), true;
      }
      refreshCrew(cfg.home);
      const at = () => new Date().toISOString();
      try {
        const started = await startPrRun({ home: cfg.home, engine, exec }, ref, { workflow: r.workflow, comment: r.comment, workspace: r.workspace, agent: r.agent, model: r.model });
        started.done.catch(() => undefined);
        recordDelivery(cfg.home, { at: at(), trigger: r.id, source: 'test', repo: ref.repo, pr: ref.number, outcome: 'started', runId: started.runId });
        return send(res, 200, { matches: true, why: verdict.why, fired: true, runId: started.runId, pr }), true;
      } catch (e) {
        const msg = (e as Error).message;
        recordDelivery(cfg.home, { at: at(), trigger: r.id, source: 'test', repo: ref.repo, pr: ref.number, outcome: classifyFailure(msg), reason: msg.slice(0, 300) });
        throw new HttpError(422, msg);
      }
    }
    if ((g = p.match(/^\/api\/triggers\/([^/]+)$/)) && (m === 'PATCH' || m === 'DELETE')) {
      const id = idParam(g[1]!);
      const settings = loadSettings(cfg.home);
      const rules = settings.rules ?? [];
      let r;
      try {
        r = findRule(rules, id);
      } catch (e) {
        throw new HttpError(404, (e as Error).message);
      }
      if (m === 'DELETE') {
        saveSettings(cfg.home, { ...settings, rules: ensureIds(rules.filter((x) => x !== r)) });
        return send(res, 200, { ok: true }), true;
      }
      const b = reqObject(await readJson(req));
      const enabled = reqBool(b, 'enabled');
      if (enabled === undefined) throw new HttpError(400, '"enabled" (true or false) is required');
      const nextRule = { ...r };
      if (enabled) delete nextRule.enabled;
      else nextRule.enabled = false;
      saveSettings(cfg.home, { ...settings, rules: ensureIds(rules.map((x) => (x === r ? nextRule : x))) });
      return send(res, 200, { ...nextRule, status: triggerStatus(nextRule, cfg.home), last: lastDelivery(cfg.home, id) ?? null }), true;
    }

    // ---- pipelines ----
    if (p === '/api/pipelines' && m === 'GET') return send(res, 200, listPipelines(cfg.home)), true;
    if (p === '/api/preflight' && m === 'POST') {
      const pl = normalizePipeline(await readJson(req));
      return send(res, 200, { issues: preflight(engine.resolve(pl), registry) }), true;
    }
    if ((g = p.match(/^\/api\/pipelines\/([^/]+)$/))) {
      const name = decodeURIComponent(g[1]!);
      if (!NAME_RE.test(name)) throw new HttpError(400, 'invalid pipeline name');
      if (m === 'GET') {
        try {
          const pl = readPipeline(cfg.home, name);
          return send(res, 200, { pipeline: pl, issues: preflight(engine.resolve(pl), registry) }), true;
        } catch {
          throw new HttpError(404, `no pipeline "${name}"`);
        }
      }
      if (m === 'PUT') {
        const body = await readJson(req);
        const pl = normalizePipeline({ ...body, name }, name);
        writePipeline(cfg.home, pl);
        return send(res, 200, { pipeline: pl, issues: preflight(engine.resolve(pl), registry) }), true;
      }
      if (m === 'DELETE') {
        const f = join(pipelinesDir(cfg.home), `${name}.json`);
        if (!existsSync(f)) throw new HttpError(404, `no pipeline "${name}"`);
        unlinkSync(f);
        return send(res, 200, { ok: true }), true;
      }
    }

    // ---- runs ----
    if (p === '/api/runs' && m === 'GET') {
      // Evolve probe replays are experiments, hidden unless ?all=1
      const all = url.searchParams.get('all') === '1';
      const rows = store
        .listRows()
        .filter(({ summary: r }) => all || !r.probe)
        .map(({ summary: r, state, lastTs }) => ({ ...r, ...rowExtras(state, lastTs), live: rowLive(engine, { ...r, lastTs }) }));
      return send(res, 200, rows), true;
    }
    if (p === '/api/attention' && m === 'GET') return send(res, 200, { items: attention.items((r, lastTs) => rowLive(engine, { ...r, lastTs })) }), true;
    if (p === '/api/activity' && m === 'GET') {
      const raw = url.searchParams.get('since');
      const since = raw ? parseCursor(raw) : undefined;
      if (raw && !since) throw new HttpError(400, 'malformed "since" cursor');
      const n = Number(url.searchParams.get('limit') ?? ACTIVITY_LIMIT);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, ACTIVITY_MAX) : ACTIVITY_LIMIT;
      return send(res, 200, activityFeed(store, { since, limit })), true;
    }
    if (p === '/api/roster/preview' && m === 'GET') {
      const task = url.searchParams.get('task') ?? '';
      if (task.length > PREVIEW_TASK_MAX) throw new HttpError(400, `"task" is too long (max ${PREVIEW_TASK_MAX})`);
      return send(res, 200, rosterPreview({ home: cfg.home, task, ws: url.searchParams.get('ws') ?? undefined })), true;
    }
    if (p === '/api/runs' && m === 'POST') {
      const b = await readJson(req);
      if (b.kind !== undefined && b.kind !== 'workflow' && b.kind !== 'team') throw new HttpError(400, '"kind" must be "workflow" or "team"');
      if (typeof b.task !== 'string' || !b.task.trim()) throw new HttpError(400, '"task" is required');
      if (typeof b.repo !== 'string' || !b.repo) throw new HttpError(400, '"repo" is required');
      if (!existsSync(b.repo) || !statSync(b.repo).isDirectory()) throw new HttpError(400, `repo path does not exist: ${b.repo}`);
      if (b.kind === 'team') {
        if (b.mode !== undefined && b.mode !== 'live' && b.mode !== 'autonomous') throw new HttpError(400, '"mode" must be "live" or "autonomous"');
        const roster = [...new Set(reqList(b, 'roster')?.split(',') ?? [])];
        const yes = reqBool(b, 'yes');
        if (b.budget !== undefined && !(typeof b.budget === 'number' && b.budget > 0 && b.budget <= TEAM_MAX_BUDGET_USD)) throw new HttpError(400, `"budget" must be a dollar amount above 0 and up to ${TEAM_MAX_BUDGET_USD}`);
        if (b.maxRounds !== undefined && !(Number.isInteger(b.maxRounds) && b.maxRounds >= 1 && b.maxRounds <= 6)) throw new HttpError(400, '"maxRounds" must be a whole number from 1 to 6');
        // the run is created and returned at once; planning (model calls) runs in the background, so poll the run
        try {
          const id = await engine.startTeam({ task: b.task, repo: resolve(b.repo), mode: b.mode, roster: roster.length ? roster : undefined, yes, budgetUsd: b.budget, maxRounds: b.maxRounds, background: true, endpoints: b.endpoints === false ? false : undefined });
          return send(res, 201, { id }), true;
        } catch (e) {
          // a refusal of the input (an unknown roster bot) is 400; a run that could not be made (not a git repo) is 422, as for workflows
          if (e instanceof TeamError) throw teamError(e);
          throw new HttpError(422, (e as Error).message);
        }
      }
      let pl;
      try {
        pl = typeof b.pipeline === 'string' ? readPipeline(cfg.home, b.pipeline) : normalizePipeline(b.pipeline);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      try {
        const id = await engine.start({ pipeline: pl, task: b.task, repo: resolve(b.repo), ref: typeof b.ref === 'string' ? b.ref : undefined, autoApprove: !!b.autoApprove, endpoints: b.endpoints === false ? false : undefined });
        return send(res, 201, { id }), true;
      } catch (e) {
        throw new HttpError(422, (e as Error).message);
      }
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)$/)) && m === 'GET') return send(res, 200, runView(idParam(g[1]!))), true;
    if ((g = p.match(/^\/api\/runs\/([^/]+)$/)) && m === 'DELETE') {
      if (!store.state(idParam(g[1]!))) throw new HttpError(404, 'unknown run');
      try {
        await engine.deleteRun(idParam(g[1]!), { keepWork: url.searchParams.get('keepWork') === '1' });
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      return send(res, 200, { deleted: idParam(g[1]!) }), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/events$/)) && m === 'GET') {
      const id = idParam(g[1]!);
      runView(id);
      const evs = url.searchParams.get('chunks') === '1' ? store.events(id, Number(url.searchParams.get('after') ?? 0)) : store.eventsNoChunks(id);
      return send(res, 200, evs), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/stream$/)) && m === 'GET') {
      const id = idParam(g[1]!);
      runView(id);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      let last = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? store.events(id).at(-1)?.seq ?? 0);
      const write = (event: string, data: unknown, idv?: number) => res.write(`${idv !== undefined ? `id: ${idv}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      write('state', runView(id));
      // Polling the log (rather than in-process listeners) also surfaces runs driven from the CLI.
      const tick = setInterval(() => {
        try {
          const fresh = store.events(id, last);
          if (!fresh.length) return;
          for (const e of fresh) write('event', e, e.seq);
          last = fresh.at(-1)!.seq;
          write('state', runView(id));
        } catch {
          /* run vanished or db busy: next tick */
        }
      }, 500);
      const beat = setInterval(() => res.write(': hb\n\n'), 15_000);
      req.on('close', () => (clearInterval(tick), clearInterval(beat)));
      return true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/(answers|plan|mode|swap)$/)) && m === 'POST') {
      const id = idParam(g[1]!);
      const what = g[2]!;
      const s = store.state(id);
      if (!s) throw new HttpError(404, `unknown run ${id}`);
      const b = await readJson(req);
      if (s.kind !== 'team') throw new HttpError(400, 'not a team run');
      try {
        if (what === 'answers') {
          const answers = checkAnswers(b, s);
          // planning cards go in one batch; a worker's question is answered one at a time
          const asks = new Set((s.userAsks ?? []).map((a) => a.question.id));
          const plan = answers.filter((a) => !asks.has(a.question));
          // the answer is recorded now; the next planning round (a model call) runs in the background and clients poll the run
          if (plan.length) {
            if (engine.recordPlanAnswers(id, plan)) engine.continuePlanningInBackground(id);
          }
          // all of a batch's worker answers are recorded together or not at all
          const user = answers.filter((x) => asks.has(x.question));
          if (user.length) await engine.answerUsers(id, user.map((a) => ({ question: a.question, option: a.option, text: a.text })));
        } else if (what === 'plan') {
          const approved = reqBool(reqObject(b), 'approved');
          if (approved === undefined) throw new HttpError(400, '"approved" (true or false) is required');
          await engine.approveTeamPlan(id, approved);
        } else if (what === 'swap') {
          const o = reqObject(b);
          if (typeof o.assignment !== 'number' || typeof o.bot !== 'string') throw new HttpError(400, 'body must be { assignment: number, bot: string }');
          engine.swapAssignment(id, o.assignment, o.bot);
        } else {
          const mode = reqObject(b).mode;
          if (mode !== 'live' && mode !== 'autonomous') throw new HttpError(400, '"mode" must be "live" or "autonomous"');
          engine.setMode(id, mode);
        }
      } catch (e) {
        throw teamError(e);
      }
      return send(res, 200, runView(id)), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/(stop|resume|approve)$/)) && m === 'POST') {
      const id = idParam(g[1]!);
      const action = g[2]!;
      const s = store.state(id);
      if (!s) throw new HttpError(404, `unknown run ${id}`);
      const b = await readJson(req);
      try {
        if (action === 'stop') {
          if (!engine.stop(id)) throw new HttpError(409, s.status === 'running' ? 'run is not live in this server (stop it where it was started)' : `this run is not active (${s.status})`);
        } else if (action === 'resume') {
          // Switch model… after the free limit: the waiting steps carry on on this agent/model (this run only)
          const model = reqString(b, 'model');
          const switchTo = typeof b.agent === 'string' ? { agent: b.agent, ...(model ? { model } : {}) } : undefined;
          // a team run still planning resumes with its next round in the background
          await engine.resume(id, { retryFailed: b.retryFailed, background: true, ...(switchTo ? { switchTo } : {}) });
        } else {
          if (typeof b.node !== 'string') throw new HttpError(400, '"node" is required');
          // a team's run: the team's approver rule holds here too (spec §6.3)
          if (!teams.mayApproveRun(id, OWNER.id)) throw new HttpError(403, 'Only the team’s chosen approvers can decide this run');
          engine.approve(id, b.node, b.approved !== false, 'dashboard');
          if (!engine.isLive(id) && store.state(id)!.status === 'paused') await engine.resume(id);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, (e as Error).message);
      }
      return send(res, 200, runView(id)), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/feedback$/)) && m === 'POST') {
      const id = idParam(g[1]!);
      if (!store.state(id)) throw new HttpError(404, `unknown run ${id}`);
      const b = await readJson(req);
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'expected a JSON object');
      if (typeof b.node !== 'string' || !b.node) throw new HttpError(400, '"node" is required');
      if (b.rating !== 'up' && b.rating !== 'down') throw new HttpError(400, '"rating" must be "up" or "down"');
      if (b.note !== undefined && typeof b.note !== 'string') throw new HttpError(400, '"note" must be text');
      try {
        engine.feedback(id, b.node, b.rating, b.note);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      return send(res, 200, runView(id)), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/diff$/)) && m === 'GET') {
      const s = store.state(idParam(g[1]!));
      if (!s) throw new HttpError(404, 'unknown run');
      const node = url.searchParams.get('node');
      let diff = '';
      if (node) {
        const c = s.nodes[node]?.commit;
        diff = c ? await commitDiff(s.workdir, c) : '';
      } else {
        diff = await diffCommitted(s.workdir, s.baseSha);
      }
      return send(res, 200, { diff: diff.slice(0, 500_000), truncated: diff.length > 500_000 }), true;
    }

    // ---- vault ----
    if (p === '/api/vault/activity' && m === 'GET') {
      const raw = url.searchParams.get('since');
      const since = raw ? parseCursor(raw) : undefined;
      if (raw && !since) throw new HttpError(400, 'malformed "since" cursor');
      const n = Number(url.searchParams.get('limit') ?? VAULT_ACTIVITY_LIMIT);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, VAULT_ACTIVITY_MAX) : VAULT_ACTIVITY_LIMIT;
      return send(res, 200, vaultActivity(store, { since, limit })), true;
    }
    if (p === '/api/vault/graph' && m === 'GET') return send(res, 200, await vault.graph()), true;
    if (p === '/api/vault/note' && m === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      const n = path ? await vault.read(path) : undefined;
      if (!n) throw new HttpError(404, 'no such note');
      return send(res, 200, { path: n.path, title: n.title, type: n.type, tags: n.tags, body: n.body, links: n.links, backlinks: await vault.backlinks(n.path) }), true;
    }
    if (p === '/api/vault/search' && m === 'GET') {
      const hits = await vault.search(url.searchParams.get('q') ?? '', 10);
      return send(res, 200, hits.map((h) => ({ path: h.note.path, title: h.note.title, type: h.note.type, score: h.score }))), true;
    }
    return false;
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    const root = o.webDir ? resolve(o.webDir) : undefined;
    if (!root || !existsSync(root)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Tether API is running. The dashboard is not built yet: run `npm run build:web`.\n');
    }
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA fallback
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    res.end(readFileSync(file));
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && (req.url ?? '').split('?')[0] === '/api/webhooks/github') return await githubWebhook(req, res);
      if (!hostOk(req)) throw new HttpError(403, 'bad Host header');
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (req.method && !['GET', 'HEAD'].includes(req.method) && !originOk(req)) throw new HttpError(403, 'cross-origin request refused');
      if (url.pathname.startsWith('/api/')) {
        if (!(await route(req, res, url))) throw new HttpError(404, 'not found');
        return;
      }
      serveStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) {
        // the rest of an oversized upload is never read: close the connection instead of reusing a half-read socket
        if (e.status === 413) res.setHeader('connection', 'close');
        return send(res, e.status, { error: e.message, ...e.extra });
      }
      send(res, 500, { error: (e as Error).message });
    }
  });

  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 4177, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : o.port;
      resolveP({
        server,
        url: `http://${host === '::1' ? '[::1]' : host}:${port}`,
        close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))),
      });
    });
  });
}
