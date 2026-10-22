import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AdapterRegistry } from './adapters/index.js';
import { CREW } from './bots.js';
import { STEP_TYPES } from './composer.js';
import {
  DEFAULT_SETTINGS,
  SUPPORTED_MODES,
  type Edge,
  type Mode,
  type Pipeline,
  type PipelineNode,
  type PipelineSettings,
} from './types.js';

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KINDS = new Set(['agent', 'gate', 'approval']);
const MODES = new Set<Mode>(['pipeline', 'swarm', 'orchestration']);

export interface Issue {
  level: 'error' | 'warn';
  node?: string;
  message: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Turn untrusted JSON/YAML into a well-formed Pipeline, or throw with a precise message. */
export function normalizePipeline(raw: unknown, fallbackName = 'untitled'): Pipeline {
  if (!isObj(raw)) throw new Error('pipeline must be an object');
  const name = str(raw.name) ?? fallbackName;
  if (!NAME_RE.test(name)) throw new Error(`invalid pipeline name "${name}" (letters, digits, . _ - ; max 64)`);
  const mode = (str(raw.mode) ?? 'pipeline') as Mode;
  if (!MODES.has(mode)) throw new Error(`unknown mode "${mode}"`);
  if (!Array.isArray(raw.nodes)) throw new Error('pipeline.nodes must be an array');

  const nodes: PipelineNode[] = raw.nodes.map((rn, i) => {
    if (!isObj(rn)) throw new Error(`nodes[${i}] must be an object`);
    const id = str(rn.id);
    if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error(`nodes[${i}].id must match [A-Za-z0-9_-]{1,40}`);
    if (id.toLowerCase() === 'user') throw new Error(`nodes[${i}].id "user" is reserved (it is how a step addresses the person: @ASK user:)`);
    const kind = (str(rn.kind) ?? 'agent') as PipelineNode['kind'];
    if (!KINDS.has(kind)) throw new Error(`node "${id}": unknown kind "${kind}"`);
    const n: PipelineNode = {
      id,
      kind,
      role: str(rn.role),
      title: str(rn.title),
      x: num(rn.x) ?? 80 + (i % 4) * 260,
      y: num(rn.y) ?? 80 + Math.floor(i / 4) * 180,
      agent: str(rn.agent),
      model: str(rn.model),
      prompt: str(rn.prompt),
      permissionMode: str(rn.permissionMode),
      readOnly: bool(rn.readOnly),
      includeDiff: bool(rn.includeDiff),
      verdict: bool(rn.verdict),
      vault: bool(rn.vault),
      command: str(rn.command),
      fixNode: str(rn.fixNode),
      maxLoops: num(rn.maxLoops),
      manager: bool(rn.manager),
      roster: Array.isArray(rn.roster) ? rn.roster.filter((r): r is string => typeof r === 'string' && r.length > 0) : undefined,
    };
    if (isObj(rn.mock)) n.mock = rn.mock as PipelineNode['mock'];
    return n;
  });

  const edges: Edge[] = (Array.isArray(raw.edges) ? raw.edges : []).map((re, i) => {
    if (!isObj(re) || !str(re.from) || !str(re.to)) throw new Error(`edges[${i}] needs "from" and "to"`);
    return { from: re.from as string, to: re.to as string };
  });

  const rs = isObj(raw.settings) ? raw.settings : {};
  const settings: PipelineSettings = {
    parallel: Math.min(16, Math.max(1, Math.trunc(num(rs.parallel) ?? DEFAULT_SETTINGS.parallel))),
    nodeTimeoutMs: Math.max(1000, num(rs.nodeTimeoutMs) ?? DEFAULT_SETTINGS.nodeTimeoutMs),
    maxCostUsd: num(rs.maxCostUsd),
    wallClockMs: num(rs.wallClockMs),
    pipeMode: rs.pipeMode === 'direct' ? 'direct' : 'ancestors',
    setup: str(rs.setup),
    consult: rs.consult === true ? 2 : num(rs.consult) ? Math.min(4, Math.max(0, Math.trunc(num(rs.consult)!))) : undefined,
    maxDepth: num(rs.maxDepth) !== undefined ? Math.min(5, Math.max(1, Math.trunc(num(rs.maxDepth)!))) : undefined,
    maxSpawn: num(rs.maxSpawn) !== undefined ? Math.min(30, Math.max(1, Math.trunc(num(rs.maxSpawn)!))) : undefined,
    planApproval: bool(rs.planApproval),
    planPreapproved: bool(rs.planPreapproved),
    allowWrites: bool(rs.allowWrites),
    handoff: num(rs.handoff) !== undefined && num(rs.handoff)! >= 1 ? Math.min(3, Math.trunc(num(rs.handoff)!)) : undefined,
    allowWorkerWrites: bool(rs.allowWorkerWrites),
  };
  return { name, version: 1, mode, nodes, edges, settings };
}

export function loadPipelineFile(path: string): Pipeline {
  const text = readFileSync(path, 'utf8');
  const ext = extname(path).toLowerCase();
  const raw = ext === '.yaml' || ext === '.yml' ? parseYaml(text) : JSON.parse(text);
  const base = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  return normalizePipeline(raw, NAME_RE.test(base) ? base : 'untitled');
}

export function parentsOf(p: Pipeline, id: string): string[] {
  return p.edges.filter((e) => e.to === id).map((e) => e.from);
}
export function childrenOf(p: Pipeline, id: string): string[] {
  return p.edges.filter((e) => e.from === id).map((e) => e.to);
}

/** Kahn's algorithm. Throws on a cycle. Layers are the maximal sets runnable together. */
export function topoLayers(p: Pipeline): string[][] {
  const indeg = new Map(p.nodes.map((n) => [n.id, 0]));
  for (const e of p.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const layers: string[][] = [];
  let frontier = p.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  let seen = 0;
  while (frontier.length) {
    layers.push(frontier);
    seen += frontier.length;
    const next: string[] = [];
    for (const id of frontier)
      for (const c of childrenOf(p, id)) {
        const d = (indeg.get(c) ?? 0) - 1;
        indeg.set(c, d);
        if (d === 0) next.push(c);
      }
    frontier = next;
  }
  if (seen !== p.nodes.length) throw new Error('graph has a cycle');
  return layers;
}

/** All transitive upstream node ids, in execution order. */
export function ancestorsOf(p: Pipeline, id: string): string[] {
  const set = new Set<string>();
  const walk = (x: string) => {
    for (const par of parentsOf(p, x)) {
      if (!set.has(par)) {
        set.add(par);
        walk(par);
      }
    }
  };
  walk(id);
  const order = topoLayers(p).flat();
  return order.filter((n) => set.has(n));
}

/** Everything that must be true before a run is allowed to spend money. */
export function preflight(p: Pipeline, registry?: AdapterRegistry): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, node?: string) => issues.push({ level: 'error', node, message });
  const warn = (message: string, node?: string) => issues.push({ level: 'warn', node, message });

