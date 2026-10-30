import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentPage } from './AgentPage';

vi.mock('./AgentProfile', () => ({ AgentProfile: (p: { bot: string }) => <div data-testid="profile">{p.bot}</div> }));

describe('AgentPage', () => {
  it('shows the agent, what it is doing now and its profile; Crew is one click away', () => {
    const onGo = vi.fn();
    render(<AgentPage id="coder" agents={[{ id: 'coder', name: 'Bolt', specialty: 'code', state: 'coding', line: 'editing Tabs.tsx' }]} onGo={onGo} />);
    expect(screen.getByRole('heading', { name: 'Bolt' })).toBeTruthy();
    expect(screen.getByText('coding · editing Tabs.tsx')).toBeTruthy();
    expect(screen.getByTestId('profile').textContent).toBe('coder');
    fireEvent.click(screen.getByRole('button', { name: 'Edit look and persona in Crew' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'crew', id: 'coder' });
  });

  it('a free agent reads "free"', () => {
    render(<AgentPage id="tester" agents={[{ id: 'tester', name: 'Probe', specialty: 'tests', state: 'idle' }]} onGo={() => {}} />);
    expect(screen.getByText('free')).toBeTruthy();
  });
});
