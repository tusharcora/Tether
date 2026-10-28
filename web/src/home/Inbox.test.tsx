import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type AttentionItem, type Question } from '../api';
import { calls, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Inbox } from './Inbox';

const item = (o: Partial<AttentionItem> = {}): AttentionItem => ({ id: 'a1', runId: 'r1', kind: 'approval', title: 'Approve the deploy step', meta: 'full-review · r1', ts: Date.now(), node: 'deploy', actions: ['approve', 'open'], ...o });
const q = (i: number): Question => ({ id: `q${i}`, ask: `Question ${i}?`, recommended: 'o2', options: [{ id: 'o1', label: `first option of q${i}` }, { id: 'o2', label: `second option of q${i}` }] });
const teamRun = (o = {}) => makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {}, ...o });
const questions = [item({ id: 'r1:q1', kind: 'question', title: 'Which store?', actions: ['answer'], node: undefined }), item({ id: 'r1:q2', kind: 'question', title: 'Which cache?', actions: ['answer'], node: undefined })];
const list = () => screen.getByRole('list', { name: 'Inbox' });

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Inbox', () => {
  it('shows the list and the open question with Previous and Next, sending answers together', async () => {
    routeApi({ 'GET /api/attention': { items: questions }, 'GET /api/runs/r1': teamRun({ pending: [q(1), q(2)] }), 'POST /api/runs/r1/answers': { ok: true } });
    renderApp(<Inbox onGo={vi.fn()} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
    expect(await within(list()).findByText('Question 1 of 2 · R-R1')).toBeTruthy();
    expect(within(list()).getByText('answer')).toBeTruthy();
    expect(await screen.findByText('NEEDS YOUR ANSWER')).toBeTruthy();
    expect(await screen.findByText('1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /first option of q1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('radio', { name: /first option of q2/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send answers' })));
    expect(calls('POST', '/api/runs/r1/answers')).toHaveLength(1);
    expect(calls('POST', '/api/runs/r1/answers')[0]![2]).toEqual({ answers: [{ question: 'q1', option: 'o1' }, { question: 'q2', option: 'o1' }] });
  });

  it('keeps Use recommendations', async () => {
    routeApi({ 'GET /api/attention': { items: questions }, 'GET /api/runs/r1': teamRun({ pending: [q(1), q(2)] }), 'POST /api/runs/r1/answers': { ok: true } });
    renderApp(<Inbox onGo={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: 'Use recommendations' });
    await act(async () => fireEvent.click(btn));
    expect(calls('POST', '/api/runs/r1/answers')[0]![2]).toEqual({ answers: [{ question: 'q1', option: 'o2' }, { question: 'q2', option: 'o2' }] });
  });

  it('reviews a ready plan in full, with Reject asking first', async () => {
    const plan = { goal: 'Ship rate limiting', success: [], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const }], limits: { allowWrites: true }, answers: [] };
    routeApi({ 'GET /api/attention': { items: [item({ id: 'p1', kind: 'plan_ready', title: 'Plan ready', actions: ['review'], node: undefined })] }, 'GET /api/runs/r1': teamRun({ status: 'running', planning: false, plan }) });
    renderApp(<Inbox onGo={vi.fn()} />);
    expect(await screen.findByText('Ship rate limiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve and start' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('button', { name: 'Yes, reject' })).toBeTruthy();
  });

  it('approves an approval item and opens the next one', async () => {
    let items = [item(), item({ id: 'f1', runId: 'r2', kind: 'failed', title: 'Deploy failed', actions: ['retry', 'open'], node: undefined })];
    routeApi({ 'GET /api/attention': () => ({ items }), 'POST /api/runs/r1/approve': () => ((items = items.slice(1)), { ok: true }) });
    renderApp(<Inbox onGo={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: 'Approve' });
    await act(async () => fireEvent.click(btn));
    expect(calls('POST', '/api/runs/r1/approve')[0]![2]).toEqual({ node: 'deploy', approved: true });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Deploy failed' })).toBeTruthy();
  });

  it('offers Resume for an interrupted run and Retry for a failed one', async () => {
    routeApi({
      'GET /api/attention': { items: [item({ id: 'i1', kind: 'interrupted', title: 'Interrupted', actions: ['resume', 'open'], node: undefined }), item({ id: 'f1', runId: 'r2', kind: 'failed', title: 'Failed', actions: ['retry', 'open'], node: undefined })] },
      'POST /api/runs/r1/resume': { ok: true },
      'POST /api/runs/r2/resume': { ok: true },
    });
    renderApp(<Inbox onGo={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: 'Resume' });
    await act(async () => fireEvent.click(btn));
    expect(calls('POST', '/api/runs/r1/resume')).toHaveLength(1);
    fireEvent.click(within(list()).getByText('Failed'));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await act(async () => fireEvent.click(retry));
    expect(calls('POST', '/api/runs/r2/resume')).toHaveLength(1);
  });

  it('keeps working when the open item vanishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let items = ['a', 'b', 'c'].map((id, i) => item({ id, runId: `r${i}`, kind: 'paused', title: `Paused ${id}`, actions: ['open'], node: undefined }));
    routeApi({ 'GET /api/attention': () => ({ items }) });
    const onGo = vi.fn();
    renderApp(<Inbox onGo={onGo} />);
    fireEvent.click(await within(await screen.findByRole('list', { name: 'Inbox' })).findByText('Paused b'));
    expect(screen.getByRole('heading', { name: 'Paused b' })).toBeTruthy();
    items = items.filter((x) => x.id !== 'b');
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Paused c' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r2' });
  });

  it('shows a failed run load with Retry', async () => {
    routeApi({ 'GET /api/attention': { items: questions }, 'GET /api/runs/r1': new Error('gone') });
    renderApp(<Inbox onGo={vi.fn()} />);
    expect(await screen.findByText('gone')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('says when nothing needs you', async () => {
    routeApi({ 'GET /api/attention': { items: [] } });
    renderApp(<Inbox onGo={vi.fn()} />);
    expect(await screen.findByText('Nothing needs you.')).toBeTruthy();
  });
});
