// Ported from deepseek-harness compaction/compaction-tool-result-pruner (MIT, © 2026 DeepSeek).
/**
 * Model-free pruning of old tool results in the OpenAI-compatible loop: before each model call, a tool result from an
 * earlier turn that is longer than the threshold keeps its head and tail around a marker saying how much was dropped.
 * Lengths are Unicode code points, so a cut never splits a surrogate pair. The latest turn's results stay whole.
 */

export interface PruneBudget {
  /** Prune when a result is longer than this. */
  thresholdChars: number;
  headChars: number;
  tailChars: number;
}

export const DEFAULTS: Readonly<PruneBudget> = Object.freeze({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 });

export const pruneMarker = (dropped: number): string => `\n\n[... ${dropped} chars pruned ...]\n\n`;

/** The pruned text, or null when it is within the threshold. */
export function pruneText(text: string, b: PruneBudget = DEFAULTS): string | null {
  const points = Array.from(text);
  if (points.length <= b.thresholdChars) return null;
  return points.slice(0, b.headChars).join('') + pruneMarker(points.length - b.headChars - b.tailChars) + points.slice(points.length - b.tailChars).join('');
}

/** Prune, in place, every tool result before the latest assistant message. A second pass changes nothing. */
export function pruneToolResults(messages: { role: string; content: string | null }[]): void {
  let latest = messages.length;
  while (latest > 0 && messages[latest - 1]!.role !== 'assistant') latest--;
  for (let i = 0; i < latest - 1; i++) {
    const m = messages[i]!;
    if (m.role !== 'tool' || !m.content) continue;
    const pruned = pruneText(m.content);
    if (pruned !== null) m.content = pruned;
  }
}
