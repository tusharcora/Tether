import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { CommandMenu } from './CommandMenu';
import { makeRow, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

beforeEach(() => routeApi({ 'GET /api/runs': [makeRow({ id: 'r7', pipeline: 'full-review', task: 'Review PR 12' })], 'GET /api/pipelines': [{ name: 'full-review', nodes: 5 }] }));

it('jumps to tabs, runs and workflows', async () => {
  const go = vi.fn();
  const close = vi.fn();
  renderApp(<CommandMenu open onOpenChange={close} onGo={go} />);
  fireEvent.click(await screen.findByText('Go to Crew'));
  expect(go).toHaveBeenLastCalledWith({ tab: 'crew' });
  expect(close).toHaveBeenLastCalledWith(false);
  await waitFor(() => screen.getByText('Review PR 12'));
  fireEvent.click(screen.getByText('Review PR 12'));
  expect(go).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r7' });
  fireEvent.click(screen.getByText('Open in Builder'));
  expect(go).toHaveBeenLastCalledWith({ tab: 'builder', id: 'full-review' });
});

it('fetches nothing while closed', () => {
  renderApp(<CommandMenu open={false} onOpenChange={() => {}} onGo={() => {}} />);
  expect(screen.queryByText('Go to Crew')).toBeNull();
});
