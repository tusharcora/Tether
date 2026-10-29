import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBindings, bindFree, hintFor, link, loadBindings } from '../src/bindings.js';
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
  it('a claude binding with no model gets the hint; a step on codex with no binding gets none', () => {
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', x: 0, y: 0 }]), { arch2: { agent: 'claude' } }).nodes[0]).toMatchObject({ agent: 'claude', model: 'opus' });
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', agent: 'codex', x: 0, y: 0 }]), {}).nodes[0]!.model).toBeUndefined();
  });
  it('leaves a spawned step with no agent yet to the engine, which knows the agent it falls back to', () => {
    const spawn = { parent: 'm', depth: 1, contract: { to: 'arch2', goal: 'g', context: [], mode: 'read', after: [] } };
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', spawn, x: 0, y: 0 }]), {}).nodes[0]!.model).toBeUndefined();
    expect(applyBindings(pipe([{ id: 'a', kind: 'agent', role: 'arch2', spawn, x: 0, y: 0 }]), { arch2: { agent: 'claude' } }).nodes[0]!.model).toBe('opus');
    expect(hintFor('arch2', undefined)).toBe('opus');
    expect(hintFor('arch2', 'claude')).toBe('opus');
    expect(hintFor('arch2', 'codex')).toBeUndefined();
    expect(hintFor('coder', 'claude')).toBeUndefined();
  });
});

describe('free defaults', () => {
  it('binds the built-in model bots that have no binding, never one bound on purpose, the tester or the approver', () => {
    const home = mkdtempSync(join(tmpdir(), 'aorch-b-'));
    link(home, 'reviewer', { agent: 'claude' });
    expect(bindFree(home, 'nvidia/nemotron-3.5-super-vl:free').sort()).toEqual(['architect', 'coder', 'manager', 'orchestrator', 'planner']);
    const b = loadBindings(home);
    expect(b.coder).toEqual({ agent: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' });
    expect(b.reviewer).toEqual({ agent: 'claude' });
    expect(b.tester).toBeUndefined();
    expect(b.approval).toBeUndefined();
    expect(bindFree(home, 'other:free')).toEqual([]);
  });
});
