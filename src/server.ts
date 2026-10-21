import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AdapterRegistry } from './adapters/index.js';
import { listPipelines, pipelinesDir, readPipeline, writePipeline, type Config } from './config.js';
import type { Engine } from './engine.js';
import { CREW, CREW_STYLES, lookPixels, refreshCrew } from './bots.js';
import { GLYPHS, SHAPES, initialsOf, shapeOf, symbolOf } from './marks.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { BOT_ID_RE, BUILTIN_IDS, KIND_BLURB, LOOK_PARTS, BOT_KINDS, loadCrew, removeBot, sanitizeBot, saveBot, type BotDef } from './crew.js';
import { PACKS, findPack, reid } from './packs.js';
import { alreadyRan, fetchPr, loadSettings, matchRule, parseWebhook, saveSettings, startPrRun, verifySignature, type Exec } from './pr.js';
import { checkWorkflow, classifyFailure, dryRunVerdict, ensureIds, ensureWebhookSecret, findRule, lastDelivery, parsePrTarget, refusal, readDeliveries, recordDelivery, triggerStatus, upsertRule, webhookSetupInfo } from './triggers.js';
import { getWorkspace, listWorkspaces } from './workspace.js';
import { link, loadBindings, unlink } from './bindings.js';
import { commitDiff, diffCommitted } from './git.js';
import { NAME_RE, normalizePipeline, preflight } from './pipeline.js';
import type { Store } from './store.js';
import type { Vault } from './vault.js';

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
}

