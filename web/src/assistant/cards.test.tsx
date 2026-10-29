import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { LivePlan } from '../runs/PlanCard';
import { makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('the started run card follows its run live', () => {
  it('shows the run as a live plan card', async () => {
    routeApi({ 'GET /api/runs/r9': makeRun({ id: 'r9', costUsd: 0.4 }) });
    renderApp(<LivePlan runId="r9" />);
    const card = await screen.findByRole('region', { name: 'Plan' });
    expect(card.textContent).toContain('Add rate limiting');
    expect(card.textContent).toContain('$0.40');
    expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'working' })).toBeTruthy();
  });

  it('says Tether is planning while a live team run has no steps yet', async () => {
    const r = makeRun({ id: 'r9', kind: 'team', planning: true });
    routeApi({ 'GET /api/runs/r9': { ...r, pipeline: { ...r.pipeline, nodes: [], edges: [] }, nodes: {} } });
    renderApp(<LivePlan runId="r9" />);
    await waitFor(() => expect(screen.getByText('Tether is planning…')).toBeTruthy());
  });

  it('draws nothing for a run it cannot find', async () => {
    routeApi({ 'GET /api/runs/gone': new Error('unknown run gone') });
    const { container } = renderApp(<LivePlan runId="gone" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });
});