  if (!SUPPORTED_MODES.includes(p.mode)) {
    err(`mode "${p.mode}" has no scheduler in this build (supported: ${SUPPORTED_MODES.join(', ')})`);
  }
  if (!p.nodes.length) err('pipeline has no nodes');

  const ids = new Set<string>();
  for (const n of p.nodes) {
    if (ids.has(n.id)) err(`duplicate node id "${n.id}"`, n.id);
    ids.add(n.id);
  }
  for (const e of p.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) err(`edge ${e.from} → ${e.to} references a missing node`);
    if (e.from === e.to) err(`edge ${e.from} → ${e.to} is a self-loop`);
  }
  let acyclic = true;
  try {
    topoLayers(p);
  } catch (e) {
    acyclic = false;
    err((e as Error).message);
  }

  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  let gates = 0;
  for (const n of p.nodes) {
    if (n.kind === 'agent') {
      const a = n.agent ?? 'claude';
      if (registry && !registry.has(a)) err(`unknown agent adapter "${a}" (known: ${registry.ids().join(', ')})`, n.id);
      if (p.settings.maxCostUsd !== undefined && registry?.has(a) && !registry.get(a).reportsCost) {
        warn(`adapter "${a}" does not report cost, so maxCostUsd cannot be enforced for this node`, n.id);
      }
    } else if (n.verdict) {
      err('only agent nodes can produce a verdict', n.id);
    }
    if (n.kind === 'gate') {
      gates++;
      if (!n.command) err('gate needs a command', n.id);
    }
    if (n.manager) {
      if (n.kind !== 'agent') err('only agent nodes can be managers', n.id);
      if (n.fixNode) warn('a manager with a fixNode may spawn work that the fix loop then re-runs', n.id);
    }
    for (const r of n.roster ?? []) {
      if (!CREW[r] && !(STEP_TYPES as string[]).includes(r)) err(`roster entry "${r}" is not a known bot or role`, n.id);
      else if (['tester', 'approval', 'manager'].includes(r) || ['orchestrator', 'gate', 'approval'].includes(CREW[r]?.def?.kind ?? '')) err(`roster entry "${r}" cannot take hand-offs (gates, approvals, managers and orchestrators are not workers)`, n.id);
    }
    if (n.fixNode) {
      const fx = byId.get(n.fixNode);
      if (n.kind === 'approval') err('approval nodes cannot have a fixNode', n.id);
      else if (!fx) err(`fixNode "${n.fixNode}" does not exist`, n.id);
      else if (fx.kind !== 'agent') err(`fixNode "${n.fixNode}" must be an agent node`, n.id);
      else if (acyclic && !ancestorsOf(p, n.id).includes(fx.id)) err(`fixNode "${fx.id}" must be upstream of "${n.id}"`, n.id);
      if (n.kind === 'agent' && !n.verdict) warn('fixNode has no effect unless the node produces a verdict', n.id);
    }
  }
  if (p.nodes.length && gates === 0) {
    warn('no gate node: agents grade their own work, and nothing independent verifies it');
  }
  return issues;
}
