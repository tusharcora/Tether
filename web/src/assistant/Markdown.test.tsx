import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule } from '../test/css';
import { Chat } from './Chat';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders inline code, bold, italic, lists and paragraphs, with no raw markers', () => {
    const { container } = render(<Markdown text={'Use `retry()` with **care** and *speed*.\n\n- one\n- two\n\n1. first\n2. second'} />);
    expect(container.querySelector('code')!.textContent).toBe('retry()');
    expect(container.querySelector('strong')!.textContent).toBe('care');
    expect(container.querySelector('em')!.textContent).toBe('speed');
    expect(container.querySelectorAll('ul li').length).toBe(2);
    expect(container.querySelectorAll('ol li').length).toBe(2);
    expect(container.textContent).not.toMatch(/[`*]/);
  });
  it('sends fenced blocks to the code block', () => {
    render(<Markdown text={'Here:\n\n```ts\nconst a = 1;\n```\n\nDone'} />);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });
  it('turns [n] into a marker chip that opens its source; unknown numbers stay text', () => {
    const onCite = vi.fn();
    const { container } = render(<Markdown text="See it [1] and [7]." cites={new Set([1])} onCite={onCite} />);
    fireEvent.click(screen.getByRole('link', { name: 'View citation 1' }));
    expect(onCite).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('[7]');
  });
});

describe('the prompt', () => {
  it('keeps no border or fill on the textarea inside the composer', () => {
    const rule = cssRule('assistant/assistant.css', '.tether-panel form textarea');
    expect(rule).toMatch(/border: 0/);
    expect(rule).toMatch(/background: transparent/);
  });
  it('keeps the picked model per project across a remount', () => {
    localStorage.clear();
    const chat = { messages: [], models: ['opus', 'sonnet', 'haiku'], model: 'sonnet', loading: false, queue: [], send: vi.fn(), stop: vi.fn() } as never;
    const ui = <Chat chat={chat} project="api" context={{ page: 'home' }} onGo={() => {}} />;
    const a = render(ui);
    expect(screen.getAllByText('sonnet').length).toBeGreaterThan(0);
    localStorage.setItem('tether.assistant.model.api', 'haiku');
    a.unmount();
    render(ui);
    expect(screen.getAllByText('haiku').length).toBeGreaterThan(0);
  });
});
