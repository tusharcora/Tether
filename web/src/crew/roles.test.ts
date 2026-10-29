import { describe, expect, it } from 'vitest';
import type { BotDef } from '../crewStore';
import { canPlay, playAs } from './roles';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const slot = { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'p', look, builtin: true } as BotDef;

describe('roles', () => {
  it('matches kinds and keeps Gate and built-ins out', () => {
    expect(canPlay({ ...slot, id: 'quill', builtin: false }, slot)).toBe(true);
    expect(canPlay({ ...slot, id: 'go', kind: 'verdict', builtin: false }, slot)).toBe(false);
    expect(canPlay({ ...slot, id: 'scout', builtin: true }, slot)).toBe(false);
    expect(canPlay({ ...slot, id: 'p', kind: 'approval', builtin: false }, { ...slot, id: 'approval', kind: 'approval' })).toBe(false);
    expect(canPlay({ ...slot, id: 'mine', builtin: false }, { ...slot, builtin: false })).toBe(false);
  });

  it('takes name, persona and look from the bench bot, and keeps the role', () => {
    const quill = { id: 'quill', name: 'Quill', title: 'poet', kind: 'agent', persona: 'Writes poems', look: { ...look, color: '#ff8a5b' }, whenToUse: 'poems', source: undefined } as BotDef;
    expect(playAs({ ...slot, readOnly: true }, quill)).toEqual({ id: 'coder', name: 'Quill', title: 'coder', kind: 'agent', persona: 'Writes poems', look: quill.look, readOnly: true });
    expect(playAs(slot, quill)).toEqual({ id: 'coder', name: 'Quill', title: 'coder', kind: 'agent', persona: 'Writes poems', look: quill.look });
  });
});
