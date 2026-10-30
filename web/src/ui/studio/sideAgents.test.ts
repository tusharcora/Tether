import { describe, expect, it } from 'vitest';
import { sideAgents } from './Sidebar';

const a = (id: string, state?: string, since?: number) => ({ id, ...(state ? { state } : {}), ...(since ? { since } : {}) });

describe('sideAgents', () => {
  it('lists only squad members, busy first, capped at five', () => {
    const agents = [a('x1'), a('bolt'), a('lens', 'reviewing', 2), a('probe'), a('boss'), a('kite'), a('sage'), a('x2')];
    const out = sideAgents(agents, [{ agents: ['bolt', 'lens', 'probe'] }, { agents: ['boss', 'kite', 'sage'] }]).map((x) => x.id);
    expect(out).toEqual(['lens', 'bolt', 'probe', 'boss', 'kite']);
  });

  it('shows a busy agent even when it is in no squad, and every busy one past the cap', () => {
    const agents = Array.from({ length: 7 }, (_, i) => a(`b${i}`, 'coding', i + 1));
    expect(sideAgents([a('idle-lib'), ...agents], [])).toHaveLength(7);
    expect(sideAgents([a('idle-lib')], []).length).toBe(0);
  });
});
