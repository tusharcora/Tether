import { describe, expect, it } from 'vitest';
import type { PipelineNode } from '../../../src/types';
import { flowLine, loopLabel, loopSentence, stepPreview, stepTitle } from './stepText';

const agent = { id: 'code', kind: 'agent', role: 'coder', x: 0, y: 0 } as PipelineNode;
const gate = { id: 'gate', kind: 'gate', command: 'npm test', fixNode: 'code', maxLoops: 3, x: 0, y: 0 } as PipelineNode;

describe('stepText', () => {
  it('names a step by its title, else its role, else its kind', () => {
    expect(stepTitle({ ...agent, title: 'Code' })).toBe('Code');
    expect(stepTitle(agent)).toBe('coder');
    expect(stepTitle(gate)).toBe('gate');
  });

  it('previews what a step does', () => {
    expect(stepPreview({ ...agent, prompt: '  Make it small. ' })).toBe('Make it small.');
    expect(stepPreview(agent)).toBe('Default instructions for the coder.');
    expect(stepPreview(gate)).toBe('$ npm test');
    expect(stepPreview({ ...gate, command: undefined, http: { run: '' } })).toBe('request not picked yet');
    expect(stepPreview({ ...gate, command: undefined, http: { run: 'runs/list' } })).toBe('request runs/list');
    expect(stepPreview({ id: 'ok', kind: 'approval', x: 0, y: 0 } as PipelineNode)).toBe('Pauses until a person signs off.');
  });

  it('words a fix loop for the canvas and the outline, and drops it when its step is gone', () => {
    expect(loopLabel(gate, [agent, gate])).toBe('if it fails · back to coder ×3');
    expect(loopSentence(gate, [agent, gate])).toBe('If it fails, the output goes back to coder, up to 3 times.');
    expect(loopSentence({ ...gate, maxLoops: 1 }, [agent, gate])).toBe('If it fails, the output goes back to coder, up to 1 time.');
    expect(loopLabel({ ...gate, maxLoops: undefined }, [agent, gate])).toBe('if it fails · back to coder ×2');
    expect(loopSentence(gate, [gate])).toBeUndefined();
    expect(loopLabel(agent, [agent])).toBeUndefined();
  });

  it('lines up the steps under the outline title (§15.3)', () => {
    expect(flowLine({ nodes: [], edges: [] }, () => '')).toBe('No steps yet');
    expect(flowLine({ nodes: [agent], edges: [] }, () => 'Bolt')).toBe('1 step · Bolt');
    expect(flowLine({ nodes: [gate, agent], edges: [{ from: 'code', to: 'gate' }] }, (n) => (n.id === 'code' ? 'Bolt' : 'Probe'))).toBe('2 steps · Bolt → Probe');
  });
});
