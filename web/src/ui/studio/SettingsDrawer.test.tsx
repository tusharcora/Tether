import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDrawer } from './SettingsDrawer';

const base = { open: true, onClose: () => {}, choice: 'system' as const, onChoice: () => {}, vault: '/home/me/notes/aorch', connection: 'connected' as const };

describe('SettingsDrawer', () => {
  it('holds theme, the full vault path, the loopback note and the connection', () => {
    render(<SettingsDrawer {...base} />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Match system' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('/home/me/notes/aorch')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy path/ })).toBeTruthy();
    expect(screen.getByText(/only listens on this machine/)).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('says what Tether is, that aorch still works and where the data stays', () => {
    const { rerender } = render(<SettingsDrawer {...base} home="/Users/me/.aorch" />);
    const about = screen.getByRole('region', { name: 'About' });
    expect(about.textContent).toMatch(/Tether/);
    expect(about.textContent).toMatch(/aorch still works/);
    expect(about.textContent).toContain('/Users/me/.aorch');
    expect(about.querySelectorAll('img')).toHaveLength(2);
    rerender(<SettingsDrawer {...base} />);
    expect(screen.getByRole('region', { name: 'About' }).textContent).toContain('~/.aorch');
  });

  it('lists the agent tools when given them', () => {
    const tools = { data: { agents: [{ id: 'codex', ok: true, version: '0.48' }], rg: { ok: false } }, error: undefined, fails: 0, refresh: async () => {} };
    const { rerender } = render(<SettingsDrawer {...base} />);
    expect(screen.queryByRole('region', { name: 'Agent tools' })).toBeNull();
    rerender(<SettingsDrawer {...base} tools={tools} />);
    expect(screen.getByRole('region', { name: 'Agent tools' }).textContent).toContain('codex0.48');
  });

  it('has the app’s notification switch when given one', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SettingsDrawer {...base} />);
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    rerender(<SettingsDrawer {...base} notifications={{ on: true, onChange }} />);
    const sw = screen.getByRole('switch', { name: /needs me or finishes/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('picks a theme', () => {
    const onChoice = vi.fn();
    render(<SettingsDrawer {...base} onChoice={onChoice} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onChoice).toHaveBeenCalledWith('dark');
  });

  it('shows reconnecting and offline', () => {
    const { rerender } = render(<SettingsDrawer {...base} connection="reconnecting" />);
    expect(screen.getByText('reconnecting')).toBeTruthy();
    rerender(<SettingsDrawer {...base} connection="offline" vault={undefined} />);
    expect(screen.getByText('offline')).toBeTruthy();
    expect(screen.getByText('Not known until the server answers.')).toBeTruthy();
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...base} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the drawer on open and back to the opener on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open settings</button>
          <SettingsDrawer {...base} open={open} onClose={() => setOpen(false)} />
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

  it('shows a neutral connecting state before the server first answers', () => {
    const { container } = render(<SettingsDrawer {...base} connection="connecting" />);
    expect(screen.getByText('connecting')).toBeTruthy();
    expect(container.ownerDocument.querySelector('.sl-chip.t-neutral')).toBeTruthy();
  });

  it('returns focus to the fallback when the opener is gone', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button">Fallback</button>
          {open ? null : <button type="button" onClick={() => setOpen(true)}>Menu item</button>}
          <SettingsDrawer {...base} open={open} onClose={() => setOpen(false)} returnFocus={() => screen.getByRole('button', { name: 'Fallback' })} />
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
