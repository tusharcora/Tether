/**
 * "What is this agent doing right now?" Turns the streamed chunks a step emits into short, typed activity
 * lines (read / edit / run / say …) for the live strips. Pure functions; no I/O.
 */

export type Verb = 'read' | 'edit' | 'run' | 'search' | 'fetch' | 'think' | 'say' | 'note' | 'tool';
export interface Activity {
  verb: Verb;
  text: string;
}

const MAX = 120;

/** Remove control characters (agent output is untrusted and goes straight to a terminal). */
export const clean = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();

const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b|(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}|((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+/gi;
/** Keep obvious credentials out of the event log and the screen. Best effort, not a guarantee. */
export const redact = (s: string) => s.replace(SECRET, (m, a, b, c) => (b ? `${b}***` : c ? `${c}***` : '***'));

const VERB: Record<string, Verb> = {
  read: 'read', view: 'read', cat: 'read', open: 'read', ls: 'read', list: 'read', glob: 'search', grep: 'search', search: 'search', find: 'search',
  edit: 'edit', write: 'edit', multiedit: 'edit', notebookedit: 'edit', create: 'edit', patch: 'edit',
  bash: 'run', shell: 'run', exec: 'run', run: 'run', webfetch: 'fetch', websearch: 'fetch', todowrite: 'think', task: 'think',
};

/** Build the `[tool] …` chunk for one tool call. Shared by adapters so every agent reads the same way in the UI. */
export function toolChunk(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = ['file_path', 'path', 'notebook_path', 'command', 'cmd', 'pattern', 'query', 'url', 'description'].map((k) => i[k]).find((v) => typeof v === 'string') as string | undefined;
  const arg = pick ? clean(redact(pick)).slice(0, MAX) : '';
  return `[tool] ${clean(name).slice(0, 40)}${arg ? ' ' + arg : ''}\n`;
}

/** One line of chunk text → an activity, or nothing for blank lines. */
export function parseLine(raw: string): Activity | undefined {
  const line = clean(raw);
  if (!line) return undefined;
  let m = /^\[tool\]\s+(\S+)\s*(.*)$/.exec(line);
  if (m) {
    const verb = VERB[m[1]!.toLowerCase()] ?? 'tool';
    return { verb, text: verb === 'tool' ? `${m[1]} ${m[2]}`.trim() : m[2] || m[1]! };
  }
  m = /^\[(note|model)\]\s*(.*)$/.exec(line);
  if (m) return { verb: 'note', text: m[2]! };
  return { verb: 'say', text: line.slice(0, MAX) };
}

/** The most recent `n` activities in a step's streamed text (oldest first). */
export function recent(live: string | undefined, n = 3): Activity[] {
  if (!live) return [];
  const out: Activity[] = [];
  const lines = live.split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const a = parseLine(lines[i]!);
    if (a) out.unshift(a);
  }
  return out;
}
