import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Question } from './api';
import { TeamPanel } from './Team';
import { makeRun } from './test/fixtures';
import { renderApp } from './test/render';

const q = (id: string, from?: string): Question => ({
  id, ask: `Question ${id}?`, recommended: 'a', allowOther: true, ...(from ? { from } : {}),
  options: [{ id: 'a', label: `Option A of ${id}`, detail: 'the safe one' }, { id: 'b', label: `Option B of ${id}` }],
});
const teamRun = (o = {}) => makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {}, ...o });

describe('TeamPanel', () => {
  it('sends planning answers in one batch once every card has a pick', async () => {
    const send = vi.fn().mockResolvedValue(true);
    renderApp(<TeamPanel run={teamRun({ pending: [q('q1'), q('q2')] })} send={send} />);
    const sendBtn = screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Option B of q1/ }));
    fireEvent.change(screen.getAllByLabelText('Or in your own words')[1]!, { target: { value: 'my own' } });
    expect(sendBtn.disabled).toBe(false);
    await act(async () => fireEvent.click(sendBtn));
    expect(send).toHaveBeenCalledWith('answers', { answers: [{ question: 'q1', option: 'b' }, { question: 'q2', text: 'my own' }] });
  });

  it('answers worker questions one at a time and stops at the first failure', async () => {
    const send = vi.fn().mockResolvedValueOnce(false);
    const run = teamRun({ planning: false, pending: [q('w1', 'code'), q('w2', 'code')], userAsks: [{ node: 'code', question: q('w1', 'code'), wait: true }, { node: 'code', question: q('w2', 'code'), wait: true }] });
    renderApp(<TeamPanel run={run} send={send} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use recommendations' })));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('answers', { answers: [{ question: 'w1', option: 'a' }] });
  });

  it('shows the plan and asks before rejecting it', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const plan = { goal: 'Ship rate limiting', success: ['429 with Retry-After'], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const }], limits: { allowWrites: true, maxCostUsd: 5 }, answers: [] };
    renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
    expect(screen.getByText('Ship rate limiting')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve and start' })));
    expect(send).toHaveBeenLastCalledWith('plan', { approved: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, reject' })));
    expect(send).toHaveBeenLastCalledWith('plan', { approved: false });
  });

  it('hides Approve while the reject question is open and offers Keep plan', () => {
    const send = vi.fn().mockResolvedValue(true);
    const plan = { goal: 'Ship rate limiting', success: [], assignments: [], limits: { allowWrites: false }, answers: [] };
    renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.queryByRole('button', { name: 'Approve and start' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep plan' }));
    expect(screen.getByRole('button', { name: 'Approve and start' })).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('switches mode', () => {
    const send = vi.fn().mockResolvedValue(true);
    renderApp(<TeamPanel run={teamRun({ planning: false })} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Autonomous' }));
    expect(send).toHaveBeenCalledWith('mode', { mode: 'autonomous' });
  });

  it('forgets picks when the run changes', () => {
    const send = vi.fn().mockResolvedValue(true);
    const { rerender } = renderApp(<TeamPanel run={teamRun({ pending: [q('q1')] })} send={send} />);
    fireEvent.click(screen.getByRole('radio', { name: /Option B of q1/ }));
    expect((screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement).disabled).toBe(false);
    rerender(<TeamPanel run={teamRun({ id: 'r2', pending: [q('q1')] })} send={send} />);
    expect((screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
