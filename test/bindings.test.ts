import { describe, expect, it } from 'vitest';
import { applyBindings } from '../src/bindings.js';
import { registerCrew } from '../src/bots.js';
import { BUILTIN_BOTS } from '../src/crew.js';

const pipe = (nodes: object[]) => ({ name: 't', version: 1 as const, mode: 'pipeline' as const, nodes: nodes as never, edges: [], settings: { parallel: 4, nodeTimeoutMs: 60000, pipeMode: 'ancestors' as const } });

describe('model hints', () => {
  registerCrew([...BUILTIN_BOTS, { id: 'arch2', name: 'Arch', title: 'arch', kind: 'agent', persona: '', look: BUILTIN_BOTS[0]!.look, source: 'ecc@v2.2.3', modelHint: 'opus' }]);
  it('uses the hint on claude when nothing sets a model', () => {
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), {}).nodes[0]).toMatchObject({ model: 'opus' });
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', agent: 'claude', x: 0, y: 0 }]), {}).nodes[0]).toMatchObject({ model: 'opus' });
  });
  it('never overrides a step model, a bound model, or another agent', () => {
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', model: 'haiku', x: 0, y: 0 }]), {}).nodes[0]!.model).toBe('haiku');
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), { arch2: { agent: 'claude', model: 'sonnet' } }).nodes[0]!.model).toBe('sonnet');
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), { arch2: { agent: 'codex' } }).nodes[0]!.model).toBeUndefined();
  });
});
