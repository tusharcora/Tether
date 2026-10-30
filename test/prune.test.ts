// Cases ported from deepseek-harness compaction/compaction-tool-result-pruner tests/tool-result-pruner.spec.ts (MIT, © 2026 DeepSeek).
import { describe, expect, it } from 'vitest';
import { DEFAULTS, pruneMarker, pruneText, pruneToolResults } from '../src/adapters/prune.js';

const SMALL = { thresholdChars: 50, headChars: 4, tailChars: 3 };
const points = (s: string) => Array.from(s).length;

describe('tool-result pruning budget', () => {
  it('keeps dsh defaults, frozen', () => {
    expect(DEFAULTS).toEqual({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 });
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});

describe('pruneText', () => {
  it('measures code points and skips text within the threshold', () => {
    expect(pruneText('a😀b', SMALL)).toBeNull();
    expect(pruneText('x'.repeat(50), SMALL)).toBeNull();
  });

  it('keeps the head and tail without splitting surrogate pairs, and says how much it dropped', () => {
    const out = pruneText('😀'.repeat(60), SMALL)!;
    expect(out).toBe(`${'😀'.repeat(4)}${pruneMarker(53)}${'😀'.repeat(3)}`);
    expect(out).toContain('53 chars');
    expect(points(out)).toBeLessThanOrEqual(50);
    expect(out).not.toContain('�');
  });

  it('supports a zero head and tail while still shrinking', () => {
    expect(pruneText('x'.repeat(100), { thresholdChars: 40, headChars: 0, tailChars: 0 })).toBe(pruneMarker(100));
  });

  it('keeps the default budget under the threshold', () => {
    const out = pruneText('y'.repeat(100_000))!;
    expect(points(out)).toBeLessThanOrEqual(DEFAULTS.thresholdChars);
    expect(out.startsWith('y'.repeat(4096) + '\n\n[')).toBe(true);
    expect(out.endsWith(']\n\n' + 'y'.repeat(1024))).toBe(true);
  });
});

describe('pruneToolResults', () => {
  const big = (c: string) => c.repeat(10_000);
  const convo = () => [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'tool', content: big('A') },
    { role: 'tool', content: 'short' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'tool', content: big('C') },
  ];

  it('prunes tool results older than the latest turn, skips short ones and leaves the latest turn whole', () => {
    const m = convo();
    pruneToolResults(m);
    expect(points(m[3]!.content!)).toBeLessThanOrEqual(DEFAULTS.thresholdChars);
    expect(m[3]!.content).toContain(`${10_000 - 4096 - 1024} chars`);
    expect(m[4]!.content).toBe('short');
    expect(m[6]!.content).toBe(big('C'));
    expect(m[1]!.content).toBe('task');
  });

  it('converges in one pass', () => {
    const m = convo();
    pruneToolResults(m);
    const once = JSON.stringify(m);
    pruneToolResults(m);
    expect(JSON.stringify(m)).toBe(once);
  });
});
