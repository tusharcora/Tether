import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hhmm, parseAction, renderMessage, renderStatus } from '../src/teams/telegram/render.js';
import { editTg, loadTg, MAX_EDITABLE, newCode, remember, takeCode, tgTeam } from '../src/teams/telegram/store.js';
import type { TeamMessage, TeamView } from '../src/teams/types.js';
import { tmp } from './helpers.js';

const msg = (o: Partial<TeamMessage>): TeamMessage => ({ id: 'm1', at: 0, from: { kind: 'agent', id: 'coder', name: 'Bolt' }, text: 'On it.', ...o });

describe('rendering team messages for Telegram (board 5)', () => {
  it('labels the speaker, escapes the text, shows a pending answer as …', () => {
    expect(renderMessage(msg({ text: 'a <b> & c' }))).toEqual({ text: '<b>Bolt</b>: a &lt;b&gt; &amp; c' });
    expect(renderMessage(msg({ pending: true })).text).toBe('<b>Bolt</b>: …');
  });

  it('a run card shows its step track, status and cost', () => {
    const m = msg({ card: { kind: 'run', runId: 'r00005b07', title: 'Fix Back after a new chat', status: 'running', costUsd: 0.4, steps: [{ id: 'plan', status: 'done', title: 'Plan' }, { id: 'work', status: 'running', title: 'Code' }, { id: 'tests', status: 'queued', title: 'tests' }] } });
    expect(renderMessage(m).text).toBe('<b>Bolt</b>: On it.\n<b>R-5B07</b> · Fix Back after a new chat\nPlan ✓ · Code ▸ · tests\nrunning · $0.40');
  });

  it('a ship card has Ship it / Not yet / Diff until decided, then says who, when and how the ship went', () => {
    const at = new Date(2026, 9, 30, 14, 2).getTime();
    const ship = msg({ id: 'mS', card: { kind: 'approval', what: 'ship', title: 'Ship “probe timeout”?', detail: 'npm test passed · +4 −1 in 2 files', runId: 'r1', node: 'ship', status: 'pending' } });
    expect(renderMessage(ship).reply_markup).toEqual({ inline_keyboard: [[{ text: 'Ship it', callback_data: 'a|mS' }, { text: 'Not yet', callback_data: 'r|mS' }, { text: 'Diff', callback_data: 'f|mS' }]] });
    const done = { ...ship, card: { ...ship.card!, status: 'approved' as const, by: 'Maya', at } } as TeamMessage;
    expect(renderMessage(done)).toEqual({ text: '<b>Bolt</b>: On it.\n<b>Ship “probe timeout”?</b>\nnpm test passed · +4 −1 in 2 files\n✓ Approved by Maya · 14:02' });
    const mine = { ...ship, card: { ...ship.card!, status: 'rejected' as const, by: 'you', at } } as TeamMessage;
    expect(renderMessage(mine, 'Tushar').text).toMatch(/✕ Sent back by Tushar · 14:02$/);
    const merged = { ...done, card: { ...done.card!, review: { by: 'Lens', pass: true }, ship: { state: 'merged' as const, pr: { url: 'https://github.com/o/r/pull/7', number: 7 } } } } as TeamMessage;
    expect(renderMessage(merged).text).toBe('<b>Bolt</b>: On it.\n<b>Ship “probe timeout”?</b>\nnpm test passed · +4 −1 in 2 files\nLens approved\n✓ Approved by Maya · 14:02\n<a href="https://github.com/o/r/pull/7">PR #7</a> merged');
    expect(renderMessage({ ...ship, card: { ...ship.card!, status: 'superseded' as const } } as TeamMessage).text).toMatch(/Replaced by a newer run$/);
    const plan = msg({ card: { kind: 'approval', what: 'plan', title: 'Approve the plan?', runId: 'r1', node: 'approve-plan', status: 'pending' } });
    expect(renderMessage(plan).reply_markup!.inline_keyboard[0]!.map((b) => b.text)).toEqual(['Approve', 'Reject']);
    const next = msg({ card: { kind: 'approval', what: 'next', title: 'Start the next run?', goalId: 'g1', status: 'pending' } });
    expect(renderMessage(next).reply_markup!.inline_keyboard[0]!.map((b) => b.text)).toEqual(['Start run', 'Skip']);
  });

  it('an agent speaks in its squad voice: one line of What I did, never the raw report', () => {
    const m = msg({ text: 'Fixed it. 3 files, tests pass. @Lens mind checking the redirect check?', report: '## Summary of changes\n1. **callback.ts**: …', work: { files: ['auth/callback.ts', 'auth/sameSite.ts', 'callback.test.ts'], plus: 42, minus: 9, ran: [{ command: 'npm test -- auth', ok: true, summary: '24 passed' }] } });
    const t = renderMessage(m).text;
    expect(t).toBe('<b>Bolt</b>: Fixed it. 3 files, tests pass. @Lens mind checking the redirect check?\n<i>3 files · +42 −9 · npm test -- auth 24 passed</i>');
    expect(t).not.toMatch(/Summary of changes/);
  });

  it('a proposal has Start run / Edit / Dismiss, then who started it', () => {
    const p = msg({ id: 'mP', from: { kind: 'tether', id: 'tether', name: 'Tether' }, text: 'Maya asked: fix it', card: { kind: 'proposal', agent: 'coder', task: 'fix it', status: 'proposed' } });
    expect(renderMessage(p).reply_markup!.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual(['s|mP', 'e|mP', 'x|mP']);
    expect(renderMessage({ ...p, card: { kind: 'proposal', agent: 'coder', task: 'fix it', status: 'started', runId: 'r0000abcd', by: 'Jon' } }).text).toMatch(/Started R-ABCD by Jon$/);
  });

  it('parses only its own callback data', () => {
    expect(parseAction('a|m123abc')).toEqual({ action: 'approve', msg: 'm123abc' });
    expect(parseAction('z|m1')).toBeUndefined();
    expect(parseAction('a|../x')).toBeUndefined();
    expect(parseAction(42)).toBeUndefined();
  });

  it('the pinned status: the most pressing work, counts, spend, mute', () => {
    const v = { team: { limits: { usdPerDay: 10 } }, messages: [], spend: { usd: 1.4, runs: 2 }, working: [{ kind: 'loop', title: 'Keep main green', agent: 'tester', needs: false, line: '2 of ≤6 runs · $1.40' }] } as unknown as TeamView;
    expect(renderStatus(v)).toBe('<b>Live</b> · Keep main green · 2 of ≤6 runs · $1.40\n1 live · 0 need you · $1.40 of $10.00 today');
    const mute = new Date(2026, 9, 30, 15, 4).getTime();
    expect(renderStatus({ ...v, working: [] }, { mute, now: mute - 1 })).toBe(`<b>Nothing running</b>\n0 live · 0 need you · $1.40 of $10.00 today · muted until ${hhmm(mute)}`);
  });
});

describe('Telegram state', () => {
  it('codes are one-time and expire; edited message ids are capped, at 0600', () => {
    const home = tmp();
    const { code } = editTg(home, (s) => newCode(s, 'ops-1a2b', 1000));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(editTg(home, (s) => takeCode(s, code.toLowerCase(), 2000))).toBe('ops-1a2b');
    expect(editTg(home, (s) => takeCode(s, code, 2000))).toBeUndefined();
    const late = editTg(home, (s) => newCode(s, 'iam', 0)).code;
    expect(editTg(home, (s) => takeCode(s, late, 11 * 60_000))).toBeUndefined();
    editTg(home, (s) => {
      for (let i = 0; i < MAX_EDITABLE + 3; i++) remember(tgTeam(s, 'ops'), `m${i}`, i);
    });
    const t = loadTg(home).teams.ops!;
    expect(Object.keys(t.msgs)).toHaveLength(MAX_EDITABLE);
    expect(t.msgs.m3).toBe(3);
    expect(t.msgs.m2).toBeUndefined();
    expect(statSync(join(home, 'squads', 'telegram.json')).mode & 0o777).toBe(0o600);
  });
});
