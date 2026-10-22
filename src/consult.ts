// Bots asking each other. A running step may ask a step that has already finished (why did you do that? what about this bug?)
// by ending its answer with `@ASK <step>: <question>`. The engine puts the question to that step, read-only, and gives the
// answer back so the asker can finish. Bounded and logged; nothing here can change files.
import type { PipelineNode, RunState } from './types.js';

export interface Ask {
  target: string;
  question: string;
}

const ASK_LINE = /^[ \t]*@ask[ \t]+([^\s:]+)[ \t]*:[ \t]*(.*)$/i;
const MAX_Q = 1500;

/** Questions a step put at the end of its answer. A question may continue on the lines after `@ASK x:` until a blank line. */
export function parseAsks(output: string): Ask[] {
  const out: Ask[] = [];
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = ASK_LINE.exec(lines[i]!);
    if (!m) continue;
    let q = m[2]!.trim();
    while (i + 1 < lines.length && lines[i + 1]!.trim() && !ASK_LINE.test(lines[i + 1]!)) q += ' ' + lines[++i]!.trim();
    // `@ASK user:` is a question for the person (parseUserAsks), never a consult of a step called "user"
    if (q && !isUserTarget(m[1]!)) out.push({ target: m[1]!.replace(/^[`'"]+|[`'",.]+$/g, ''), question: q.slice(0, MAX_Q) });
  }
  return out;
}

const isUserTarget = (t: string) => t.toLowerCase() === 'user';

export function stripAsks(output: string): string {
  const lines = output.split('\n');
  const keep: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ASK_LINE.exec(lines[i]!);
    // a question for the person stays in the text until stripUserAsks takes it out
    if (m && !isUserTarget(m[1]!)) {
      while (i + 1 < lines.length && lines[i + 1]!.trim() && !ASK_LINE.test(lines[i + 1]!)) i++;
      continue;
    }
    keep.push(lines[i]!);
  }
  return keep.join('\n').trimEnd();
}

/** Steps that have finished with an answer and may be asked about, including a reviewer that just sent work back for a fix. Never the asker itself; never a gate or approval. */
export function askable(st: RunState, asker: PipelineNode): PipelineNode[] {
  return st.pipeline.nodes.filter((n) => {
    const ns = st.nodes[n.id];
    return n.kind === 'agent' && n.id !== asker.id && !!ns?.output?.trim() && (ns.status === 'done' || ns.loops > 0);
  });
}

/** Match a name the asker used (step id, role or title) to one askable step. */
export function resolveTarget(st: RunState, asker: PipelineNode, name: string): PipelineNode | undefined {
  const list = askable(st, asker);
  const q = name.toLowerCase();
  return list.find((n) => n.id.toLowerCase() === q) ?? list.find((n) => (n.role ?? '').toLowerCase() === q) ?? list.find((n) => (n.title ?? '').toLowerCase() === q);
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, Math.floor(max / 2))}\n[... ${s.length - max} chars omitted ...]\n${s.slice(-Math.floor(max / 2))}`);
const label = (n: PipelineNode) => `${n.role ?? n.kind} (${n.id})`;

/** What the asked step is told. It may have its own session (it remembers), or only its earlier answer. */
export function consultPrompt(st: RunState, asker: PipelineNode, target: PipelineNode, question: string, resumed: boolean): string {
  const parts = [`# A teammate has a question for you\n${label(asker)}, a later step in the same pipeline, is asking you about the work you already finished. Answer it directly and briefly from what you know and did. Do not modify any files and do not start new work.`];
  if (!resumed) parts.push(`# What you produced earlier\n${clip(st.nodes[target.id]?.output ?? '', 8000)}`, `# The task\n${st.task}`);
  parts.push(`# Question\n${question}`);
  return parts.join('\n\n');
}

/** The follow-up the asker receives once its questions are answered. */
export function answersBlock(items: { to: string; question: string; answer: string }[]): string {
  const body = items.map((a, i) => `${i + 1}. You asked ${a.to}: ${a.question}\n   Answer: ${clip(a.answer, 6000).replace(/\n/g, '\n   ')}`).join('\n\n');
  return `# Answers to your questions\n${body}\n\nNow give your complete final answer. Do not repeat the questions or add new @ASK lines unless the answer truly changes what you must do.`;
}

// ---- Questions to the person: `@ASK user: <question> | options: a; b; c | recommended: b | why: <reason>` ----

export interface UserAsk {
  question: string;
  why?: string;
  /** Option labels, in order (at most 6). Empty: a free-text question. */
  options: string[];
  /** The label of the recommended option: the one named, else the first. Absent when there are no options. */
  recommended?: string;
}

const USER_ASK_LINE = /^@ASK[ \t]+user[ \t]*:[ \t]*(.*)$/i;
const MAX_USER_ASKS = 4;
const MAX_USER_OPTIONS = 6;

/** Lines of the output, flagged when they are a real `@ASK user:` line: at column 0 and outside ``` fences. CRLF tolerated. */
function scanUserAsks(output: string): { raw: string; line: string; ask: boolean }[] {
  let fenced = false;
  return output.split('\n').map((raw) => {
    const line = raw.replace(/\r$/, '');
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return { raw, line, ask: false };
    }
    return { raw, line, ask: !fenced && USER_ASK_LINE.test(line) };
  });
}

/** One line of model text for the person: control characters (terminal escapes) dropped, whitespace collapsed. */
const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Questions a step put to the person on their own lines (at most four). */
export function parseUserAsks(output: string): UserAsk[] {
  const out: UserAsk[] = [];
  for (const { line, ask } of scanUserAsks(output)) {
    const m = ask ? USER_ASK_LINE.exec(line) : null;
    if (!m) continue;
    const [head = '', ...rest] = m[1]!.split(/\s\|\s/);
    const question = clean(head, MAX_Q);
    if (!question) continue;
    let options: string[] = [];
    let want = '';
    let why: string | undefined;
    for (const part of rest) {
      const kv = /^\s*(options|recommended|why)\s*:\s*(.*)$/i.exec(part);
      if (!kv) continue;
      const key = kv[1]!.toLowerCase();
      if (key === 'options') options = [...new Set(kv[2]!.split(';').map((o) => clean(o, 120)).filter(Boolean))].slice(0, MAX_USER_OPTIONS);
      else if (key === 'recommended') want = clean(kv[2]!, 120);
      else why = clean(kv[2]!, 300) || undefined;
    }
    const pick = options.find((o) => o.toLowerCase() === want.toLowerCase()) ?? options[/^\d+$/.test(want) ? Number(want) - 1 : -1] ?? options[0];
    out.push({ question, ...(why ? { why } : {}), options, ...(pick ? { recommended: pick } : {}) });
    if (out.length >= MAX_USER_ASKS) break;
  }
  return out;
}

/** The output without its `@ASK user:` lines. */
export function stripUserAsks(output: string): string {
  return scanUserAsks(output).filter((l) => !l.ask).map((l) => l.raw).join('\n').trimEnd();
}
