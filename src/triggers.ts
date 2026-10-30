// Triggers: PR, issue and comment rules with a stable id, an on/off switch, per-trigger agent/model, and a log of what arrived.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_EVENTS, DEFAULT_MENTION, RULE_KINDS, loadSettings, parsePr, pipelineFor, ruleKind, saveSettings, type PrRef, type Rule, type RuleKind, type WebhookIssue } from './pr.js';
import { getWorkspace } from './workspace.js';
import type { Pipeline } from './types.js';

export const idSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'any';

/** Give every rule a stable id: `<repo-slug>-<workflow>` (plus `-issue` or `-comment`), de-duplicated with -2, -3... Existing ids are kept. Returns new objects. */
export function ensureIds(rules: Rule[]): Rule[] {
  const used = new Set<string>();
  const out = rules.map((r) => ({ ...r }));
  const unique = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  for (const r of out) if (r.id) r.id = unique(r.id);
  for (const r of out) if (!r.id) r.id = unique(`${r.repo === '*' ? 'any' : idSlug(r.repo)}-${r.workflow}${ruleKind(r) === 'pr' ? '' : `-${r.on}`}`);
  return out;
}

/** A copy of the pipeline whose agent steps run on this agent / model. Gates, approvals and manager-spawned steps are untouched. */
export function applyOverrides(pipeline: Pipeline, o: { agent?: string; model?: string }): Pipeline {
  if (!o.agent && !o.model) return pipeline;
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((n) => {
      if (n.kind !== 'agent' || n.spawn) return n;
      return { ...n, ...(o.agent ? { agent: o.agent } : {}), ...(o.model ? { model: o.model } : {}) };
    }),
  };
}

// ---------- deliveries log ----------
export interface Delivery {
  at: string;
  trigger?: string;
  source: 'webhook' | 'poll' | 'test';
  repo: string;
  pr?: number;
  outcome: 'started' | 'ignored' | 'skipped' | 'error';
  reason?: string;
  runId?: string;
}
const MAX_DELIVERIES = 500;
/** Trim only once the file passes this, so concurrent writers rarely collide. */
const TRIM_AT = 600;
const logPath = (home: string) => join(home, 'triggers-log.jsonl');

function readAll(home: string): Delivery[] {
  let text = '';
  try {
    text = readFileSync(logPath(home), 'utf8');
  } catch {
    return [];
  }
  const out: Delivery[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Delivery);
    } catch {
      /* skip a damaged line */
    }
  }
  return out;
}

