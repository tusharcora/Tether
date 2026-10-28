import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Question } from './api';
import { TeamPanel } from './Team';
import { makeRun } from './test/fixtures';
import { cssText } from './test/css';
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

  it('shows a Code Mode outside-world ask as a tool approval: allow once or deny, and change the answer', async () => {
    const ask: Question = { id: 'cm1', ask: 'Allow Bolt to post a comment on PR #12?', recommended: 'deny', options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }], from: 'code' };
    const send = vi.fn().mockResolvedValue(true);
    const run = teamRun({ planning: false, pending: [ask], userAsks: [{ node: 'code', question: ask, wait: true }] });
    renderApp(<TeamPanel run={run} send={send} />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Approval required')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(screen.getByText('Approved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change my answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(screen.getByText('Denied')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send answers' })));
    expect(send).toHaveBeenCalledWith('answers', { answers: [{ question: 'cm1', option: 'deny' }] });
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

  it('shows each assignment’s why and swaps a bot from the roster', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const plan = { goal: 'Ship', success: [], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const, why: 'repo is Go' }, { bot: 'reviewer', goal: 'review', mode: 'read' as const, swapped: true as const }], limits: { allowWrites: true }, answers: [], roster: ['coder', 'reviewer', 'go-reviewer'] };
    renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
    expect(screen.getByText(/repo is Go/)).toBeTruthy();
    expect(screen.getByText('swapped by you')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('combobox', { name: /Bot/ })[0]!);
    fireEvent.click(await screen.findByRole('option', { name: 'go-reviewer' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('swap', { assignment: 0, bot: 'go-reviewer' }));
  });

  it('shows the run state, write access and the plan with Studio chips', () => {
    const send = vi.fn().mockResolvedValue(true);
    const plan = { goal: 'Ship', success: ['429 with Retry-After'], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const, expected: 'a passing gate' }], limits: { allowWrites: true }, answers: [] };
    const { container } = renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
    expect(container.querySelector('.tm-bar .sl-chip')!.classList.contains('t-live')).toBe(true);
    const region = screen.getByRole('region', { name: "The team's plan" });
    expect(region.querySelector('.sl-chip.t-needs')!.textContent).toBe('waits for you');
    expect(screen.getByText('can edit files').closest('.sl-chip')).toBeTruthy();
    expect(screen.getByText('expects: a passing gate')).toBeTruthy();
    expect(region.querySelectorAll('li.sl-row')).toHaveLength(1);
  });

  it('tags the recommended option and numbers the cards', () => {
    renderApp(<TeamPanel run={teamRun({ pending: [q('q1'), q('q2')] })} send={vi.fn().mockResolvedValue(true)} />);
    expect(screen.getAllByText('recommended')).toHaveLength(2);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Question q1?' })).toBeTruthy();
  });

  it('is styled from tokens in its own stylesheet', () => {
    expect(cssText('runs/team.css').match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(cssText('styles.css')).not.toMatch(/\.qpanel|\.qcard|\.team-bar|\.assign/);
  });
});
