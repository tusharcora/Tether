// Cases ported from deepseek-harness guard/repeat-tool-reminder tests/repeat-tool-reminder.spec.ts (MIT, © 2026 DeepSeek).
import { describe, expect, it } from 'vitest';
import { GENTLE_REMINDER, RepeatGuard } from '../src/adapters/repeatGuard.js';

/** Observe `n` identical calls; the reminders that came back, with the call count they came at. */
function hammer(g: RepeatGuard, n: number, name = 'probe', args: unknown = { q: 'same' }) {
  const out: { at: number; text: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const r = g.observe(name, args);
    if (r) out.push({ at: i, text: r });
  }
  return out;
}

describe('threshold escalation', () => {
  it('reminds gently at the first default threshold (3) and in detail at 5 and 8', () => {
    const found = hammer(new RepeatGuard(), 8);
    expect(found.map((f) => f.at)).toEqual([3, 5, 8]);
    expect(found[0]!.text).toBe(GENTLE_REMINDER);
    expect(found[0]!.text).toContain('repeating the exact same tool call');
    expect(found[1]!.text).toContain('consecutive_calls: 5');
    expect(found[1]!.text).toContain('- tool: probe');
    expect(found[1]!.text).toContain('{"q":"same"}');
    expect(found[2]!.text).toContain('consecutive_calls: 8');
  });

  it('keys the gentle text to thresholds[0], not the literal 3', () => {
    const found = hammer(new RepeatGuard({ thresholds: [4, 2] }), 4); // unsorted on purpose: normalized ascending
    expect(found.map((f) => f.at)).toEqual([2, 4]);
    expect(found[0]!.text).toContain('repeating the exact same tool call');
    expect(found[1]!.text).toContain('consecutive_calls: 4');
  });
});

describe('chain semantics', () => {
  it('caps the detailed reminder arguments at argumentsPreviewChars (detection still keys on the full string)', () => {
    const big = { body: 'x'.repeat(400) };
    const found = hammer(new RepeatGuard({ thresholds: [2, 3], argumentsPreviewChars: 24 }), 3, 'write', big);
    expect(found).toHaveLength(2);
    expect(found[1]!.text).toContain('- arguments: {"body":"xxxxxxxxxxxxxx');
    expect(found[1]!.text).toContain('… (+387 more chars)');
    expect(found[1]!.text).not.toContain(big.body);
  });

  it('a different call resets the chain', () => {
    const g = new RepeatGuard();
    g.observe('probe', { q: 1 });
    g.observe('probe', { q: 1 });
    g.observe('probe', { q: 2 });
    g.observe('other', { q: 2 });
    expect(hammer(g, 2, 'probe', { q: 1 })).toEqual([]);
    expect(g.observe('probe', { q: 1 })).toBe(GENTLE_REMINDER);
  });

  it('canonicalization ignores property order, deeply', () => {
    const g = new RepeatGuard();
    g.observe('probe', { a: 1, b: { c: 2, d: [{ e: 3, f: 4 }] } });
    g.observe('probe', { b: { d: [{ f: 4, e: 3 }], c: 2 }, a: 1 });
    expect(g.observe('probe', { b: { c: 2, d: [{ e: 3, f: 4 }] }, a: 1 })).toBe(GENTLE_REMINDER);
  });

  it('keys chains per guard: one run repeating never trips another', () => {
    const a = new RepeatGuard();
    const b = new RepeatGuard();
    hammer(a, 2);
    expect(hammer(b, 3)).toHaveLength(1);
    expect(a.observe('probe', { q: 'other' })).toBeUndefined();
  });
});
