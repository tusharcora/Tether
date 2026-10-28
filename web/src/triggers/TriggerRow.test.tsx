import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerRow } from './TriggerRow';
import type { Trigger } from './types';

const t = (o: Partial<Trigger> = {}): Trigger => ({ id: 'acme-full-review', repo: 'acme/api', workflow: 'full-review', status: 'idle', last: null, enabled: true, ...o });
const fns = () => ({ onToggle: vi.fn(), onTest: vi.fn(), onLog: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() });
const row = (trigger: Trigger, f = fns()) => render(<ul><TriggerRow t={trigger} {...f} /></ul>);

describe('TriggerRow', () => {
  it('shows the status, events, target and filters of a trigger', () => {
    const { container } = row(t({ labels: ['aorch'], comment: true, agent: 'claude', model: 'opus', workspace: 'api' }));
    expect(container.querySelector('.tg-dot')!.getAttribute('data-status')).toBe('idle');
    expect(screen.getByRole('img', { name: 'idle' })).toBeTruthy();
    expect([...container.querySelectorAll('.tg-line .tg-chip')].map((c) => c.textContent)).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review']);
    expect(screen.getByText('comments')).toBeTruthy();
    expect(screen.getByText('workspace api · claude · opus · Only with labels: aorch')).toBeTruthy();
    expect(screen.getByText('no deliveries')).toBeTruthy();
  });

  it('shows the last delivery as a status chip', () => {
    row(t({ status: 'active', last: { at: new Date().toISOString(), source: 'webhook', repo: 'acme/api', pr: 12, outcome: 'started', runId: 'r9' } }));
    expect(screen.getByText('run started').closest('[data-status]')!.getAttribute('data-status')).toBe('success');
    expect(screen.getByText('#12 · just now')).toBeTruthy();
  });

  it('pauses, tests, opens the log, edits and deletes after confirming', async () => {
    const f = fns();
    const { container } = row(t({ enabled: false, status: 'paused' }), f);
    expect(container.querySelector('.tg-row')!.classList.contains('paused')).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable acme-full-review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect([f.onToggle, f.onTest, f.onLog, f.onEdit, f.onDelete].map((x) => x.mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
  });
});
