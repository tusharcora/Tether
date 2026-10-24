/**
 * ECC ("Everything Claude Code", github.com/affaan-m/ECC, MIT): turn its agent, skill and command files into aorch data.
 * Pure: no fs or network here (see eccImport.ts). Hooks and rules are never read.
 */
import { BOT_ID_RE, BUILTIN_IDS, IMPORTED_PERSONA_MAX, SOURCE_RE, sanitizeBot, type BotDef } from './crew.js';

export const ECC_REPO = 'https://github.com/affaan-m/ECC';
export const ECC_REF = 'v2.2.3';

export interface EccFront {
  name?: string;
  description?: string;
  tools: string[];
  model?: string;
  argumentHint?: string;
}

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2');

export function parseFront(text: string): { front: EccFront; body: string } {
  const t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n(?:([\s\S]*?)\n)?---\n?/.exec(t);
  const front: EccFront = { tools: [] };
  if (!m) return { front, body: t.trim() };
  for (const line of (m[1] ?? '').split('\n')) {
    const kv = /^([a-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, raw] = kv;
    const v = unquote(raw!);
    if (!v) continue;
    if (k === 'name') front.name = v;
    else if (k === 'description') front.description = v;
    else if (k === 'model') front.model = v;
    else if (k === 'argument-hint') front.argumentHint = v;
    else if (k === 'tools') front.tools = v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return { front, body: t.slice(m[0].length).trim() };
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const words = (s: string) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** One ECC agent file as a bot. `taken` = ids of bots that are not from ECC (built-ins are always taken). */
export function agentToBot(fileName: string, text: string, ref: string, taken: ReadonlySet<string>): { bot?: BotDef; note?: string; error?: string } {
  if (!SOURCE_RE.test(`ecc@${ref}`)) return { error: `ref "${ref}" is not a valid version tag` };
  const { front, body } = parseFront(text);
  const name = (front.name ?? fileName.replace(/\.md$/, '')).trim();
  if (!NAME_RE.test(name)) return { error: `${fileName}: name "${name}" is not lowercase-with-dashes` };
  let id = BUILTIN_IDS.has(name) || taken.has(name) ? `ecc-${name}` : name;
  let note: string | undefined;
  if (!BOT_ID_RE.test(id)) {
    const short = id.slice(0, 24).replace(/[-_]+$/, '');
    note = `${name}: id shortened to "${short}"`;
    id = short;
  }
  if (!BOT_ID_RE.test(id) || BUILTIN_IDS.has(id) || taken.has(id)) return { error: `${fileName}: no free id for "${name}"` };
  const writes = front.tools.some((t) => WRITE_TOOLS.test(t));
  const kind = /-reviewer$/.test(name) ? 'verdict' : 'agent';
  const { bot, error } = sanitizeBot({
    id,
    name: words(name).slice(0, 24),
    title: name.replace(/-/g, ' ').slice(0, 28),
    kind,
    readOnly: kind === 'agent' && front.tools.length > 0 && !writes,
    persona: body.slice(0, IMPORTED_PERSONA_MAX),
    whenToUse: front.description ?? '',
    modelHint: front.model,
    source: `ecc@${ref}`,
    look: { color: SWATCH[hash(name) % SWATCH.length] },
  });
  return error ? { error: `${fileName}: ${error}` } : { bot, ...(note ? { note } : {}) };
}

export interface Routing {
  /** Agent names in the "Available Agents" table, in table order. */
  table: string[];
  /** "Agent Orchestration" lines: when -> agent names. */
  rules: { when: string; agents: string[] }[];
}

function section(md: string, title: string): string {
  const parts = md.replace(/\r\n?/g, '\n').split(/^## /m);
  return parts.find((p) => p.startsWith(`${title}\n`))?.slice(title.length + 1) ?? '';
}

export function parseRouting(md: string): Routing {
  const table = section(md, 'Available Agents')
    .split('\n')
    .flatMap((l) => {
      const m = /^\|\s*([a-z][a-z0-9-]*)\s*\|/.exec(l);
      return m && m[1] !== 'agent' ? [m[1]!] : [];
    });
  const rules = section(md, 'Agent Orchestration')
    .split('\n')
    .flatMap((l) => {
      const m = /^- (.+?)\s*→\s*(.+)$/.exec(l);
      if (!m) return [];
      const agents = [...m[2]!.matchAll(/\*\*ecc:([a-z0-9-]+)\*\*/g)].map((x) => x[1]!);
      return agents.length ? [{ when: m[1]!.trim(), agents }] : [];
    });
  return { table, rules };
}
