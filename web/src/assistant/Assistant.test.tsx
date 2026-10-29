import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastStackProvider } from '../components/beui/kit/toast';
import { Assistant } from './Assistant';
import { cssRule } from '../test/css';
import type { ChatSummary } from './api';
import { contextLine, contextOf } from './context';
import { useActiveChat, useAssistant } from './useAssistant';
import { useAssistantShell } from './useAssistantShell';

const chats: Record<string, { id: string; role: 'you' | 'tether'; text: string; at: number }[]> = {
  a: [{ id: 'm1', role: 'you', text: 'hello from a', at: 1 }],
  b: [{ id: 'm2', role: 'you', text: 'hello from b', at: 2 }],
};
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  assistantApi: {
    chat: vi.fn(async (ws?: string, chat?: string) => ({ messages: chat ? (chats[ws ?? ''] ?? []) : [], ...(chat === 'ca' ? { title: 'Why did the README run fail?' } : {}), agent: 'claude', models: [] })),
  },
}));

const route = { tab: 'runs' as const, id: 'rmh0aaa4f21' };
const summary = (id: string, title: string): ChatSummary => ({ id, title, updated: 1, count: 2, last: '', kind: 'answer', outcome: [], faces: [], cites: [] });
const list = [summary('ca', 'Why did the README run fail?'), summary('c2', 'Plan the Teams feature'), summary('c3', 'Free models: rate limits')];
const hooks = { onFullScreen: vi.fn(), onAllChats: vi.fn() };
/** Wired as App wires it: the shell, the active chat and the chat hook live outside the panel. */
function Harness(p: { project: { id: string; name: string }; needs: number; phone: boolean; hidden?: boolean }) {
  const shell = useAssistantShell({ needs: p.needs, phone: p.phone });
  const [active, setActive] = useActiveChat(p.project.id);
  const chat = useAssistant(p.project.id, active, shell.mode !== 'closed', { created: setActive, gone: () => setActive(undefined) });
  return <Assistant shell={shell} chat={chat} chats={list} project={p.project} route={route} phone={p.phone} hidden={p.hidden} onPick={setActive} onFullScreen={hooks.onFullScreen} onAllChats={hooks.onAllChats} onGo={() => {}} />;
}
const tree = (o: Partial<{ project: { id: string; name: string }; needs: number; phone: boolean; hidden: boolean }> = {}) => (
  <ToastStackProvider>
    <div className="shell">
      <Harness project={o.project ?? { id: 'a', name: 'orders' }} needs={o.needs ?? 0} phone={o.phone ?? false} hidden={o.hidden} />
    </div>
  </ToastStackProvider>
);
const mount = (o: Parameters<typeof tree>[0] = {}) => render(tree(o));
const panel = () => screen.queryByRole('region', { name: 'Tether assistant' });

beforeEach(() => localStorage.clear());

describe('Assistant shell', () => {
  it('shows the launcher with an amber count, opens on click and clears the badge', () => {
    mount({ needs: 3 });
    const l = screen.getByRole('button', { name: /Ask Tether.*3 need you/ });
    expect(l.textContent).toContain('3');
    fireEvent.click(l);
    expect(panel()).toBeTruthy();
    expect(document.querySelector('.tether-badge')).toBeNull();
  });
  it('toggles with Meta-J and closes with Escape', () => {
    mount();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(panel()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel()).toBeNull();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(panel()).toBeNull();
  });
  it('docks and pops out, remembered on this device', () => {
    const { unmount } = mount();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Dock to the side' }));
    expect(document.querySelector('.tether-panel.docked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask Tether/ })).toBeNull();
    unmount();
    mount();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(document.querySelector('.tether-panel.docked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    expect(document.querySelector('.tether-panel.float')).toBeTruthy();
  });
  it('phones get no dock button', () => {
    mount({ phone: true });
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(screen.queryByRole('button', { name: /Dock to the side/ })).toBeNull();
  });
  it('on a phone the panel spans the screen width, never docks, and the launcher clears the bottom bar', () => {
    localStorage.setItem('tether.assistant.dock', 'docked');
    mount({ phone: true });
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(document.querySelector('.tether-panel.docked')).toBeNull();
    expect(document.querySelector('.tether-panel.float')).toBeTruthy();
    const panel = cssRule('assistant/assistant.css', '.shell.phone .tether-panel.float');
    expect(panel).toMatch(/left: 8px/);
    expect(panel).toMatch(/right: 8px/);
    expect(panel).toMatch(/width: auto/);
    expect(cssRule('assistant/assistant.css', '.tether-body')).toMatch(/overflow-x: hidden/);
    const bottom = /bottom: calc\((\d+)px/.exec(cssRule('assistant/assistant.css', '.shell.phone .tether-launcher'));
    expect(Number(bottom?.[1])).toBeGreaterThanOrEqual(64);
  });
  it('says what it knows and keeps one chat per project', async () => {
    localStorage.setItem('tether.assistant.chat.a', 'ca');
    localStorage.setItem('tether.assistant.chat.b', 'cb');
    const { rerender } = mount();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(screen.getByText('Sees: Runs · R-4F21')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('hello from a')).toBeTruthy());
    rerender(tree({ project: { id: 'b', name: 'billing' } }));
    await waitFor(() => expect(screen.getByText('hello from b')).toBeTruthy());
    expect(screen.queryByText('hello from a')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New chat' })));
    await waitFor(() => expect(screen.queryByText('hello from b')).toBeNull());
  });
  it('switches chats from the title: find one, pick it, start a new one, or list them all', async () => {
    localStorage.setItem('tether.assistant.chat.a', 'ca');
    mount();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    await waitFor(() => expect(screen.getByText('hello from a')).toBeTruthy());
    const title = screen.getByRole('button', { name: 'Switch chat (Why did the README run fail?)' });
    fireEvent.click(title);
    const pop = screen.getByRole('dialog', { name: 'Switch chat' });
    expect(within(pop).getByRole('button', { name: 'Why did the README run fail?' }).getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(within(pop).getByLabelText('Find a chat'));
    fireEvent.change(within(pop).getByLabelText('Find a chat'), { target: { value: 'teams' } });
    expect(within(pop).queryByRole('button', { name: 'Free models: rate limits' })).toBeNull();
    fireEvent.click(within(pop).getByRole('button', { name: 'Plan the Teams feature' }));
    expect(localStorage.getItem('tether.assistant.chat.a')).toBe('c2');
    expect(screen.queryByRole('dialog', { name: 'Switch chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Switch chat/ }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Switch chat' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Switch chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Switch chat/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Switch chat' })).getByRole('button', { name: 'All chats' }));
    expect(hooks.onAllChats).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(hooks.onFullScreen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(localStorage.getItem('tether.assistant.chat.a')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch chat (New chat)' })).toBeTruthy());
  });

  it('steps aside on a full-screen chat: no launcher, no panel', () => {
    mount({ hidden: true });
    expect(screen.queryByRole('button', { name: /Ask Tether/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(panel()).toBeNull();
  });

  it('derives the selection from the route', () => {
    expect(contextOf({ tab: 'code', id: 'src/a.ts', line: 7 })).toEqual({ page: 'code', selection: { kind: 'file', id: 'src/a.ts', line: 7 } });
    expect(contextOf({ tab: 'home' })).toEqual({ page: 'home' });
    expect(contextLine({ tab: 'home' })).toBe('Sees: Home');
    expect(contextLine({ tab: 'code', id: 'src/http/limit.ts', line: 4 })).toBe('Sees: Code · limit.ts');
  });
});
