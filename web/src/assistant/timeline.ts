/**
 * The thinking timeline (spec §6.1): Tether's Code Mode scripts as steps with a short human label, read deterministically
 * from the connector calls each script makes (literal arguments only: nothing is guessed). A script that errored or was
 * refused is a dead end; consecutive scripts of one kind collapse into one step.
 */
import type { ToolRun } from './api';

export type StepKind = 'runs' | 'read' | 'search' | 'notes' | 'github' | 'mcp' | 'web' | 'list' | 'discover' | 'code';
export interface Chip {
  kind: 'file' | 'run' | 'note' | 'tool';
  label: string;
  mark?: string;
  title?: string;
}
export interface Step {
  id: string;
  kind: StepKind;
  label: string;
  chips: Chip[];
  /** Scripts in the step. */
  calls: number;
  dead?: true;
  live?: true;
}

interface Call {
  path: string;
  /** The first argument when it is a plain string literal. */
  arg?: string;
}

const CALL = /\b(repo|tether|github|http|codemode|mcp)((?:\.[A-Za-z_$][\w$]*)+)\s*\(\s*(?:(['"`])((?:\\.|(?!\3)[^\\])*?)\3)?/g;

function callsOf(code: string): Call[] {
  return [...code.matchAll(CALL)].map((m) => ({ path: m[1]! + m[2]!, ...(m[4] !== undefined && !m[4].includes('${') ? { arg: m[4] } : {}) }));
}

const is = (p: string) => (c: Call) => c.path === p;
const under = (p: string) => (c: Call) => c.path.startsWith(p);
/** The first rule a script's calls meet names its kind. */
const RULES: [StepKind, (c: Call) => boolean][] = [
  ['runs', under('tether.runs.')],
  ['read', is('repo.read')],
  ['search', is('repo.search')],
  ['notes', under('tether.vault.')],
  ['github', under('github.')],
  ['mcp', under('mcp.')],
  ['web', under('http.')],
  ['list', (c) => c.path === 'repo.list' || c.path === 'repo.diff'],
  ['discover', under('codemode.')],
];
const kindOf = (calls: Call[]): StepKind => RULES.find(([, f]) => calls.some(f))?.[0] ?? 'code';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const argsOf = (calls: Call[], f: (c: Call) => boolean) => uniq(calls.filter(f).map((c) => c.arg));
const base = (p: string) => p.split('/').pop() ?? p;

function labelOf(kind: StepKind, calls: Call[]): string {
  switch (kind) {
    case 'runs': {
      const ids = argsOf(calls, is('tether.runs.get'));
      return ids.length === 1 ? `Opened run ${ids[0]}` : ids.length ? `Opened ${ids.length} runs` : 'Listed recent runs';
    }
    case 'read': {
      const reads = calls.filter(is('repo.read'));
      return reads.every((c) => c.arg !== undefined) ? `Read ${plural(argsOf(reads, () => true).length, 'file')}` : 'Read files';
    }
    case 'search': {
      const s = calls.filter(is('repo.search'));
      return s.length > 1 ? `Searched the codebase ${s.length} times` : s[0]!.arg !== undefined ? `Searched the codebase for "${s[0]!.arg.slice(0, 40)}"` : 'Searched the codebase';
    }
    case 'notes': {
      const read = argsOf(calls, is('tether.vault.read'));
      return read.length ? `Read ${plural(read.length, 'note')}` : 'Searched the notes';
    }
    case 'github':
      return `Checked GitHub: ${uniq(calls.filter(under('github.')).map((c) => c.path.slice(7))).join(', ')}`;
    case 'mcp':
      return `Used ${uniq(calls.filter(under('mcp.')).map((c) => c.path.split('.')[1])).join(', ')}`;
    case 'web':
      return 'Called a web API';
    case 'list':
      return calls.some(is('repo.diff')) ? 'Looked at the uncommitted changes' : 'Looked through the folders';
    case 'discover':
      return 'Looked up the tools';
    default:
      return 'Ran a script';
  }
}

function chipsOf(calls: Call[]): Chip[] {
  const files = argsOf(calls, is('repo.read')).map((p): Chip => ({ kind: 'file', label: base(p), mark: base(p).includes('.') ? base(p).split('.').pop()!.toUpperCase().slice(0, 4) : 'FILE', title: p }));
  const runs = argsOf(calls, is('tether.runs.get')).map((id): Chip => ({ kind: 'run', label: id, mark: 'run', title: `run ${id}` }));
  const notes = argsOf(calls, is('tether.vault.read')).map((p): Chip => ({ kind: 'note', label: base(p).replace(/\.md$/, ''), mark: 'note', title: p }));
  const tools = [...(calls.some(under('github.')) ? ['GitHub'] : []), ...uniq(calls.filter(under('mcp.')).map((c) => c.path.split('.')[1]))].map((label): Chip => ({ kind: 'tool', label }));
  return [...files, ...runs, ...notes, ...tools];
}

/** Why a script failed, in a line: the error's first sentence. */
function reason(output: string | undefined): string {
  const line = (output ?? '').split('\n')[0]!.replace(/^\w*Error:\s*/, '').trim();
  const sentence = line.split(/\.\s/)[0]!.replace(/\.$/, '');
  return sentence.slice(0, 90) || 'the script failed';
}

const isLive = (t: ToolRun, streaming: boolean, last: boolean) => streaming && last && t.output === undefined && !t.isError;

function stepFor(group: ToolRun[], live: boolean): Step {
  const first = group[0]!;
  if (first.isError) return { id: first.id, kind: kindOf(callsOf(first.code)), label: `Dead end: ${reason(first.output)}`, chips: [], calls: 1, dead: true };
  const calls = group.flatMap((t) => callsOf(t.code));
  const kind = kindOf(calls);
  return { id: first.id, kind, label: labelOf(kind, calls), chips: chipsOf(calls), calls: group.length, ...(live ? { live: true as const } : {}) };
}

export const stepOf = (t: ToolRun): Step => stepFor([t], false);

/** The scripts as steps: same-kind neighbours merged, a dead end alone, the last unfinished script live while streaming. */
export function timeline(tools: ToolRun[], streaming: boolean): Step[] {
  const groups: { tools: ToolRun[]; kind: StepKind; live: boolean }[] = [];
  tools.forEach((t, i) => {
    const live = isLive(t, streaming, i === tools.length - 1);
    const kind = kindOf(callsOf(t.code));
    const prev = groups.at(-1);
    if (prev && !t.isError && !prev.tools[0]!.isError && !live && !prev.live && prev.kind === kind) prev.tools.push(t);
    else groups.push({ tools: [t], kind, live });
  });
  return groups.map((g) => stepFor(g.tools, g.live));
}

/** The finished row's line: "3 calls · 6 files · 1 run". */
export function thinkingSummary(tools: ToolRun[]): string {
  const calls = tools.flatMap((t) => callsOf(t.code));
  const parts: [number, string][] = [
    [tools.length, 'call'],
    [argsOf(calls, is('repo.read')).length, 'file'],
    [argsOf(calls, is('tether.runs.get')).length, 'run'],
    [argsOf(calls, is('tether.vault.read')).length, 'note'],
  ];
  return parts
    .filter(([k]) => k > 0)
    .map(([k, w]) => plural(k, w))
    .join(' · ');
}
