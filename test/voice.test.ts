import { describe, expect, it } from 'vitest';
import { checkVoice, flatten, resolveMentions, template, VOICE_MAX, voicePrompt, writeStatus, type VoiceEvent } from '../src/teams/voice.js';

const members = ['Bolt', 'Lens', 'Probe', 'you'];
const facts = { files: 3, plus: 42, minus: 9, tests: { ok: true, passing: 24 } };
const EVENTS: VoiceEvent[] = [
  { kind: 'started' },
  { kind: 'started', rework: true },
  { kind: 'started', from: 'Bolt' },
  { kind: 'plan_wait' },
  { kind: 'plan_ok' },
  { kind: 'finished', facts },
  { kind: 'finished', facts: { files: 0, plus: 0, minus: 0 }, review: 'Lens' },
  { kind: 'finished', facts: { ...facts, tests: { ok: false, failing: 2 } } },
  { kind: 'ready', who: 'you' },
  { kind: 'queued', current: 'WEB-145' },
  { kind: 'queued' },
  { kind: 'failed', reason: 'npm test exited 1\nlots of output' },
  { kind: 'autofix', round: 1, of: 3 },
  { kind: 'gave_up', rounds: 3, why: 'the auth tests still fail.' },
  { kind: 'shipped', pr: 142 },
  { kind: 'merged', pr: 142 },
  { kind: 'ship_failed', reason: 'gh is not signed in' },
];

describe('voice rules', () => {
  it('every template keeps the rules, and failures say so', () => {
    for (const ev of EVENTS) {
      const t = template(ev);
      const failure = ev.kind === 'failed' || ev.kind === 'gave_up' || ev.kind === 'ship_failed';
      expect(checkVoice(t, members, { failure, ...(ev.kind === 'finished' && ev.review ? { mention: [ev.review] } : {}) }), `${ev.kind}: ${t}`).toBeUndefined();
    }
    expect(template({ kind: 'finished', facts, review: 'Lens' })).toBe('Done, 3 files changed, 24 tests pass. @Lens mind reviewing it?');
    expect(template({ kind: 'failed', reason: 'npm test exited 1\nmore' })).toBe("I couldn't finish this: npm test exited 1.");
    expect(template({ kind: 'ready', who: 'you' })).toBe('@you ready when you are.');
  });

  it('refuses reports, markdown, long text, a third sentence and strangers', () => {
    expect(checkVoice('Fixed it. 3 files, tests pass.', members)).toBeUndefined();
    expect(checkVoice('## Summary of changes', members)).toBe('a heading');
    expect(checkVoice('- callback.ts: kept ?next=', members)).toBe('a list');
    expect(checkVoice('1. callback.ts', members)).toBe('a list');
    expect(checkVoice('Here: ```ts\nx\n```', members)).toBeDefined();
    expect(checkVoice('I **fixed** it.', members)).toBe('markdown');
    expect(checkVoice('One.\nTwo.', members)).toBe('more than one line');
    expect(checkVoice('This is the first one. This is the second one. This is the third one.', members)).toBe('more than two sentences');
    expect(checkVoice('Fixed it. 3 files, tests pass. @Lens mind checking the redirect check?', members)).toBeUndefined();
    expect(checkVoice('x'.repeat(VOICE_MAX + 1), members)).toMatch(/longer/);
    expect(checkVoice('@Maya can you look?', members)).toBe('@Maya is not in this squad');
    expect(checkVoice('Done. Mind checking?', members, { mention: ['Lens'] })).toBe('does not ask @Lens');
    expect(checkVoice('It went fine.', members, { failure: true })).toBe('does not say it failed');
    // inline code and an email-like word are fine
    expect(checkVoice('Kept `?next=` and wrote to a@b.c.', members)).toBeUndefined();
  });

  it('resolves @mentions to the members as they spell themselves', () => {
    expect(resolveMentions('thanks @lens, @BOLT has it', members)).toEqual({ text: 'thanks @Lens, @Bolt has it', unknown: [] });
    expect(resolveMentions('ask @nobody', members).unknown).toEqual(['nobody']);
  });

  it('flattens an answer that reads like a report', () => {
    const report = '## Review\n\n- **callback.ts** looks right.\n- `//evil.com` still passes as same-site.\n\nMore notes here.\n\nVERDICT: FAIL';
    const t = flatten(report);
    expect(checkVoice(t, members)).toBeUndefined();
    expect(t).toBe('Review callback.ts looks right. `//evil.com` still passes as same-site.');
    expect(flatten(`${'word '.repeat(100)}.`).length).toBeLessThanOrEqual(VOICE_MAX);
  });
});

describe('the status writer', () => {
  const o = { name: 'Bolt', members, report: '## Summary\nI changed callback.ts, sameSite.ts and a test. All 24 pass.' };

  it('uses the model for a finished report when its reply keeps the rules, with mentions in the members spelling', async () => {
    const prompts: string[] = [];
    const call = async (p: string) => (prompts.push(p), '"Fixed it. 3 files, tests pass. @lens mind checking the redirect check?"');
    expect(await writeStatus({ kind: 'finished', facts, review: 'Lens' }, { ...o, call })).toBe('Fixed it. 3 files, tests pass. @Lens mind checking the redirect check?');
    expect(prompts[0]).toContain('<report>');
    expect(prompts[0]).toContain('Ask @Lens to review it.');
    expect(prompts[0]).toMatch(/no headings, lists, code blocks or markdown/);
  });

  it('falls back to the template when the reply breaks a rule, the model is missing or throws', async () => {
    const ev: VoiceEvent = { kind: 'finished', facts, review: 'Lens' };
    const want = template(ev);
    expect(await writeStatus(ev, { ...o, call: async () => '## Summary of changes\nI did things.' })).toBe(want);
    expect(await writeStatus(ev, { ...o, call: async () => 'Fixed it, all good.' })).toBe(want); // forgot to ask Lens
    expect(await writeStatus(ev, { ...o, call: async () => 'Fixed it. @Maya look?' })).toBe(want);
    expect(await writeStatus(ev, { ...o, call: async () => undefined })).toBe(want);
    expect(await writeStatus(ev, { ...o, call: async () => Promise.reject(new Error('offline')) })).toBe(want);
    expect(await writeStatus(ev, o)).toBe(want);
  });

  it('says a failure plainly: a cheerful reply is refused', async () => {
    const ev: VoiceEvent = { kind: 'failed', reason: 'tests failed: 2 failing' };
    expect(await writeStatus(ev, { ...o, call: async () => 'Making good progress here!' })).toBe("I couldn't finish this: tests failed: 2 failing.");
    expect(await writeStatus(ev, { ...o, call: async () => "I couldn't get the auth tests green: //evil.com still slips through." })).toBe("I couldn't get the auth tests green: //evil.com still slips through.");
  });

  it('never asks the model for events that only restate facts', async () => {
    let calls = 0;
    const call = async () => (calls++, 'Anything.');
    for (const ev of EVENTS.filter((e) => e.kind !== 'finished' && e.kind !== 'failed' && e.kind !== 'gave_up')) expect(await writeStatus(ev, { ...o, call })).toBe(template(ev));
    expect(calls).toBe(0);
    expect(voicePrompt({ kind: 'gave_up', rounds: 3, why: 'x' }, o)).toMatch(/say plainly that it failed/);
  });
});
