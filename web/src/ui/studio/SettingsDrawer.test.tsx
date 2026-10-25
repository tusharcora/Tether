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
});
