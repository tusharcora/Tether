import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { NewTeam } from './NewTeam';

const agents = [
  { id: 'planner', name: 'Scout', specialty: 'plans' },
  { id: 'coder', name: 'Bolt', specialty: 'code' },
  { id: 'reviewer', name: 'Lens', specialty: 'review' },
];
const projects = [{ id: 'app', name: 'agent-orchestrator', path: '/p', isDefault: true, exists: true, repos: [] }];

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('New team (board 2)', () => {
  it('creates a Tether team with the picked agents and rules; Slack and Telegram wait for a later phase', async () => {
    routeApi({ 'POST /api/teams': (b: Record<string, unknown>) => ({ id: 'core-1a2b', ...b }) });
    const onCreated = vi.fn();
    const onNewAgent = vi.fn();
    renderApp(<NewTeam agents={agents} projects={projects} project={projects[0]} onCreated={onCreated} onCancel={vi.fn()} onNewAgent={onNewAgent} />);
    const create = screen.getByRole('button', { name: 'Create team' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByRole('radio', { name: 'Slack' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Telegram' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Tether' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tether core' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Bolt/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Lens/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tight' }));
    expect(screen.getByText('A person approves the plan and the result.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Chosen people: you' }));
    fireEvent.change(screen.getByLabelText('Runs per day'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '+ New agent…' }));
    expect(onNewAgent).toHaveBeenCalled();
    fireEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('core-1a2b'));
    expect(calls('POST', '/api/teams')[0]![2]).toEqual({ name: 'Tether core', place: 'tether', project: 'app', agents: ['coder', 'reviewer'], approvers: ['owner'], level: 'tight', limits: { usdPerDay: 10, runsPerDay: 5 }, learn: true });
  });
});
