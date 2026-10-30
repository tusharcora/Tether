// Ported from deepseek-harness guard/repeat-tool-reminder (MIT, © 2026 DeepSeek).
/**
 * Advisory repeat-call detector for the OpenAI-compatible loop, one per run: it counts consecutive identical tool calls
 * (same name, same arguments after a deep key sort) and, when the count hits a threshold, returns a reminder the loop
 * appends to that call's result. It never blocks or rewrites a call; failed calls count too.
 */

export const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. ' +
  'Carefully analyze the previous result before calling again: if the task is ' +
  'not complete, try a different approach or different arguments instead of ' +
  'repeating the call.';

const detailedReminder = (tool: string, count: number, args: string): string =>
  'Repeated tool call detected:\n' +
  `- tool: ${tool}\n` +
  `- consecutive_calls: ${count}\n` +
  `- arguments: ${args}\n` +
  'The repeated calls are not making progress. Do not call this tool with ' +
  'these exact arguments again. Inspect the latest result and choose a ' +
  'different action, different arguments, or finish the task if enough ' +
  'evidence has been gathered.';

function sortJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortJson);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortJson((v as Record<string, unknown>)[k])]));
  return v;
}

export class RepeatGuard {
  private readonly thresholds: number[];
  private readonly preview: number;
  private chain?: { key: string; count: number };

  constructor(o: { thresholds?: number[]; argumentsPreviewChars?: number } = {}) {
    this.thresholds = [...(o.thresholds ?? [3, 5, 8])].sort((a, b) => a - b);
    this.preview = o.argumentsPreviewChars ?? 500;
  }

  /** Count one call; the reminder to append to its result when this run length hits a threshold. */
  observe(name: string, args: unknown): string | undefined {
    const canonical = JSON.stringify(sortJson(args)) ?? 'null';
    const key = JSON.stringify([name, canonical]);
    const count = this.chain?.key === key ? this.chain.count + 1 : 1;
    this.chain = { key, count };
    if (!this.thresholds.includes(count)) return undefined;
    if (count === this.thresholds[0]) return GENTLE_REMINDER;
    // the cap bounds the reminder, never the detection: the key above compares the full string
    const shown = canonical.length <= this.preview ? canonical : `${canonical.slice(0, this.preview)}… (+${canonical.length - this.preview} more chars)`;
    return detailedReminder(name, count, shown);
  }
}
