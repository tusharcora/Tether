import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerForm } from './TriggerForm';
import { blank } from './types';

const agents = { claude: { ok: true, models: ['opus'] } };
const fns = () => ({ onChange: vi.fn(), onSave: vi.fn(), onClose: vi.fn() });

describe('TriggerForm', () => {
  it('opens a new trigger in a drawer and saves only with a repo and a workflow', () => {
    const f = fns();
    const { rerender } = render(<TriggerForm form={blank()} editing={false} workspaces={[]} agents={agents} workflows={['full-review']} {...f} />);
    expect(screen.getByRole('form', { name: 'New trigger' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'acme/api' } });
    expect(f.onChange).toHaveBeenCalledWith({ repo: 'acme/api' });
    expect(screen.getByPlaceholderText('workspace id (optional)')).toBeTruthy();
    rerender(<TriggerForm form={{ ...blank(), repo: 'acme/api' }} editing={false} workspaces={[]} agents={agents} workflows={['full-review']} {...f} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(f.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it('locks the id while editing and offers the workspace picker when workspaces exist', () => {
    const ws = [{ id: 'api', name: 'API', path: '/code/api', isDefault: true, exists: true, repos: [] }];
    render(<TriggerForm form={{ ...blank(), id: 'acme-full-review', repo: 'acme/api' }} editing workspaces={ws} agents={agents} workflows={[]} {...fns()} />);
    expect(screen.getByRole('form', { name: 'Edit trigger' })).toBeTruthy();
    expect((screen.getByLabelText('Id') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('combobox', { name: /Workspace/ })).toBeTruthy();
  });
});