export function recordDelivery(home: string, d: Delivery): void {
  try {
    mkdirSync(home, { recursive: true });
    const f = logPath(home);
    appendFileSync(f, JSON.stringify(d) + '\n', { mode: 0o600 });
    const all = readAll(home);
    // Known limit: `aorch serve` and `aorch pr watch` are separate processes. If both trim at the same moment, an entry appended between
    // this read and the rename can be lost. The log is advisory and capped, so that is accepted rather than locked.
    if (all.length > TRIM_AT) {
      const tmpFile = `${f}.${process.pid}.tmp`;
      writeFileSync(tmpFile, all.slice(-MAX_DELIVERIES).map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
      renameSync(tmpFile, f);
    }
  } catch (e) {
    // a log that cannot be written must never break a run
    console.error(`[aorch] could not write the deliveries log: ${(e as Error).message}`);
  }
}

/** Newest first. */
export function readDeliveries(home: string, o: { trigger?: string; limit?: number } = {}): Delivery[] {
  const all = readAll(home).reverse();
  const newest = all.slice(0, MAX_DELIVERIES).filter((d) => !o.trigger || d.trigger === o.trigger);
  return o.limit !== undefined ? newest.slice(0, Math.max(0, o.limit)) : newest;
}

/** A failure from startPrRun that is a normal refusal (seen already, fork guard) rather than something broken. */
export const classifyFailure = (msg: string): 'skipped' | 'error' => (/^already (reviewed|started)|comes from a fork/.test(msg) ? 'skipped' : 'error');

export const lastDelivery = (home: string, triggerId: string): Delivery | undefined => readDeliveries(home, { trigger: triggerId, limit: 1 })[0];

export type TriggerStatus = 'paused' | 'error' | 'idle' | 'active';
export function triggerStatus(rule: Rule, home: string, now = Date.now()): TriggerStatus {
  if (rule.enabled === false) return 'paused';
  const last = rule.id ? lastDelivery(home, rule.id) : undefined;
  if (!last) return 'idle';
  if (last.outcome === 'error') return 'error';
  if (last.outcome === 'started' && now - Date.parse(last.at) < 24 * 3_600_000) return 'active';
  return 'idle';
}

// ---------- CLI helpers ----------
/** "just now", "3m ago", "2h ago", "5d ago". */
export function ago(at: string | number, now = Date.now()): string {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return '?';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 30) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export const statusText = (s: TriggerStatus): string => ({ paused: 'paused', error: 'error', idle: 'idle', active: 'active' })[s];

/** One plain-text line per trigger (the CLI adds colour per field). */
export function formatTriggerLine(r: Rule, status: TriggerStatus, last: Delivery | undefined, now = Date.now()): string {
  const who = r.agent ? `${r.agent}${r.model ? '/' + r.model : ''}` : r.model ? `default agent/${r.model}` : 'default agent';
  const lastText = last ? `${ago(last.at, now)} ${last.outcome}${last.pr ? ' #' + last.pr : ''}` : 'no deliveries';
  return [r.id ?? '?', statusText(status), r.repo, `→ ${r.workflow}`, r.workspace ?? 'no workspace', who, firesOn(r), lastText].join('  ');
}

/** What fires a rule, in a few words: its PR actions, `issue` (with its label) or `comment <mention>`. */
export function firesOn(r: Rule): string {
  const k = ruleKind(r);
  if (k === 'issue') return r.label ? `issue labeled ${r.label}` : 'issue opened';
  if (k === 'comment') return `comment ${r.mention ?? DEFAULT_MENTION}`;
  return (r.events ?? DEFAULT_EVENTS).join(',');
}

/** The same decision as matchRule, with the reason. Without an `action` the event filter is not checked (a PR fetched by hand has none). */
export function explainMatch(r: Rule, p: { repo: string; labels: string[]; draft: boolean; fork: boolean; action?: string }): { matches: boolean; why: string } {
  const no = (why: string) => ({ matches: false, why });
  if (r.enabled === false) return no('the trigger is disabled (paused)');
  if (r.repo !== '*' && r.repo.toLowerCase() !== p.repo.toLowerCase()) return no(`the trigger is for ${r.repo}, not ${p.repo}`);
  const events = r.events ?? DEFAULT_EVENTS;
  if (p.action && !events.includes(p.action)) return no(`the trigger does not listen for "${p.action}" (it listens for ${events.join(', ')})`);
  if (p.draft && !r.drafts) return no('the PR is a draft and the trigger ignores drafts (add --drafts)');
  if (p.fork && !r.forks) return no('the PR comes from a fork and the trigger ignores forks (add --forks)');
  if (r.labels?.length && !r.labels.some((l) => p.labels.includes(l))) return no(`the PR has none of the required labels (${r.labels.join(', ')})`);
  return { matches: true, why: 'repo, state and labels all match' };
}

/** Ids that would collide with fixed API paths (/api/triggers/setup, /deliveries, /setup/secret). */
export const RESERVED_IDS = ['setup', 'deliveries', 'secret'];

export interface RuleFlags { workflow?: string; workspace?: string; agent?: string; model?: string; events?: string; labels?: string; comment?: boolean; drafts?: boolean; forks?: boolean; id?: string; on?: string; label?: string; mention?: string }
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
/** Turn `add` arguments into a Rule, or throw a message that says what to fix. Existence of the workspace/workflow/agent is checked by checkRuleRefs. */
export function parseRuleArgs(repo: string, f: RuleFlags): Rule {
  if (!/^[\w.*/-]{1,100}$/.test(repo)) throw new Error('repo must look like owner/repo (or * for any mapped repo)');
  const workflow = f.workflow ?? 'full-review';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(workflow)) throw new Error(`workflow "${workflow}" is not a valid name (letters, digits, . _ -)`);
  if (f.id !== undefined && !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(f.id)) throw new Error(`id "${f.id}" must be lowercase letters, digits, . _ - (max 63)`);
  if (f.id !== undefined && RESERVED_IDS.includes(f.id)) throw new Error(`id "${f.id}" is reserved; pick another`);
  const events = f.events ? list(f.events) : undefined;
  const bad = events?.find((e) => !/^[a-z_]{1,40}$/.test(e));
  if (bad) throw new Error(`event "${bad}" is not a GitHub pull_request action (e.g. opened, synchronize, reopened, ready_for_review, labeled)`);
  const labels = f.labels ? list(f.labels) : undefined;
  if (f.model && !f.agent) throw new Error('--model needs --agent: a model name only makes sense for a named agent (e.g. --agent codex --model gpt-5)');
  const on = (f.on || 'pr') as RuleKind;
  if (!RULE_KINDS.includes(on)) throw new Error(`"${String(f.on).slice(0, 20)}" is not a trigger kind (pr, issue or comment)`);
  const label = on === 'issue' ? f.label?.trim() : undefined;
  if (label && !/^[^,\n]{1,50}$/.test(label)) throw new Error('the label must be one GitHub label name (at most 50 characters, no commas)');
  const mention = on === 'comment' ? f.mention?.trim() : undefined;
  if (mention && !/^@[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(mention)) throw new Error('the mention must look like @name (a GitHub user or bot name)');
  // the pull-request filters mean nothing to an issue or comment trigger
  const pr = on === 'pr';
  return {
    repo,
    workflow,
    ...(on !== 'pr' ? { on } : {}),
    ...(label ? { label } : {}),
    ...(mention ? { mention } : {}),
    ...(pr && f.comment ? { comment: true } : {}),
    ...(pr && f.drafts ? { drafts: true } : {}),
    ...(pr && f.forks ? { forks: true } : {}),
    ...(pr && labels?.length ? { labels } : {}),
    ...(pr && events?.length ? { events } : {}),
    ...(f.workspace ? { workspace: f.workspace } : {}),
    ...(f.agent ? { agent: f.agent } : {}),
    ...(f.model ? { model: f.model } : {}),
    ...(f.id ? { id: f.id } : {}),
  };
}

/** Where a rule's workflow is looked up, like startPrRun: the mapped folder, else the workspace folder. Undefined when neither is known. */
export function ruleRepoDir(home: string, r: Rule): string | undefined {
  if (r.repo !== '*') {
    const repos = loadSettings(home).repos;
    const m = repos?.[r.repo.toLowerCase()] ?? repos?.[r.repo];
    if (m && existsSync(resolve(m))) return resolve(m);
  }
  const w = r.workspace ? getWorkspace(home, r.workspace) : undefined;
  // at run time a workspace only stands in for its own repos; a `*` trigger can't be checked until a PR arrives
  if (w?.exists && (r.repo === '*' || w.repos.some((x) => x.toLowerCase() === r.repo.toLowerCase()))) return w.path;
  return undefined;
}

/** Is the rule's workflow a saved workflow or skill? An unresolved repo (no mapping, no workspace) can only warn: it may be a skill in the PR's own repo. */
export function checkWorkflow(home: string, r: Rule): { error?: string; warning?: string } {
  const dir = ruleRepoDir(home, r);
  try {
    pipelineFor(home, r.workflow, dir ?? process.cwd());
    return {};
  } catch (e) {
    const msg = (e as Error).message;
    if (dir) return { error: msg };
    return { warning: `${msg}. Not checked against the PR's own repo (no mapped folder or workspace); it will fail at run time if no such project skill exists.` };
  }
}

/** Problems with what a rule points at; errors block, warnings do not. */
export function checkRuleRefs(r: Rule, refs: { hasWorkspace(id: string): boolean; hasAgent(id: string): boolean; checkWorkflow(r: Rule): { error?: string; warning?: string }; workspaceRepos?(id: string): string[] | undefined }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (r.workspace && !refs.hasWorkspace(r.workspace)) errors.push(`no workspace "${r.workspace}" (see: aorch workspace list)`);
  if (r.agent && !refs.hasAgent(r.agent)) errors.push(`unknown agent "${r.agent}" (see: aorch models)`);
  const wsRepos = r.workspace && r.repo !== '*' ? refs.workspaceRepos?.(r.workspace) : undefined;
  if (wsRepos && !wsRepos.some((x) => x.toLowerCase() === r.repo.toLowerCase())) {
    warnings.push(wsRepos.length ? `workspace "${r.workspace}" lists ${wsRepos.join(', ')}, not ${r.repo}: its folder will not be used as the checkout of ${r.repo} (the PR is cloned or mapped instead)` : `workspace "${r.workspace}" does not list ${r.repo} as one of its repos, so its folder will not be used as the checkout (map the repo with aorch pr map, or add it to the workspace)`);
  }
  const w = refs.checkWorkflow(r);
  if (w.error) errors.push(w.error);
  if (w.warning) warnings.push(w.warning);
  return { errors, warnings };
}

/** One trigger per repo (any case), workflow and kind. */
const sameSlot = (a: Rule, b: Rule) => a.repo.toLowerCase() === b.repo.toLowerCase() && a.workflow === b.workflow && ruleKind(a) === ruleKind(b);

/** Adding a rule: the same repo (any case) + workflow + kind replaces the earlier one, keeping its id (unless --id) and paused state. A new id may not belong to another trigger. */
export function planRuleAdd(rules: Rule[], rule: Rule): { next: Rule[]; prev?: Rule } {
  const prev = rules.find((r) => sameSlot(r, rule));
  if (rule.id && rules.some((r) => r.id === rule.id && r !== prev)) throw new Error(`a trigger called "${rule.id}" already exists (aorch triggers remove ${rule.id})`);
  const merged: Rule = { ...rule, ...(prev && !rule.id && prev.id ? { id: prev.id } : {}), ...(prev?.enabled === false ? { enabled: false } : {}) };
  return { next: [...rules.filter((r) => r !== prev), merged], prev };
}

/** The dry-run decision: the rule match, then "already reviewed". */
export function dryRunVerdict(r: Rule, pr: { repo: string; labels: string[]; draft: boolean; fork: boolean }, seen?: { sha: string; runId: string }): { matches: boolean; why: string } {
  const m = explainMatch(r, pr);
  if (m.matches && seen) return { matches: false, why: `already reviewed at ${seen.sha.slice(0, 7)} (run ${seen.runId})` };
  return m;
}

/** True the first time (or when it changes) a failure `sig` is seen for `key`; the polling loop uses it to say each problem once instead of every sweep. */
export function reportOnce(seen: Map<string, string>, key: string, sig: string): boolean {
  if (seen.get(key) === sig) return false;
  seen.set(key, sig);
  return true;
}

/** When a trigger covers this repo and listens for this action but declined the PR (draft, fork, labels): which one and why. Undefined when nothing was in play, so nothing needs logging. */
export function refusal(rules: Rule[], p: { repo: string; labels: string[]; draft: boolean; fork: boolean; action: string }): { rule: Rule; why: string } | undefined {
  for (const r of rules) {
    if (r.enabled === false || ruleKind(r) !== 'pr') continue;
    if (r.repo !== '*' && r.repo.toLowerCase() !== p.repo.toLowerCase()) continue;
    if (!(r.events ?? DEFAULT_EVENTS).includes(p.action)) continue;
    const m = explainMatch(r, p);
    if (!m.matches) return { rule: r, why: m.why };
  }
  return undefined;
}

/**
 * Whether an issue or comment trigger fires for this event, and why not. `listens` is false when the event is simply
 * not for it (another repo, kind or action, another label, no mention): not worth a log line.
 */
export function explainIssue(r: Rule, ev: WebhookIssue): { matches: boolean; listens: boolean; why: string } {
  const quiet = (why: string) => ({ matches: false, listens: false, why });
  const no = (why: string) => ({ matches: false, listens: true, why });
  if (r.enabled === false) return quiet('the trigger is disabled (paused)');
  if (ruleKind(r) !== ev.kind) return quiet(`the trigger fires on ${ruleKind(r)}s, not ${ev.kind}s`);
  if (r.repo !== '*' && r.repo.toLowerCase() !== ev.repo.toLowerCase()) return quiet(`the trigger is for ${r.repo}, not ${ev.repo}`);
  if (ev.kind === 'issue') {
    const fresh = r.label ? (ev.action === 'opened' && ev.labels.includes(r.label)) || (ev.action === 'labeled' && ev.added === r.label) : ev.action === 'opened';
    if (!fresh) return quiet(r.label ? `the issue did not open with or just get the label "${r.label}"` : `the trigger fires on new issues, not "${ev.action}"`);
  } else {
    if (ev.action !== 'created') return quiet(`the trigger fires on new comments, not "${ev.action}"`);
    if (!mentions(ev.text, r.mention ?? DEFAULT_MENTION)) return quiet(`the comment does not mention ${r.mention ?? DEFAULT_MENTION}`);
  }
  if (ev.bot) return no(`the ${ev.kind} comes from a bot`);
  // anyone can open an issue or comment on a public repo, and the run works on this machine
  if (!ev.trusted) return no(`${ev.author || 'the author'} is not an owner, member or collaborator of ${ev.repo}`);
  return { matches: true, listens: true, why: `${ev.kind} matches` };
}

/** `@name` as a word: not part of a longer name or address. */
export const mentions = (text: string, mention: string): boolean => new RegExp(`(^|[^\\w@.-])${mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text);

export const matchIssueRule = (rules: Rule[], ev: WebhookIssue): Rule | undefined => rules.find((r) => explainIssue(r, ev).matches);

/** The trigger that listened for this issue or comment but declined it (a bot, an outside author), and why. */
export function issueRefusal(rules: Rule[], ev: WebhookIssue): { rule: Rule; why: string } | undefined {
  for (const r of rules) {
    const m = explainIssue(r, ev);
    if (m.listens && !m.matches) return { rule: r, why: m.why };
  }
  return undefined;
}

export function findRule(rules: Rule[], id: string): Rule {
  const r = rules.find((x) => x.id === id);
  if (!r) throw new Error(`no trigger "${id}" (see: aorch triggers list)`);
  return r;
}

/** A PR link, owner/repo#n, or just a number (for a trigger tied to one repo). */
export function parsePrTarget(input: string, r: Rule): PrRef {
  const n = /^#?(\d+)$/.exec(input.trim());
  if (!n) return parsePr(input);
  if (r.repo === '*') throw new Error('this trigger matches any repo: give a link or owner/repo#number');
  return parsePr(`${r.repo}#${n[1]}`);
}

/** What the webhook setup screens may show: never the secret itself, only whether there is one and its last four characters. */
export function webhookSetupInfo(home: string): { payloadPath: string; contentType: string; eventsToSelect: string[]; hasSecret: boolean; secretHint: string | null; secretSource: 'env' | 'file' | null } {
  const env = !!process.env.AORCH_WEBHOOK_SECRET;
  const have = process.env.AORCH_WEBHOOK_SECRET || loadSettings(home).webhookSecret || '';
  return { payloadPath: '/api/webhooks/github', contentType: 'application/json', eventsToSelect: ['Pull requests', 'Issues', 'Issue comments'], hasSecret: !!have, secretHint: have.length >= 16 ? have.slice(-4) : null, secretSource: have ? (env ? 'env' : 'file') : null };
}

/** The webhook secret: env, then pr.json; generated and saved when absent (or `regenerate`). Returns whether it was just made. */
export function ensureWebhookSecret(home: string, regenerate = false): { secret: string; created: boolean } {
  const settings = loadSettings(home);
  const have = process.env.AORCH_WEBHOOK_SECRET || settings.webhookSecret;
  if (have && !regenerate) return { secret: have, created: false };
  const secret = randomBytes(24).toString('hex');
  saveSettings(home, { ...settings, webhookSecret: secret });
  return { secret, created: true };
}

/**
 * Create or update a trigger from user input (the dashboard form). Same parsing and checks as `aorch triggers add`.
 * With an `id` that exists, that trigger is edited in place (keeping its paused state unless `enabled` is given); a clash
 * with a different trigger's repo + workflow is an error. Without an existing id it behaves like `add`.
 * Throws an Error whose message says what to fix.
 */
export function upsertRule(
  rules: Rule[],
  input: RuleFlags & { repo: string; enabled?: boolean },
  refs: Parameters<typeof checkRuleRefs>[1],
): { rule: Rule; next: Rule[]; warnings: string[]; replaced: boolean } {
  const rule = parseRuleArgs(input.repo, input);
  const checked = checkRuleRefs(rule, refs);
  if (checked.errors.length) throw new Error(checked.errors.join('; '));
  const old = input.id ? rules.find((r) => r.id === input.id) : undefined;
  let next: Rule[];
  let replaced: boolean;
  if (old) {
    const clash = rules.find((r) => r !== old && sameSlot(r, rule));
    if (clash) throw new Error(`another trigger (${clash.id}) already runs ${rule.workflow} on ${rule.repo}${ruleKind(rule) === 'pr' ? '' : ` for ${ruleKind(rule)}s`}`);
    const merged: Rule = { ...rule, ...(input.enabled === false || (input.enabled === undefined && old.enabled === false) ? { enabled: false } : {}) };
    next = rules.map((r) => (r === old ? merged : r));
    replaced = true;
  } else {
    const plan = planRuleAdd(rules, rule);
    next = plan.next;
    replaced = !!plan.prev;
    if (input.enabled === false) next = next.map((r) => (sameSlot(r, rule) ? { ...r, enabled: false } : r));
  }
  const saved = ensureIds(next);
  const out = saved.find((r) => sameSlot(r, rule))!;
  return { rule: out, next: saved, warnings: checked.warnings, replaced };
}
