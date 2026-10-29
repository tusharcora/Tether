import { describe, expect, it } from 'vitest';
import { AUTO_COMPACT, contextView, estimate, foldable, knownSize, latestContext, overflows, RESERVED } from '../src/assistant/context.js';
import type { ChatMessage, ContextUse } from '../src/assistant/types.js';

const use = (o: Partial<ContextUse> = {}): ContextUse => ({
  parts: { prompt: [['Who Tether is', 4000]], tools: [['run_code', 2000], ['Code Mode notes', 400]], memory: [['Notes from the graph', 800]], messages: [['3 earlier messages', 1200], ['This message', 100]] },
  agent: 'claude',
  model: 'opus',
  size: 200_000,
  ...o,
});
const msg = (id: string, o: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: id.startsWith('y') ? 'you' : 'tether', text: id, at: 1, ...o });

describe('contextView', () => {
  it('estimates from characters (about), with room for the reply and what is free', () => {
    const v = contextView(use())!;
    expect(v.about).toBe(true);
    const by = Object.fromEntries(v.parts.map((p) => [p.key, p.tokens]));
    expect(by).toEqual({ prompt: 1000, tools: 600, memory: 200, messages: 325, reserved: RESERVED, free: 200_000 - (2125 + RESERVED) });
    expect(v.used).toBe(2125 + RESERVED);
    expect(v.pct).toBe(Math.round(((2125 + RESERVED) / 200_000) * 100));
    expect(v.parts.map((p) => p.label)).toEqual(["Tether's prompt", 'Tools', 'Memory', 'Messages', 'Reserved', 'Free']);
    expect(v.untilAuto).toBe(Math.round(AUTO_COMPACT * 200_000) - v.used);
  });

  it('takes the reported count: what Tether did not send is the agent’s own prompt and tools', () => {
    const v = contextView(use({ tokens: 20_125 }))!;
    expect(v.about).toBe(false);
    const tools = v.parts.find((p) => p.key === 'tools')!;
    expect(tools.items).toContainEqual(["Agent's own prompt and tools", 18_000]);
    expect(tools.tokens).toBe(18_600);
    expect(v.used).toBe(20_125 + RESERVED);
  });

  it('scales the parts down when the report is below the estimate', () => {
    const v = contextView(use({ tokens: 1000 }))!;
    const sent = v.parts.filter((p) => p.key !== 'reserved' && p.key !== 'free').reduce((a, p) => a + p.tokens, 0);
    expect(Math.abs(sent - 1000)).toBeLessThanOrEqual(4);
    expect(v.parts.find((p) => p.key === 'tools')!.items.some(([l]) => l.startsWith('Agent'))).toBe(false);
  });

  it('marks an estimated count as about, and has nothing to show for an unknown size', () => {
    expect(contextView(use({ tokens: 5000, about: true }))!.about).toBe(true);
    expect(contextView(use({ size: undefined }))).toBeUndefined();
  });

  it('never counts down below zero', () => {
    expect(contextView(use({ tokens: 199_000 }))!.untilAuto).toBe(0);
    expect(contextView(use({ tokens: 199_000 }))!.pct).toBe(100);
  });
});

describe('overflows', () => {
  it('is true once the next turn would pass 90% of the context', () => {
    const at = (tokens: number) => use({ tokens });
    const edge = Math.round(AUTO_COMPACT * 200_000) - RESERVED;
    expect(overflows(at(edge - 100), 0)).toBe(false);
    expect(overflows(at(edge - 100), 800)).toBe(true);
    expect(overflows(use({ size: undefined, tokens: 10_000_000 }), 0)).toBe(false);
  });
});

describe('foldable', () => {
  it('is every live message before the last four', () => {
    const ms = ['y1', 't1', 'y2', 't2', 'y3', 't3'].map((id) => msg(id));
    expect(foldable(ms).map((m) => m.id)).toEqual(['y1', 't1']);
    expect(foldable(ms.slice(0, 4))).toEqual([]);
    const folded = [msg('y0', { compactedBy: 's' }), msg('s', { compact: { count: 1 } }), ...ms];
    expect(foldable(folded).map((m) => m.id)).toEqual(['s', 'y1', 't1']);
  });
});

describe('latestContext', () => {
  it('reads the newest record and says when it is a summary', () => {
    const a = use({ model: 'a' });
    const b = use({ model: 'b' });
    expect(latestContext([msg('t1', { context: a }), msg('y2')])).toEqual({ use: a, summary: false });
    expect(latestContext([msg('t1', { context: a }), msg('s', { context: b, compact: { count: 2 } }), msg('y2')])).toEqual({ use: b, summary: true });
    expect(latestContext([msg('y1')])).toBeUndefined();
  });
});

describe('knownSize / estimate', () => {
  it('knows Claude models and nothing else', () => {
    expect(knownSize('claude', 'opus')).toBe(200_000);
    expect(knownSize('claude')).toBe(200_000);
    expect(knownSize('claude', 'sonnet[1m]')).toBe(1_000_000);
    expect(knownSize('mock')).toBeUndefined();
    expect(estimate(9)).toBe(3);
  });
});
