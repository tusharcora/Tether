import { describeEvent, type StoredEvent } from '../api';

export interface OutputLine {
  seq: number;
  ts: number;
  who: string;
  text: string;
  tone: string;
  node?: string;
}
export const OUTPUT_KEEP = 200;

/** The step an event is about: its `node` (a step id), the sender of a hand-off or consult, a loop's check, a spawn's parent. */
export function nodeOf(e: StoredEvent['event']): string | undefined {
  if (e.type === 'handoff' || e.type === 'consult') return e.from;
  if (e.type === 'loop') return e.check;
  if (e.type === 'node.spawned') return e.parent;
  const n = (e as { node?: unknown }).node;
  return typeof n === 'string' ? n : undefined;
}

/** The live output: one line per described event, oldest first, prefixed by the bot (or tether), the last OUTPUT_KEEP. */
export function outputLines(events: StoredEvent[], nameOf: (id: string) => string): OutputLine[] {
  const out: OutputLine[] = [];
  for (const e of events) {
    const d = describeEvent(e.event, nameOf);
    if (!d) continue;
    const node = nodeOf(e.event);
    const who = node ? nameOf(node) : 'tether';
    out.push({ seq: e.seq, ts: e.ts, who, text: d.text.startsWith(`${who} `) ? d.text.slice(who.length + 1) : d.text, tone: d.tone, node });
  }
  return out.slice(-OUTPUT_KEEP);
}
