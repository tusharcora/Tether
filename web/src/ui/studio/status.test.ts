import { describe, expect, it } from 'vitest';
import { makeRow, makeRun } from '../../test/fixtures';
import { badgeFor, glyphFor, rowDesc, viewDesc, type RunDesc, type StepDesc } from './status';

const step = (o: Partial<StepDesc>): StepDesc => ({ of: 'step', status: 'running', kind: 'agent', attempts: 1, ...o });
const run = (o: Partial<RunDesc>): RunDesc => ({ of: 'run', status: 'running', live: true, waiting: false, ...o });

describe('badgeFor', () => {
  it('names a running step by what it does (§14.3)', () => {
    expect(badgeFor(step({}))).toEqual({ state: 'loading', label: 'writing' });
    expect(badgeFor(step({ readOnly: true })).label).toBe('reading');
    expect(badgeFor(step({ kind: 'gate' })).label).toBe('testing');
    expect(badgeFor(step({ kind: 'gate', attempts: 2 })).label).toBe('retrying');
  });
  it('maps finished steps, gates and verdicts', () => {
    expect(badgeFor(step({ status: 'done', kind: 'gate', gateOk: true }))).toEqual({ state: 'success', label: 'passed' });
    expect(badgeFor(step({ status: 'done', verdict: 'PASS' })).label).toBe('passed');
    expect(badgeFor(step({ status: 'done', verdict: 'FAIL' }))).toEqual({ state: 'danger', label: 'failed' });
    expect(badgeFor(step({ status: 'done' }))).toEqual({ state: 'success', label: 'done' });
    expect(badgeFor(step({ status: 'error' }))).toEqual({ state: 'danger', label: 'failed' });
    expect(badgeFor(step({ status: 'awaiting' }))).toEqual({ state: 'warning', label: 'needs you' });
    expect(badgeFor(step({ status: 'skipped' }))).toEqual({ state: 'neutral', label: 'skipped' });
  });
  it('maps run states, with waiting and interrupted first', () => {
    expect(badgeFor(run({}))).toEqual({ state: 'loading', label: 'running' });
    expect(badgeFor(run({ planning: true })).label).toBe('planning');
    expect(badgeFor(run({ live: false }))).toEqual({ state: 'warning', label: 'interrupted' });
    expect(badgeFor(run({ status: 'paused', waiting: true }))).toEqual({ state: 'warning', label: 'needs you' });
    expect(badgeFor(run({ status: 'paused' }))).toEqual({ state: 'neutral', label: 'paused' });
    expect(badgeFor(run({ status: 'error', live: false }))).toEqual({ state: 'danger', label: 'failed' });
    expect(badgeFor(run({ status: 'stopped', live: false })).label).toBe('stopped');
    expect(JSON.stringify(['done', 'error', 'stopped'].map((s) => badgeFor(run({ status: s as RunDesc['status'] })).label))).not.toContain('merged');
  });
  it('derives waiting from a row and from a view', () => {
    expect(rowDesc(makeRow({ pending: 1 })).waiting).toBe(true);
    expect(rowDesc(makeRow({ planReady: true })).waiting).toBe(true);
    expect(rowDesc(makeRow({ steps: [{ id: 's', status: 'awaiting', bot: 'b' }] })).waiting).toBe(true);
    expect(viewDesc(makeRun()).waiting).toBe(false);
  });
  it('never draws a glyph that contradicts the badge', () => {
    expect(glyphFor('danger')).toBe('failed');
    expect(glyphFor('success')).toBe('done');
    expect(glyphFor('loading')).toBe('running');
    expect(glyphFor('warning')).toBe('needs');
    expect(glyphFor('neutral')).toBe('idle');
  });
});
