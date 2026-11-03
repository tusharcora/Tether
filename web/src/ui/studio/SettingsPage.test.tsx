import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { ToastStackProvider } from '../../components/beui/kit/toast';
import { cssRule } from '../../test/css';
import { TRUST_BODY } from '../../../../src/runLabels';
import { SettingsPage } from './SettingsPage';

vi.mock('../../api', async (orig) => ({ ...(await orig<typeof import('../../api')>()), api: vi.fn() }));

const base = { onClose: () => {}, choice: 'system' as const, onChoice: () => {}, vault: '/home/me/notes/aorch', connection: 'connected' as const };

describe('SettingsPage', () => {
  it('holds theme, the full vault path, the loopback note and the connection', () => {
    render(<SettingsPage {...base} />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Match system' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('/home/me/notes/aorch')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy path/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Why loopback only/ }));
    expect(screen.getByText(/only listens on this machine/)).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('says what Tether is, that aorch still works and where the data stays', () => {
    const { rerender } = render(<SettingsPage {...base} home="/Users/me/.aorch" />);
    const about = screen.getByRole('region', { name: 'About' });
    expect(about.textContent).toMatch(/Tether/);
    expect(about.textContent).toMatch(/aorch still works/);
    expect(about.textContent).toContain('/Users/me/.aorch');
    expect(about.querySelectorAll('img')).toHaveLength(2);
    rerender(<SettingsPage {...base} />);
    expect(screen.getByRole('region', { name: 'About' }).textContent).toContain('~/.aorch');
  });

  it('lists the agent tools when given them', () => {
    const tools = { data: { agents: [{ id: 'codex', ok: true, version: '0.48' }], rg: { ok: false } }, error: undefined, fails: 0, refresh: async () => {} };
    const { rerender } = render(<SettingsPage {...base} />);
    expect(screen.queryByRole('region', { name: 'Agent tools' })).toBeNull();
    rerender(<SettingsPage {...base} tools={tools} />);
    expect(screen.getByRole('region', { name: 'Agent tools' }).textContent).toContain('codex0.48');
  });

  it('has the app’s notification switch when given one', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SettingsPage {...base} />);
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    rerender(<SettingsPage {...base} notifications={{ on: true, onChange }} />);
    const sw = screen.getByRole('switch', { name: /needs me or finishes/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('has the Spending caps switch, off by default, saying cost never stops a run while off', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SettingsPage {...base} />);
    expect(screen.queryByRole('region', { name: 'Runs' })).toBeNull();
    rerender(<SettingsPage {...base} caps={{ on: false, onChange }} />);
    const runs = screen.getByRole('region', { name: 'Runs' });
    expect(runs.textContent).toContain('Off: runs never stop because of cost. Costs still show everywhere.');
    const sw = within(runs).getByRole('switch', { name: /spending caps/i });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('has the Auto-fix switch, on by default, and its rounds, next to Spending caps', () => {
    const onChange = vi.fn();
    const onRounds = vi.fn();
    render(<SettingsPage {...base} caps={{ on: false, onChange: vi.fn() }} autoFix={{ on: true, rounds: 3, onChange, onRounds }} />);
    const runs = screen.getByRole('region', { name: 'Runs' });
    const sw = within(runs).getByRole('switch', { name: /auto-fix failed runs/i });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(runs.textContent).toContain('A failed run is diagnosed and retried, then moved to a stronger model.');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
    fireEvent.click(within(runs).getByRole('button', { name: '5' }));
    expect(onRounds).toHaveBeenCalledWith(5);
  });

  it("has Don't ask for small jobs, saying small jobs then start without asking in trusted folders", () => {
    const onChange = vi.fn();
    render(<SettingsPage {...base} caps={{ on: false, onChange: vi.fn() }} solo={{ on: false, onChange }} />);
    const runs = screen.getByRole('region', { name: 'Runs' });
    expect(runs.textContent).toContain('On: small jobs start without asking in folders you trust.');
    fireEvent.click(within(runs).getByRole('switch', { name: "Don't ask for small jobs" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Settings lists trusted folders and withdraws one', async () => {
    const refresh = vi.fn(async () => {});
    vi.mocked(api).mockResolvedValue({ folders: [] });
    const trust = { data: { folders: [{ folder: '/home/me/hw3', trusted: true, exists: true }, { folder: '/home/me/gone', trusted: true, exists: false }, { folder: '/home/me/no', trusted: false, exists: true }] }, error: undefined, fails: 0, refresh };
    render(<ToastStackProvider><SettingsPage {...base} trust={trust} /></ToastStackProvider>);
    const card = screen.getByRole('region', { name: 'Trusted folders' });
    expect(card.textContent).toContain('/home/me/hw3');
    expect(card.textContent).toContain('/home/me/gone');
    expect(card.textContent).toContain('Folder not found');
    fireEvent.click(within(card).getAllByRole('button', { name: 'Withdraw' })[0]!);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(vi.mocked(api)).toHaveBeenCalledWith('DELETE', '/api/trust', { folder: '/home/me/hw3' });
    // a folder that said no is never asked again, so this is the way back
    fireEvent.click(within(card).getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('DELETE', '/api/trust', { folder: '/home/me/no' }));
  });

  it('trusts a project not yet asked about, only after the same notice', async () => {
    const refresh = vi.fn(async () => {});
    vi.mocked(api).mockClear();
    vi.mocked(api).mockResolvedValue({ folders: [] });
    const trust = { data: { folders: [{ folder: '/home/me/hw3', trusted: true, exists: true }], unanswered: [{ folder: '/home/me/app', name: 'app' }] }, error: undefined, fails: 0, refresh };
    render(<ToastStackProvider><SettingsPage {...base} trust={trust} /></ToastStackProvider>);
    const card = screen.getByRole('region', { name: 'Trusted folders' });
    expect(within(card).getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Trust' }));
    const d = await screen.findByRole('dialog', { name: 'Trust this folder?' });
    expect(d.textContent).toContain(TRUST_BODY);
    expect(d.textContent).toContain('/home/me/app');
    expect(vi.mocked(api)).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trust this folder?' })).toBeNull());
    expect(vi.mocked(api)).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Trust' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Trust this folder?' })).getByRole('button', { name: 'Trust this folder' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(vi.mocked(api)).toHaveBeenCalledWith('PUT', '/api/trust', { folder: '/home/me/app', trusted: true });
  });

  it('says so when no folder has been asked about', () => {
    render(<ToastStackProvider><SettingsPage {...base} trust={{ data: { folders: [] }, error: undefined, fails: 0, refresh: async () => {} }} /></ToastStackProvider>);
    expect(screen.getByRole('region', { name: 'Trusted folders' }).textContent).toContain('No folders yet.');
  });

  it('picks a theme', () => {
    const onChoice = vi.fn();
    render(<SettingsPage {...base} onChoice={onChoice} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onChoice).toHaveBeenCalledWith('dark');
  });

  it('shows reconnecting and offline', () => {
    const { rerender } = render(<SettingsPage {...base} connection="reconnecting" />);
    expect(screen.getByText('reconnecting')).toBeTruthy();
    rerender(<SettingsPage {...base} connection="offline" vault={undefined} />);
    expect(screen.getByText('offline')).toBeTruthy();
    expect(screen.getByText('Not known until the server answers.')).toBeTruthy();
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    render(<SettingsPage {...base} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the page on open and back to the opener on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open settings</button>
          {open ? <SettingsPage {...base} onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('is a page of section cards with a section list that marks the one picked, and folds the long help', () => {
    const tools = { data: { agents: [{ id: 'codex', ok: true, version: '0.48' }], rg: { ok: false } }, error: undefined, fails: 0, refresh: async () => {} };
    render(<SettingsPage {...base} tools={tools} notifications={{ on: true, onChange: () => {} }} />);
    const page = screen.getByRole('dialog', { name: 'Settings' });
    expect(page.getAttribute('aria-modal')).toBeNull();
    expect(within(page).getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Agents & tools', 'Appearance', 'Storage', 'Server', 'About']);
    expect([...page.querySelectorAll('.st-card > h2')].map((h) => h.textContent)).toEqual(['Agents & tools', 'Appearance', 'Storage', 'Server', 'About']);
    fireEvent.click(within(nav).getByRole('button', { name: 'Storage' }));
    expect(within(nav).getByRole('button', { name: 'Storage' }).getAttribute('aria-current')).toBe('true');
    expect(within(nav).getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBeNull();
    // long help is folded until asked for
    expect(screen.getByRole('button', { name: /Why loopback only/ }).getAttribute('aria-expanded')).toBe('false');
    // it covers the content area like a page, the screen underneath stays mounted (grid cell overlay, not a drawer)
    expect(cssRule('ui/studio/settings-page.css', '.st-page')).toContain('grid-area: 1 / 2');
    // the content area sits in that same cell explicitly (auto-placed, it would be pushed aside into a new column)
    expect(cssRule('ui/studio/shell.css', '.shell-main')).toContain('grid-area: 1 / 2');
    expect(cssRule('ui/studio/shell.css', '.shell.phone .shell-main')).toContain('grid-area: 1 / 1');
    expect(cssRule('ui/studio/settings-page.css', '.shell.phone .st-page, .st-alone .st-page')).toContain('grid-area: 1 / 1');
  });

  it('closes with the × in its top bar', () => {
    const onClose = vi.fn();
    render(<SettingsPage {...base} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a neutral connecting state before the server first answers', () => {
    const { container } = render(<SettingsPage {...base} connection="connecting" />);
    expect(screen.getByText('connecting')).toBeTruthy();
    expect(container.ownerDocument.querySelector('[data-status="neutral"]')).toBeTruthy();
  });

  it('returns focus to the fallback when the opener is gone', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button">Fallback</button>
          {open ? null : <button type="button" onClick={() => setOpen(true)}>Menu item</button>}
          {open ? <SettingsPage {...base} onClose={() => setOpen(false)} returnFocus={() => screen.getByRole('button', { name: 'Fallback' })} /> : null}
        </>
      );
    }
    render(<Harness />);
    const item = screen.getByRole('button', { name: 'Menu item' });
    item.focus();
    fireEvent.click(item);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fallback' }));
  });
});
