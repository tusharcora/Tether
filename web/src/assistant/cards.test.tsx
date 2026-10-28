import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { makeRow, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { LiveRunSteps } from './cards';

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('the started run card follows its run live', () => {
  it('lists the run steps as a to-do list with their statuses', async () => {
    routeApi({
      'GET /api/crew': { bots: [] },
      'GET /api/runs': [makeRow({ id: 'r9', kind: 'team', steps: [{ id: 'plan', status: 'done', bot: 'architect' }, { id: 'code', status: 'running', bot: 'coder' }] })],
    });
    renderApp(<LiveRunSteps runId="r9" />);
    expect(await screen.findByText('Run progress')).toBeTruthy();
    expect(screen.getByText(/· plan/)).toBeTruthy();
    expect(screen.getByText(/· code/)).toBeTruthy();
  });

  it('says Tether is planning while a live team run has no steps yet', async () => {
    routeApi({ 'GET /api/crew': { bots: [] }, 'GET /api/runs': [makeRow({ id: 'r9', kind: 'team', steps: [] })] });
    renderApp(<LiveRunSteps runId="r9" />);
    await waitFor(() => expect(screen.getByText('Tether is planning…')).toBeTruthy());
  });

  it('draws nothing for a run it cannot find', async () => {
    routeApi({ 'GET /api/crew': { bots: [] }, 'GET /api/runs': [] });
    const { container } = renderApp(<LiveRunSteps runId="gone" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });
});
