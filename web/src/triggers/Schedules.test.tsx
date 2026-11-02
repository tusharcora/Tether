import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Schedules, when, type Schedule } from './Schedules';

const ws = [{ id: 'proj', name: 'Project', path: '/code/proj', isDefault: true, exists: true, repos: [] }];
const nightly: Schedule = { id: 's-00000001', name: 'Nightly tidy', cron: '0 2 * * *', workspace: 'proj', target: { kind: 'workflow', workflow: 'tidy', task: 'tidy up' }, enabled: true, nextAt: '2026-10-30T02:00:00.000Z', lastRunAt: new Date().toISOString(), lastRunId: 'r7' };

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Schedules', () => {
  it('lists each schedule with its next fire and target, switches it off and runs it now', async () => {
    routeApi({
      'GET /api/schedules': [nightly, { ...nightly, id: 's-00000002', name: 'Goal turn', target: { kind: 'goal', goalId: 'g1' }, workspace: undefined, enabled: false, nextAt: undefined, lastRunId: undefined, lastError: 'workspace "proj" is missing' }],
      'GET /api/tickets': [{ id: 'g1', title: 'Green tests', kind: 'loop', status: 'active' }],
      'PATCH /api/schedules/s-00000001': { ...nightly, enabled: false },
      'POST /api/schedules/s-00000001/run': nightly,
    });
    renderApp(<Schedules workspaces={ws} workflows={['tidy']} />);
    expect(await screen.findByText(`next ${when(nightly.nextAt!)}`)).toBeTruthy();
    expect(screen.getByText('runs tidy in proj')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'last run' }).getAttribute('href')).toBe('#/runs/r7');
    expect(await screen.findByText('ticket Green tests')).toBeTruthy();
    expect(screen.getByText('off')).toBeTruthy();
    expect(screen.getByText('workspace "proj" is missing')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Turn off Nightly tidy' }));
    await waitFor(() => expect(calls('PATCH', '/api/schedules/s-00000001')[0]![2]).toEqual({ enabled: false }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[0]!);
    await waitFor(() => expect(calls('POST', '/api/schedules/s-00000001/run')).toHaveLength(1));
  });

  it('creates a workflow schedule from a preset', async () => {
    let body: unknown;
    routeApi({ 'GET /api/schedules': [], 'GET /api/tickets': [], 'POST /api/schedules': (b: unknown) => ((body = b), nightly) });
    renderApp(<Schedules workspaces={ws} workflows={['tidy']} />);
    expect(await screen.findByText(/No schedules yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ New schedule' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weekday check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Weekdays 09:00' }));
    expect((screen.getByLabelText('Cron') as HTMLInputElement).value).toBe('0 9 * * 1-5');
    expect(screen.getByRole('button', { name: 'Weekdays 09:00' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Workflow'), { target: { value: 'tidy' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'check deps' } });
    fireEvent.click(save);
    await waitFor(() => expect(body).toEqual({ name: 'Weekday check', cron: '0 9 * * 1-5', workspace: 'proj', target: { kind: 'workflow', workflow: 'tidy', task: 'check deps' } }));
  });
});
