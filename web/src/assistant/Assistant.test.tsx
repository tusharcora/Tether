import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastStackProvider } from '../components/beui/kit/toast';
import { Assistant } from './Assistant';
import { cssRule } from '../test/css';
import { contextLine, contextOf } from './context';

const chats: Record<string, { id: string; role: 'you' | 'tether'; text: string; at: number }[]> = {
  a: [{ id: 'm1', role: 'you', text: 'hello from a', at: 1 }],
  b: [{ id: 'm2', role: 'you', text: 'hello from b', at: 2 }],
};
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  assistantApi: {
    chat: vi.fn(async (ws?: string, chat?: string) => ({ messages: chat ? (chats[ws ?? ''] ?? []) : [], agent: 'claude', models: [] })),
  },
}));

const route = { tab: 'runs' as const, id: 'r1' };
const tree = (o: Partial<{ project: { id: string; name: string }; needs: number; phone: boolean }> = {}) => (
  <ToastStackProvider>
    <div className="shell">
      <Assistant project={o.project ?? { id: 'a', name: 'orders' }} route={route} needs={o.needs ?? 0} phone={o.phone ?? false} onGo={() => {}} />
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
    expect(screen.getByText('knows orders · sees the Runs page')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('hello from a')).toBeTruthy());
    rerender(tree({ project: { id: 'b', name: 'billing' } }));
    await waitFor(() => expect(screen.getByText('hello from b')).toBeTruthy());
    expect(screen.queryByText('hello from a')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New chat' })));
    await waitFor(() => expect(screen.queryByText('hello from b')).toBeNull());
  });
  it('derives the selection from the route', () => {
    expect(contextOf({ tab: 'code', id: 'src/a.ts', line: 7 })).toEqual({ page: 'code', selection: { kind: 'file', id: 'src/a.ts', line: 7 } });
    expect(contextOf({ tab: 'home' })).toEqual({ page: 'home' });
    expect(contextLine(undefined, 'home')).toContain('no project open');
  });
});
