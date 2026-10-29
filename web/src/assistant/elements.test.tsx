import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import type { ChatMessage, ToolRun } from './api';
import { DiagramCard, layout, ToolAskCard } from './cards';
import { Thinking } from './Thinking';
import { Thread } from './Thread';

const fakeChat = (messages: ChatMessage[], o: Record<string, unknown> = {}) =>
  ({ messages, models: [], loading: false, queue: [], feedback: vi.fn(), regenerate: vi.fn(async () => {}), send: vi.fn(async () => {}), discard: vi.fn(async () => {}), turnIntoRun: vi.fn(async () => {}), retry: vi.fn(), ...o }) as never;
const you: ChatMessage = { id: 'y', role: 'you', text: 'what is the rate limit?', at: 1 };

describe('the reply’s elements', () => {
  it('actions: thumbs down asks what was wrong and saves it; regenerate and More reach the chat', () => {
    const chat = fakeChat([you, { id: 'a', role: 'tether', text: 'Five a minute.', at: 2 }]) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    renderApp(<Thread chat={chat as never} onGo={vi.fn()} empty="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark response unhelpful' }));
    expect(chat.feedback).toHaveBeenCalledWith('a', 'down');
    fireEvent.click(screen.getByRole('button', { name: 'Too long' }));
    fireEvent.change(screen.getByLabelText('Anything else?'), { target: { value: ' cite the file ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(chat.feedback).toHaveBeenLastCalledWith('a', 'down', { reasons: ['Too long'], note: 'cite the file' });
    expect(screen.queryByText('What went wrong?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }));
    expect(chat.regenerate).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'More response actions' }));
    expect(chat.turnIntoRun).toHaveBeenCalledWith('a');
  });

  it('a failed reply offers Retry (asked again), a stopped one Continue and Discard, a failed load Retry', () => {
    const chat = fakeChat(
      [you, { id: 'a', role: 'tether', text: '', at: 2, error: 'the agent exited 1' }, { ...you, id: 'y2' }, { id: 'b', role: 'tether', text: 'Half of an', at: 4, error: 'Stopped.' }],
      { error: 'offline' },
    ) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    renderApp(<Thread chat={chat as never} onGo={vi.fn()} empty="" />);
    const [load, turn] = screen.getAllByRole('alert');
    expect(load!.textContent).toContain('offline');
    fireEvent.click(within(load!).getByRole('button', { name: /Retry/ }));
    expect(chat.retry).toHaveBeenCalled();
    expect(turn!.textContent).toContain('the agent exited 1');
    fireEvent.click(within(turn!).getByRole('button', { name: /Retry/ }));
    expect(chat.regenerate).toHaveBeenCalledWith('a');
    expect(screen.getByText('Half of an')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(chat.send).toHaveBeenCalledWith('Continue');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(chat.discard).toHaveBeenCalledWith('b');
  });

  it('shows the notes the prompt carried; pressing one opens its passage and Open in Graph', () => {
    const onGo = vi.fn();
    const m: ChatMessage = { id: 'a', role: 'tether', text: 'Five.', at: 2, retrieved: [{ path: 'Notes/limits.md', title: 'Rate limits', score: 8, snippet: 'Five a minute.' }, { path: 'b.md', title: 'B', score: 2, snippet: 'other' }] };
    renderApp(<Thread chat={fakeChat([you, m])} onGo={onGo} empty="" />);
    expect(screen.getByText('what is the rate limit?', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('1.00')).toBeTruthy();
    expect(screen.getByText('0.25')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Rate limits' }));
    expect(screen.getByText('1 pages · 1 cited')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Graph' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'graph', id: 'Notes/limits.md' });
  });

  it('renders the reply’s cards', () => {
    const m: ChatMessage = {
      id: 'a',
      role: 'tether',
      text: 'Here.',
      at: 2,
      cites: [{ n: 1, label: 'limit.ts', kind: 'file', path: 'src/limit.ts' }],
      choice: { traits: ['Tests'], options: [{ name: 'Vitest', headline: 'fast', traits: ['pass'] }, { name: 'Jest', headline: 'old', traits: [false] }], pick: 'Vitest', reason: 'Already set up.' },
      spec: { title: 'Runtime', rows: [{ label: 'Node', value: '22' }] },
      report: { title: 'Limits', sections: [{ heading: 'Now', summary: 'Five', sources: 1 }] },
      timeline: [{ time: '10:42', title: 'Started', when: 'past' }],
      diagram: { title: 'Flow', nodes: [{ id: 'a', label: 'Plan' }, { id: 'b', label: 'Code' }], edges: [{ from: 'a', to: 'b' }] },
    };
    renderApp(<Thread chat={fakeChat([you, m])} onGo={vi.fn()} empty="" />);
    expect(screen.getByText('Already set up.')).toBeTruthy();
    expect(screen.getByText('pick')).toBeTruthy();
    expect(screen.getByText('22')).toBeTruthy();
    expect(screen.getByText('1/1 sections · 1 sources read')).toBeTruthy();
    expect(screen.getByText('Started')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Flow: a to b' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sources/ })).toBeTruthy();
  });
});

describe('the cards', () => {
  it('lays a diagram out by depth, safe on a cycle, and zooms', () => {
    const d = { title: 'F', nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id })), edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'd' }, { from: 'c', to: 'a' }] };
    expect(Object.fromEntries([...layout(d)].map(([id, p]) => [id, [p.col, p.row]]))).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0], d: [1, 1] });
    renderApp(<DiagramCard diagram={d} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeTruthy();
  });

  it('a tool ask is a permission grant: session is once, the decision shows after', async () => {
    const onDecide = vi.fn(async () => {});
    const { rerender } = renderApp(<ToolAskCard ask={{ id: 't', what: 'comment on o/r#4', status: 'pending' }} onDecide={onDecide} />);
    expect(screen.getByText('comment on o/r#4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'This session' }));
    expect(onDecide).toHaveBeenCalledWith('once');
    rerender(<ToolAskCard ask={{ id: 't', what: 'comment on o/r#4', status: 'always' }} onDecide={onDecide} />);
    expect(screen.getByText('granted · always')).toBeTruthy();
  });
});

describe('web steps in the thinking timeline', () => {
  it('shows a search with what it found, and a page it read titled from the search', () => {
    const tools: ToolRun[] = [
      { id: 't1', code: 'http.search("vitest")', output: 'Links: [{"title":"Vitest docs","url":"https://vitest.dev/guide"},{"title":"Blog","url":"https://www.vitest.dev/blog"}]' },
      { id: 't2', code: 'http.get("https://vitest.dev/guide")' },
      { id: 't3', code: 'http.search("old chat")' },
    ];
    renderApp(<Thinking tools={tools} ms={3000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thought for 3s' }));
    expect(screen.getByText('Read 2 sources')).toBeTruthy();
    expect(screen.getAllByText('vitest.dev').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Vitest docs/ }).getAttribute('href')).toBe('https://vitest.dev/guide');
    // a search with no result kept shows its label alone
    expect(screen.queryAllByText('old chat')).toHaveLength(0);
  });
});
