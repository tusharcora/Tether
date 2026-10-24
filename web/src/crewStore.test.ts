import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { applyCrew, crewFor, getCrew, loadCrewDefs, subscribeCrew, type BotDef } from './crewStore';

const bot = (id: string, name: string): BotDef => ({ id, name, title: id, kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#123456', accent: 'auto' } });

describe('crewFor', () => {
  it('maps nodes to bots like the terminal does', () => {
    const crew = getCrew().crew;
    expect(crewFor({ kind: 'agent', role: 'reviewer' }, crew)).toBe('reviewer');
    expect(crewFor({ kind: 'agent', role: 'orchestrator' }, crew)).toBe('orchestrator');
    expect(crewFor({ kind: 'gate' }, crew)).toBe('tester');
    expect(crewFor({ kind: 'approval' }, crew)).toBe('approval');
    expect(crewFor({ kind: 'agent', role: 'qa-bot' }, crew)).toBe('tester');
    expect(crewFor({ kind: 'agent', role: 'security audit' }, crew)).toBe('reviewer');
    expect(crewFor({ kind: 'agent', role: 'designer' }, crew)).toBe('architect');
    expect(crewFor({ kind: 'agent', role: 'spec writer' }, crew)).toBe('planner');
    // 'research' contains 'arch', and the terminal tests /arch|design/ first.
    expect(crewFor({ kind: 'agent', role: 'research' }, crew)).toBe('architect');
    expect(crewFor({ kind: 'agent', role: 'whatever' }, crew)).toBe('coder');
  });
});

describe('crew store', () => {
  // Braces matter: a function returned from beforeEach runs as teardown, which would call the mock.
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });
  it('notifies subscribers on apply', () => {
    const f = vi.fn();
    const off = subscribeCrew(f);
    applyCrew([bot('coder', 'Bolt'), bot('scribe', 'Quill')], { style: 'sigil' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(getCrew().crew.scribe?.name).toBe('Quill');
    expect(getCrew().style).toBe('sigil');
    off();
  });
  it('keeps the current crew when loading fails', async () => {
    applyCrew([bot('coder', 'Bolt')]);
    vi.mocked(api).mockRejectedValue(new Error('down'));
    await loadCrewDefs(true);
    expect(getCrew().crew.coder?.name).toBe('Bolt');
  });
});
