export type SegState = 'done' | 'working' | 'waiting' | 'queued' | 'failed' | 'skipped' | 'planning';
export interface StepLike { id: string; status: string; title?: string }
export interface Segment { id: string; state: SegState; label: string }

const STATE: Record<string, SegState> = { done: 'done', running: 'working', awaiting: 'waiting', queued: 'queued', error: 'failed', skipped: 'skipped' };

/** One segment per step in pipeline order. A team run before its plan is approved has no steps: one "planning" segment. */
export function segmentsFor(steps: StepLike[], o: { planning?: boolean } = {}): Segment[] {
  if (!steps.length) return o.planning ? [{ id: 'planning', state: 'planning', label: 'planning' }] : [];
  return steps.map((s) => ({ id: s.id, state: STATE[s.status] ?? 'queued', label: `${s.title ?? s.id}: ${s.status}` }));
}

export function trackLabel(segs: Segment[]): string {
  if (segs.length === 1 && segs[0]!.state === 'planning') return 'planning';
  const n = (st: SegState) => segs.filter((s) => s.state === st).length;
  const parts = [`${n('done')} of ${segs.length} steps done`];
  if (n('working')) parts.push(`${n('working')} working`);
  if (n('waiting')) parts.push(`${n('waiting')} waiting`);
  if (n('failed')) parts.push(`${n('failed')} failed`);
  return parts.join(', ');
}
