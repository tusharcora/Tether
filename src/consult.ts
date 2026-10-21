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
    if (q) out.push({ target: m[1]!.replace(/^[`'"]+|[`'",.]+$/g, ''), question: q.slice(0, MAX_Q) });
  }
  return out;
}

export function stripAsks(output: string): string {
  const lines = output.split('\n');
  const keep: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ASK_LINE.test(lines[i]!)) {
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
