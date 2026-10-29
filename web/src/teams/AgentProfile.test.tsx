import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { AgentProfile } from './AgentProfile';
import type { AgentView } from './teamsApi';

const view = (o: Partial<AgentView> = {}): AgentView => ({
  bot: 'coder',
  profile: { specialty: 'code', personality: 'Direct and brief.' },
  lessons: [
    { id: 'coder-aaaa1111', text: 'Rerun failing test files alone before calling a test broken.', team: 'core', teamName: 'Tether core', at: new Date(2026, 9, 29, 12).toISOString() },
    { id: 'coder-bbbb2222', text: 'Commits are plain conventional messages.', at: new Date(2026, 9, 28, 12).toISOString() },
  ],
  teams: [{ id: 'core', name: 'Tether core', place: 'tether', state: 'coding' }],
  recent: [{ runId: 'rmh15a21', title: 'probe timeout', status: 'running', costUsd: 0, team: 'Tether core' }],
  ...o,
});

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('the agent profile on the Crew card (board 3)', () => {
  it('shows memory with team and date, forgets one lesson and all, and saves the specialty', async () => {
    routeApi({
      'GET /api/agents/coder': view(),
      'DELETE /api/agents/coder/lessons/coder-aaaa1111': view({ lessons: [view().lessons[1]!] }),
      'DELETE /api/agents/coder/lessons': view({ lessons: [] }),
      'PUT /api/agents/coder': (b: { specialty: string }) => view({ profile: { ...view().profile, specialty: b.specialty } }),
    });
    renderApp(<AgentProfile bot="coder" name="Bolt" title="coder" />);
    const memory = await screen.findByRole('group', { name: 'Memory · lessons Bolt carries into every team' });
    expect(within(memory).getByText('Commits are plain conventional messages.')).toBeTruthy();
    expect(screen.getByText('Answers when @mentioned, or handed a task or loop. Never acts unprompted.')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Teams' })).getByText('coding')).toBeTruthy();
    expect(screen.getByText('R-5A21 · probe timeout')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Forget "Rerun failing test files alone before calling a test broken."' }));
    await waitFor(() => expect(screen.queryByText('Rerun failing test files alone before calling a test broken.')).toBeNull());
    expect(calls('DELETE', '/api/agents/coder/lessons/coder-aaaa1111')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Forget all' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Forget all' }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/No lessons yet/)).toBeTruthy());

    const save = screen.getByRole('button', { name: 'Save teammate' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: 'tests' } });
    fireEvent.click(save);
    await waitFor(() => expect(calls('PUT', '/api/agents/coder')[0]?.[2]).toEqual({ specialty: 'tests', personality: 'Direct and brief.' }));
  });
});
