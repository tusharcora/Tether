import { StatusBadge, type Tone } from './StatusBadge';

export { toneFor, type Tone } from './StatusBadge';

/** Alias kept while callers move to StatusBadge (Task 14 deletes it). */
export const StatusChip = (p: { tone: Tone; label: string; pulse?: boolean; className?: string }) => <StatusBadge tone={p.tone} label={p.label} pulse={p.pulse} className={p.className} />;
