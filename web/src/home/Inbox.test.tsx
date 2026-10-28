import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Inbox } from './Inbox';

const item = (o: Record<string, unknown> = {}) => ({ id: 'a1', runId: 'r1', kind: 'approval', title: 'Approve the deploy step', meta: 'full-review · r1', ts: Date.now(), node: 'deploy', actions: ['approve', 'open'], ...o });

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Inbox', () => {
  it('lists what needs you with the inline actions of Home’s Needs you', async () => {
    let approved: unknown;
    routeApi({ 'GET /api/attention': { items: [item(), item({ id: 'q1', kind: 'question', title: 'Which region?', actions: ['answer'], node: 'plan' })] }, 'POST /api/runs/r1/approve': (b: unknown) => ((approved = b), { ok: true }) });
    const onGo = vi.fn();
    renderApp(<Inbox onGo={onGo} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
    expect(await screen.findByText('Approve the deploy step')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approved).toEqual({ node: 'deploy', approved: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1', node: 'plan' });
  });

  it('says when nothing needs you', async () => {
    routeApi({ 'GET /api/attention': { items: [] } });
    renderApp(<Inbox onGo={vi.fn()} />);
    expect(await screen.findByText('Nothing needs you.')).toBeTruthy();
  });
});