const MAX_BODY = 1_000_000;
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_LIST = 20;
/** Body must be a JSON object. */
function reqObject(b: unknown): Record<string, unknown> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'the body must be a JSON object');
  return b as Record<string, unknown>;
}
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

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(c as Buffer);
  }
  if (!n) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
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
  let doctorCache: { at: number; data: unknown } | undefined;
  let modelsCache: { at: number; data: Record<string, { ok: boolean; version?: string; detail?: string; models: string[] }> } | undefined;

  const runView = (id: string) => {
    const s = store.state(id);
    if (!s) throw new HttpError(404, `unknown run ${id}`);
    const live = engine.isLive(id) || (s.status === 'running' && Date.now() - store.lastTs(id) < 120_000);
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
    if (p === '/api/runs' && m === 'POST') refreshCrew(cfg.home);

    if (p === '/api/health' && m === 'GET') {
      return send(res, 200, { ok: true, adapters: registry.ids(), vault: vault.root, home: cfg.home }), true;
    }
    if (p === '/api/doctor' && m === 'GET') {
      if (!doctorCache || Date.now() - doctorCache.at > 30_000) {
        const out: Record<string, unknown> = {};
        for (const id of registry.ids()) out[id] = { ...(await registry.get(id).detect()), reportsCost: registry.get(id).reportsCost, supportsResume: registry.get(id).supportsResume };
        doctorCache = { at: Date.now(), data: out };
      }
      return send(res, 200, doctorCache.data), true;
    }

    // ---- crew: bot <-> agent/model links (read live by the engine at every run start) ----
    if (p === '/api/bots' && m === 'GET') {
      if (!modelsCache || Date.now() - modelsCache.at > 30_000) {
        const out: Record<string, { ok: boolean; version?: string; detail?: string; models: string[] }> = {};
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
            out[id] = { ok: d.ok, version: d.version, detail: d.detail, models };
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
        link(cfg.home, role, { agent, ...(model ? { model } : {}) });
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        unlink(cfg.home, role);
        return send(res, 200, { ok: true }), true;
      }
    }

    // ---- crew roster: the bots themselves (looks, personas), built-in and your own ----
    if (p === '/api/crew' && m === 'GET') {
      const px = (b: BotDef) => ({ ...b, pixels: lookPixels(b.look), mark: { shape: shapeOf(b.id), symbol: symbolOf(b.name), initials: initialsOf(b.name) } });
      const style = loadPrefs(cfg.home).crew ?? 'pebble';
      return send(res, 200, { style, styles: Object.entries(CREW_STYLES).filter(([k]) => k !== 'classic').map(([id, blurb]) => ({ id, blurb })), shapes: SHAPES, glyphs: GLYPHS, bots: loadCrew(cfg.home).map(px), packs: PACKS.map((k) => ({ id: k.id, name: k.name, blurb: k.blurb, bots: k.bots.map(px) })), parts: LOOK_PARTS, kinds: BOT_KINDS.map((k) => ({ kind: k, blurb: KIND_BLURB[k] })) }), true;
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
      const have = loadCrew(cfg.home);
      if (have.length + pack.bots.length > 67) throw new HttpError(400, 'too many bots; remove some first');
      const fresh = reid(pack.bots, new Set(have.map((b) => b.id)));
      for (const b of fresh) saveBot(cfg.home, b);
      refreshCrew(cfg.home);
      return send(res, 200, { added: fresh.map((b) => b.id) }), true;
    }
    if ((g = p.match(/^\/api\/crew\/([a-z][a-z0-9_-]{0,23})$/))) {
      const id = g[1]!;
      if (!BOT_ID_RE.test(id)) throw new HttpError(400, 'bad id');
      if (m === 'PUT') {
        const existing = loadCrew(cfg.home);
        const was = existing.find((b) => b.id === id);
        if (!was && existing.length >= 67) throw new HttpError(400, 'too many bots; remove some first');
        const body = await readJson(req);
        const { bot, error } = sanitizeBot({ ...body, id });
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

    // ---- workspaces (for pickers) ----
    if (p === '/api/workspaces' && m === 'GET') {
      return send(res, 200, listWorkspaces(cfg.home).map((w) => ({ id: w.id, name: w.name, path: w.path, isDefault: !!w.isDefault, exists: w.exists, repos: w.repos }))), true;
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
        info = await fetchPr(ref, o.exec);
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
        const started = await startPrRun({ home: cfg.home, engine, exec: o.exec }, ref, { workflow: r.workflow, comment: r.comment, workspace: r.workspace, agent: r.agent, model: r.model });
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
      return send(res, 200, store.list().map((r) => ({ ...r, live: engine.isLive(r.id) }))), true;
    }
    if (p === '/api/runs' && m === 'POST') {
      const b = await readJson(req);
      if (typeof b.task !== 'string' || !b.task.trim()) throw new HttpError(400, '"task" is required');
      if (typeof b.repo !== 'string' || !b.repo) throw new HttpError(400, '"repo" is required');
      if (!existsSync(b.repo) || !statSync(b.repo).isDirectory()) throw new HttpError(400, `repo path does not exist: ${b.repo}`);
      let pl;
      try {
        pl = typeof b.pipeline === 'string' ? readPipeline(cfg.home, b.pipeline) : normalizePipeline(b.pipeline);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      try {
        const id = await engine.start({ pipeline: pl, task: b.task, repo: resolve(b.repo), ref: typeof b.ref === 'string' ? b.ref : undefined, autoApprove: !!b.autoApprove });
        return send(res, 201, { id }), true;
      } catch (e) {
        throw new HttpError(422, (e as Error).message);
      }
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)$/)) && m === 'GET') return send(res, 200, runView(g[1]!)), true;
    if ((g = p.match(/^\/api\/runs\/([^/]+)$/)) && m === 'DELETE') {
      if (!store.state(g[1]!)) throw new HttpError(404, 'unknown run');
      try {
        await engine.deleteRun(g[1]!, { keepWork: url.searchParams.get('keepWork') === '1' });
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      return send(res, 200, { deleted: g[1] }), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/events$/)) && m === 'GET') {
      const id = g[1]!;
      runView(id);
      const evs = url.searchParams.get('chunks') === '1' ? store.events(id, Number(url.searchParams.get('after') ?? 0)) : store.eventsNoChunks(id);
      return send(res, 200, evs), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/stream$/)) && m === 'GET') {
      const id = g[1]!;
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
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/(stop|resume|approve)$/)) && m === 'POST') {
      const id = g[1]!;
      const action = g[2]!;
      const s = store.state(id);
      if (!s) throw new HttpError(404, `unknown run ${id}`);
      const b = await readJson(req);
      try {
        if (action === 'stop') {
          if (!engine.stop(id)) throw new HttpError(409, 'run is not live in this server (stop it where it was started)');
        } else if (action === 'resume') {
          await engine.resume(id, { retryFailed: b.retryFailed });
        } else {
          if (typeof b.node !== 'string') throw new HttpError(400, '"node" is required');
          engine.approve(id, b.node, b.approved !== false, 'dashboard');
          if (!engine.isLive(id) && store.state(id)!.status === 'paused') await engine.resume(id);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, (e as Error).message);
      }
      return send(res, 200, runView(id)), true;
    }
    if ((g = p.match(/^\/api\/runs\/([^/]+)\/diff$/)) && m === 'GET') {
      const s = store.state(g[1]!);
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
      return res.end('aorch API is running. The dashboard is not built yet: run `npm run build:web`.\n');
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
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
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
