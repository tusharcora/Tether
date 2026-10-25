import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunsOn } from './RunsOn';

const agents = { claude: { ok: true, models: ['opus'] }, codex: { ok: false, models: [] } };
const row = (o = {}) => ({ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null, ...o });
const h = () => ({ onChange: vi.fn(), onSave: vi.fn(), onUnlink: vi.fn() });

describe('RunsOn', () => {
  it('saves only a changed link and suggests the agent’s models', () => {
    const fns = h();
    const { rerender, container } = render(<RunsOn row={row()} agents={agents} draft={{ agent: 'claude', model: '' }} dirty={false} {...fns} />);
    expect(screen.getByRole('region', { name: 'Runs on' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect([...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['opus']);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    expect(fns.onChange).toHaveBeenCalledWith({ model: 'opus' });
    rerender(<RunsOn row={row()} agents={agents} draft={{ agent: 'claude', model: 'opus' }} dirty {...fns} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(fns.onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });

  it('unlinks a linked bot and marks an agent that is not installed', () => {
    const fns = h();
    render(<RunsOn row={row({ binding: { agent: 'codex' } })} agents={agents} draft={{ agent: 'codex', model: '' }} dirty={false} {...fns} />);
    expect(screen.getByText('agent not available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(fns.onUnlink).toHaveBeenCalledTimes(1);
  });

  it('has nothing to link for an approval bot', () => {
    render(<RunsOn row={row({ kind: 'approval' })} agents={agents} draft={{ agent: '', model: '' }} dirty={false} {...h()} />);
    expect(screen.getByText('A person signs off here. Nothing to link.')).toBeTruthy();
    expect(screen.queryByLabelText('Model')).toBeNull();
  });
});
