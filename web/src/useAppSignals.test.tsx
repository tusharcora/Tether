import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem, RunRow } from './api';
import { fakeBridge, makeRow } from './test/fixtures';
import { useAppSignals, useNotifyPref } from './useAppSignals';

const need = (id: string, runId = 'r1'): AttentionItem => ({ id, ts: 0, runId, kind: 'question', title: 'Which database?\nmore', meta: '', actions: [] }) as AttentionItem;

beforeEach(() => localStorage.clear());

describe('Tether.app badge and notifications', () => {
  it('badges the Dock with what needs you', () => {
    const { b } = fakeBridge();
    const { rerender } = renderHook((p: { a: AttentionItem[] }) => useAppSignals([], p.a, true), { initialProps: { a: [need('q1'), need('q2')] } });
    expect(b.setBadge).toHaveBeenLastCalledWith(2);
    rerender({ a: [] });
    expect(b.setBadge).toHaveBeenLastCalledWith(0);
  });

  it('notifies of new needs-you items and runs that finished, but not on the first poll', () => {
    const { b } = fakeBridge();
    const running = makeRow({ id: 'r1', status: 'running', task: 'Add rate limiting\nmore' });
    const { rerender } = renderHook((p: { runs: RunRow[]; a: AttentionItem[] }) => useAppSignals(p.runs, p.a, true), { initialProps: { runs: [running], a: [need('q1')] } });
    expect(b.notify).not.toHaveBeenCalled();
    rerender({ runs: [running], a: [need('q1'), need('q2', 'r7')] });
    expect(b.notify).toHaveBeenCalledTimes(1);
    expect(b.notify).toHaveBeenLastCalledWith({ title: 'Needs you', body: 'Which database?', route: '#/runs/r7' });
    rerender({ runs: [{ ...running, status: 'done' }], a: [need('q1'), need('q2', 'r7')] });
    expect(b.notify).toHaveBeenLastCalledWith({ title: 'Run finished', body: 'Add rate limiting', route: '#/runs/r1' });
    rerender({ runs: [{ ...running, status: 'done' }], a: [] });
    expect(b.notify).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when switched off, and remembers the switch', () => {
    const { b } = fakeBridge();
    const { result } = renderHook(() => useNotifyPref());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(localStorage.getItem('aorch.notify')).toBe('off');
    expect(renderHook(() => useNotifyPref()).result.current[0]).toBe(false);
    const { rerender } = renderHook((p: { a: AttentionItem[] }) => useAppSignals([], p.a, false), { initialProps: { a: [] as AttentionItem[] } });
    rerender({ a: [need('q9')] });
    expect(b.notify).not.toHaveBeenCalled();
  });
});
