import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerCard } from './TriggerCard';
import type { Trigger } from './types';

const t = (o: Partial<Trigger> = {}): Trigger => ({ id: 'acme-full-review', repo: 'acme/api', workflow: 'full-review', status: 'idle', last: null, enabled: true, ...o });
const card = (trigger: Trigger, f = { onOpen: vi.fn(), onToggle: vi.fn() }) => (render(<ul><TriggerCard t={trigger} selected={false} {...f} /></ul>), f);

describe('TriggerCard', () => {
  it('says what it listens to and what it starts, as a flow line', () => {
    const { container } = render(<ul><TriggerCard t={t({ labels: ['aorch'], comment: true, agent: 'claude', model: 'opus', workspace: 'api' })} selected={false} onOpen={() => {}} onToggle={() => {}} /></ul>);
    expect(container.querySelector('.tg-dot')!.getAttribute('data-status')).toBe('idle');
    expect(screen.getByRole('img', { name: 'idle' })).toBeTruthy();
    expect(screen.getByText('GitHub · acme/api')).toBeTruthy();
    expect([...container.querySelectorAll('.tg-flow .tg-chip')].map((c) => c.textContent)).toEqual(['opened, synchronize, reopened, ready_for_review', 'runs full-review', 'comments on the PR']);
    expect(screen.getByText('workspace api · claude · opus · Only with labels: aorch')).toBeTruthy();
    expect(screen.getByText('no deliveries')).toBeTruthy();
  });

  it('names what fires an issue or comment trigger', () => {
    const { container } = render(
      <ul>
        <TriggerCard t={t({ id: 'i', on: 'issue', label: 'tether' })} selected={false} onOpen={() => {}} onToggle={() => {}} />
        <TriggerCard t={t({ id: 'c', on: 'comment' })} selected={false} onOpen={() => {}} onToggle={() => {}} />
      </ul>,
    );
    expect([...container.querySelectorAll('.tg-flow .tg-chip:first-child')].map((c) => c.textContent)).toEqual(['issue labeled tether', 'comment with @tether']);
  });

  it('says when it last fired, with the outcome', () => {
    card(t({ status: 'active', last: { at: new Date().toISOString(), source: 'webhook', repo: 'acme/api', pr: 12, outcome: 'started', runId: 'r9' } }));
    expect(screen.getByText('run started').closest('[data-status]')!.getAttribute('data-status')).toBe('success');
    expect(screen.getByText('#12 · just now')).toBeTruthy();
  });

  it('opens from the card and switches on and off from its switch', () => {
    const { container } = render(<ul><TriggerCard t={t({ enabled: false, status: 'paused' })} selected onOpen={vi.fn()} onToggle={vi.fn()} /></ul>);
    expect(container.querySelector('.tg-card')!.classList.contains('paused')).toBe(true);
    const f = card(t({ id: 'other' }));
    fireEvent.click(screen.getByRole('button', { name: /^Open other/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pause other' }));
    expect([f.onOpen, f.onToggle].map((x) => x.mock.calls.length)).toEqual([1, 1]);
    expect(screen.getByRole('button', { name: /^Open acme-full-review/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
