// Cases ported from deepseek-harness schedule/schedule tests/cron.spec.ts (MIT, © 2026 DeepSeek).
import { describe, expect, it } from 'vitest';
import { CronError, nextFire, parseCron } from '../src/cron.js';

const next = (now: string, expression: string, tz = 'UTC') => {
  const t = nextFire(parseCron(expression), Date.parse(now), tz);
  return t === undefined ? undefined : new Date(t).toISOString();
};

describe('cron expression parsing', () => {
  it('folds Sunday 7 onto 0 and keeps the star flags of the day fields', () => {
    const c = parseCron('0 0 * * 5-7');
    expect([...c.daysOfWeek]).toEqual([0, 5, 6]);
    expect(c.domStar).toBe(true);
    expect(c.dowStar).toBe(false);
    expect(parseCron('30,10,20 * * * *').minutes).toEqual([10, 20, 30]);
    expect(parseCron('*/15 9-17 * * 1-5').hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(parseCron('0 9 */2 * 1').domStar).toBe(true);
    expect(parseCron('0-59 0-23 1-31 1-12 0-7').domStar).toBe(false);
  });

  it.each<[string, string, RegExp]>([
    ['six fields', '0 0 * * * *', /exactly five/],
    ['four fields', '0 0 * *', /exactly five/],
    ['a macro', '@daily', /exactly five/],
    ['last day', '0 0 L * *', /day-of-month/],
    ['nearest weekday', '0 0 15W * *', /day-of-month/],
    ['nth weekday', '0 0 * * 1#2', /day-of-week/],
    ['a month name', '0 0 * JAN *', /month/],
    ['a weekday name', '0 0 * * MON', /day-of-week/],
    ['minute above range', '60 0 * * *', /minute field value 60 is outside 0-59/],
    ['hour above range', '0 24 * * *', /hour field value 24 is outside 0-23/],
    ['day-of-month below range', '0 0 0 * *', /day-of-month field value 0 is outside 1-31/],
    ['day-of-month above range', '0 0 32 * *', /day-of-month field value 32 is outside 1-31/],
    ['month below range', '0 0 * 0 *', /month field value 0 is outside 1-12/],
    ['month above range', '0 0 * 13 *', /month field value 13 is outside 1-12/],
    ['weekday above range', '0 0 * * 8', /day-of-week field value 8 is outside 0-7/],
    ['inverted day-of-month range', '0 0 20-10 * *', /day-of-month field range 20-10 is inverted/],
    ['inverted month range', '0 0 * 12-1 *', /month field range 12-1 is inverted/],
    ['zero step', '*/0 * * * *', /minute field step must be a positive integer/],
    ['zero range step', '0-10/0 * * * *', /minute field step must be a positive integer/],
    ['empty first element', '0,,1 * * * *', /minute field must not contain an empty list element/],
    ['trailing comma', '0 0 * * 1,', /day-of-week field must not contain an empty list element/],
    ['a bare step', '5/2 * * * *', /minute field element "5\/2"/],
    ['a bare star suffix', '*5 * * * *', /minute field element "\*5"/],
    ['a negative value', '-5 * * * *', /minute field element "-5"/],
    ['leading whitespace', ' 0 0 * * *', /non-empty trimmed string/],
    ['trailing whitespace', '0 0 * * * ', /non-empty trimmed string/],
    ['empty text', '', /non-empty trimmed string/],
    ['blank text', ' ', /non-empty trimmed string/],
  ])('rejects %s', (_label, expression, message) => {
    expect(() => parseCron(expression)).toThrow(CronError);
    expect(() => parseCron(expression)).toThrow(message);
  });
});

describe('next fire', () => {
  it('chooses the first strictly future matching minute in the rule zone', () => {
    expect(next('2026-09-16T00:00:00Z', '30 9 * * *', 'Asia/Shanghai')).toBe('2026-09-16T01:30:00.000Z');
  });

  it.each<[string, string]>([
    ['2026-09-16T09:29:59.999Z', '2026-09-16T09:30:00.000Z'],
    ['2026-09-16T09:30:00.000Z', '2026-09-17T09:30:00.000Z'],
    ['2026-09-16T09:30:00.001Z', '2026-09-17T09:30:00.000Z'],
  ])('selects the strictly future instant from %s', (now, at) => {
    expect(next(now, '30 9 * * *')).toBe(at);
  });

  it.each<[string, string, string]>([
    ['2026-04-01T00:00:00Z', '0 0 31 * *', '2026-05-31T00:00:00.000Z'],
    ['2026-01-01T00:00:00Z', '0 0 29 2 *', '2028-02-29T00:00:00.000Z'],
    ['2026-09-16T00:00:00Z', '0 0 1 * *', '2026-10-01T00:00:00.000Z'],
    ['2026-09-16T00:00:00Z', '0 0 * 1 *', '2027-01-01T00:00:00.000Z'],
  ])('selects the next calendar occurrence from %s for %j', (now, expression, at) => {
    expect(next(now, expression)).toBe(at);
  });

  it.each<[string, string, string, string]>([
    ['friday the 13th matches an earlier Friday', '2026-09-01T00:00:00Z', '0 0 13 * 5', '2026-09-04T00:00:00.000Z'],
    ['friday the 13th matches the 13th alone', '2026-09-12T00:00:00Z', '0 0 13 * 5', '2026-09-13T00:00:00.000Z'],
    ['a restricted day-of-month constrains alone', '2026-09-01T00:00:00Z', '0 0 13 * *', '2026-09-13T00:00:00.000Z'],
    ['a restricted day-of-week constrains alone', '2026-09-01T00:00:00Z', '0 0 * * 5', '2026-09-04T00:00:00.000Z'],
    ['two stars match every date', '2026-09-01T00:00:00Z', '0 0 * * *', '2026-09-02T00:00:00.000Z'],
    ['an explicit full day-of-month stays restricted', '2026-09-01T00:00:00Z', '0 0 1-31 * 5', '2026-09-02T00:00:00.000Z'],
    ['an explicit full day-of-week stays restricted', '2026-09-01T00:00:00Z', '0 0 13 * 0-7', '2026-09-02T00:00:00.000Z'],
    ['a stepped day-of-month star accepts an odd matching Monday', '2026-09-01T00:00:00Z', '0 9 */2 * 1', '2026-09-07T09:00:00.000Z'],
    ['a stepped day-of-month star rejects an even matching Monday', '2026-09-13T00:00:00Z', '0 9 */2 * 1', '2026-09-21T09:00:00.000Z'],
    ['a stepped day-of-week star still requires its own match', '2026-09-02T00:00:00Z', '0 9 1-31 * */2', '2026-09-03T09:00:00.000Z'],
    ['two stepped stars require both fields', '2026-09-02T00:00:00Z', '0 9 */2 * */2', '2026-09-03T09:00:00.000Z'],
    ['a stepped day-of-month star with a bare day-of-week star', '2026-09-02T00:00:00Z', '0 9 */2 * *', '2026-09-03T09:00:00.000Z'],
    ['a bare day-of-month star with a stepped day-of-week star', '2026-09-02T00:00:00Z', '0 9 * * */2', '2026-09-03T09:00:00.000Z'],
    ['a bare day-of-month star keeps only the weekday restriction', '2026-09-13T00:00:00Z', '0 9 * * 1', '2026-09-14T09:00:00.000Z'],
    ['a star-led day-of-week keeps the AND rule', '2026-09-07T00:00:00Z', '0 9 1-31 * */7', '2026-09-13T09:00:00.000Z'],
    ['the same day-of-week without a star is OR', '2026-09-07T00:00:00Z', '0 9 1-31 * 0', '2026-09-07T09:00:00.000Z'],
  ])('%s', (_label, now, expression, at) => {
    expect(next(now, expression)).toBe(at);
  });

  it('takes the same-date later time, then the next date', () => {
    expect(next('2026-09-15T10:00:00Z', '0 9,17 * * *')).toBe('2026-09-15T17:00:00.000Z');
    expect(next('2026-09-15T20:00:00Z', '0 9,17 * * *')).toBe('2026-09-16T09:00:00.000Z');
    expect(next('2026-09-16T08:59:59Z', '0 9 * * 1-5')).toBe('2026-09-16T09:00:00.000Z');
  });

  it('fires a time in a skipped DST hour at the first minute after the gap (dsh skips it)', () => {
    // America/New_York jumps from 02:00 EST to 03:00 EDT on 2026-03-08
    expect(next('2026-03-01T00:00:00Z', '30 2 * 3 0', 'America/New_York')).toBe('2026-03-01T07:30:00.000Z');
    expect(next('2026-03-02T00:00:00Z', '30 2 * 3 0', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z');
    expect(next('2026-03-08T07:00:00Z', '30 2 * 3 0', 'America/New_York')).toBe('2026-03-15T06:30:00.000Z');
    // every quarter hour of the skipped hour lands on 03:00 once, then the schedule goes on
    expect(next('2026-03-08T06:50:00Z', '*/15 2,3 * * *', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z');
    expect(next('2026-03-08T07:00:00Z', '*/15 2,3 * * *', 'America/New_York')).toBe('2026-03-08T07:15:00.000Z');
  });

  it('uses the earlier occurrence of a repeated DST hour, once for that date', () => {
    // America/New_York repeats 01:00-01:59 on 2026-11-01 (05:00Z-05:59Z EDT, then 06:00Z-06:59Z EST)
    expect(next('2026-10-25T00:00:00Z', '30 1 * 11 0', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    for (const now of ['2026-11-01T05:30:00Z', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z']) expect(next(now, '30 1 * 11 0', 'America/New_York')).toBe('2026-11-08T06:30:00.000Z');
    expect(next('2026-11-01T05:45:00Z', '*/30 * * * *', 'America/New_York')).toBe('2026-11-01T07:00:00.000Z');
  });

  it('never fires an unsatisfiable rule, and stops at the horizon quickly', () => {
    const start = Date.now();
    expect(next('2026-01-01T00:00:00Z', '0 0 30 2 *')).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('defaults to the machine time zone', () => {
    const c = parseCron('0 9 * * *');
    const at = nextFire(c, Date.parse('2026-09-16T00:00:00Z'))!;
    expect(new Date(at).getHours()).toBe(9);
    expect(new Date(at).getMinutes()).toBe(0);
  });
});
