// Ported from deepseek-harness schedule/schedule (MIT, © 2026 DeepSeek): its five-field cron dialect and next-fire walk.
/**
 * Five-field cron: minute hour day-of-month month day-of-week, each `*`, a value, `a-b`, `*\/n`, `a-b/n` or a comma list
 * of those; Sunday is 0 or 7; no names, macros or L/W/#. Day-of-month and day-of-week follow Vixie cron: when either
 * field starts with `*` a date must match both, otherwise either one.
 *
 * Next fire is computed in a time zone (the machine's by default) with Intl, no Temporal. DST: a time that falls in a
 * skipped hour fires at the first minute after the gap (dsh skips it instead); a repeated hour fires once, the earlier.
 */

export class CronError extends Error {}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  /** Highest value kept after folding Sunday 7 onto 0. */
  canonicalMax: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59, canonicalMax: 59 },
  { name: 'hour', min: 0, max: 23, canonicalMax: 23 },
  { name: 'day-of-month', min: 1, max: 31, canonicalMax: 31 },
  { name: 'month', min: 1, max: 12, canonicalMax: 12 },
  { name: 'day-of-week', min: 0, max: 7, canonicalMax: 6 },
];

export interface Cron {
  minutes: number[];
  hours: number[];
  daysOfMonth: Set<number>;
  months: Set<number>;
  /** Sunday 0 through Saturday 6. */
  daysOfWeek: Set<number>;
  /** The field text starts with `*` (Vixie's DOM_STAR / DOW_STAR). */
  domStar: boolean;
  dowStar: boolean;
}

/** Longest forward walk of the date search, in years: a rule with no match inside it never fires. */
export const CRON_SEARCH_HORIZON_YEARS = 400;

const invalid = (spec: FieldSpec, element: string) => new CronError(`${spec.name} field element ${JSON.stringify(element)} must be *, a value, a-b, */n, a-b/n, or a comma-separated list of those.`);

function value(text: string, spec: FieldSpec): number {
  const v = Number(text);
  if (!Number.isSafeInteger(v) || v < spec.min || v > spec.max) throw new CronError(`${spec.name} field value ${text} is outside ${spec.min}-${spec.max}.`);
  return v;
}

function step(text: string, spec: FieldSpec): number {
  const s = Number(text);
  if (!Number.isSafeInteger(s) || s < 1) throw new CronError(`${spec.name} field step must be a positive integer.`);
  return s;
}

/** One comma-separated field's matched values, ascending, Sunday 7 folded onto 0. */
function fieldValues(raw: string, spec: FieldSpec): number[] {
  const matched = new Set<number>();
  for (const element of raw.split(',')) {
    if (element.length === 0) throw new CronError(`${spec.name} field must not contain an empty list element.`);
    if (element === '*') {
      for (let v = spec.min; v <= spec.max; v++) matched.add(v);
      continue;
    }
    if (element.startsWith('*')) {
      const m = /^\*\/(\d+)$/.exec(element);
      if (!m) throw invalid(spec, element);
      const s = step(m[1]!, spec);
      for (let v = spec.min; v <= spec.max; v += s) matched.add(v);
      continue;
    }
    const m = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(element);
    if (!m) throw invalid(spec, element);
    const start = value(m[1]!, spec);
    if (m[2] === undefined) {
      if (m[3] !== undefined) throw invalid(spec, element);
      matched.add(start);
      continue;
    }
    const last = value(m[2], spec);
    if (start > last) throw new CronError(`${spec.name} field range ${start}-${last} is inverted.`);
    const s = m[3] === undefined ? 1 : step(m[3], spec);
    for (let v = start; v <= last; v += s) matched.add(v);
  }
  return [...new Set([...matched].map((v) => (spec.canonicalMax !== spec.max && v === spec.max ? spec.min : v)))].sort((a, b) => a - b);
}

/** Parse a strict five-field expression; throws a CronError that says what to fix. */
export function parseCron(expression: string): Cron {
  if (typeof expression !== 'string' || !expression || expression.trim() !== expression) throw new CronError('cron must be a non-empty trimmed string.');
  const fields = expression.split(/\s+/);
  if (fields.length !== 5) throw new CronError('cron must contain exactly five whitespace-separated fields: minute hour day-of-month month day-of-week.');
  const [mi, h, dom, mo, dow] = fields.map((f, i) => fieldValues(f, FIELDS[i]!)) as [number[], number[], number[], number[], number[]];
  return { minutes: mi, hours: h, daysOfMonth: new Set(dom), months: new Set(mo), daysOfWeek: new Set(dow), domStar: fields[2]!.startsWith('*'), dowStar: fields[4]!.startsWith('*') };
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const formats = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock minute at `ms` in `tz`, as the UTC timestamp of those calendar fields. */
function wall(ms: number, tz: string): number {
  let f = formats.get(tz);
  if (!f) formats.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })));
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(ms)) p[x.type] = x.value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}

/** The instant of wall-clock minute `w` in `tz`: the earlier one of a repeated time, the first minute after the gap for a skipped one. */
function instant(w: number, tz: string): number {
  // the zone's offset a day either side: at most one transition lies between them
  const candidates = [w - (wall(w - DAY, tz) - (w - DAY)), w - (wall(w + DAY, tz) - (w + DAY))];
  const real = candidates.filter((t) => wall(t, tz) === w);
  if (real.length) return Math.min(...real);
  let t = Math.max(...candidates);
  while (wall(t - MINUTE, tz) > w) t -= MINUTE;
  return t;
}

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The first fire strictly after `after` (ms), or undefined when the rule never fires within the search horizon. */
export function nextFire(c: Cron, after: number, tz: string = localZone()): number | undefined {
  const floor = wall(after, tz);
  const first = Math.floor(floor / DAY) * DAY;
  const lastDay = Date.UTC(new Date(first).getUTCFullYear() + CRON_SEARCH_HORIZON_YEARS, 0, 1);
  for (let day = first; day <= lastDay; ) {
    const d = new Date(day);
    if (!c.months.has(d.getUTCMonth() + 1)) {
      day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      continue;
    }
    const dom = c.daysOfMonth.has(d.getUTCDate());
    const dow = c.daysOfWeek.has(d.getUTCDay());
    if (c.domStar || c.dowStar ? dom && dow : dom || dow) {
      for (const h of c.hours) {
        for (const m of c.minutes) {
          const w = day + h * 3_600_000 + m * MINUTE;
          if (w < floor) continue;
          const t = instant(w, tz);
          if (t > after) return t;
        }
      }
    }
    day += DAY;
  }
  return undefined;
}
