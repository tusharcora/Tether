import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { dropOf, fakeBridge, routeApi } from '../test/fixtures';
import { Welcome } from './Welcome';

const tools = { agents: [{ id: 'claude', ok: true, version: '2.4.1' }, { id: 'gemini', ok: false }], rg: { ok: true, version: '14.1' } };
const setup = (o: Partial<Parameters<typeof Welcome>[0]> = {}) => {
  const p = { recent: [], onAdd: vi.fn(async () => {}), onPick: vi.fn(), onSkip: vi.fn(), ...o };
  render(<Welcome {...p} />);
  return p;
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/tools': tools });
});

describe('Welcome', () => {
  it('opens a typed folder path, and says why one could not be opened', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('/nope does not exist')).mockResolvedValue(undefined);
    setup({ onAdd });
    expect(screen.getByRole('heading', { level: 1, name: 'Open a project' })).toBeTruthy();
    const field = screen.getByRole('textbox', { name: 'Folder path' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: ' /nope ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(await screen.findByText('/nope does not exist')).toBeTruthy();
    expect(onAdd).toHaveBeenCalledWith('/nope');
    fireEvent.change(field, { target: { value: '/code/shop' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(onAdd).toHaveBeenLastCalledWith('/code/shop'));
  });

  it('shows which agent tools and ripgrep were found', async () => {
    setup();
    const strip = await screen.findByRole('list', { name: 'Agent tools' });
    const chips = within(strip).getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toEqual(['claude2.4.1', 'gemininot found', 'rg14.1']);
    expect(within(strip).getByText('gemini').closest('li')!.getAttribute('title')).toBe('Not found on PATH');
    expect(within(strip).getAllByRole('listitem')[0]!.querySelector('.tool-dot.ok')).toBeTruthy();
  });

  it('gives the tools strip its own error with Retry', async () => {
    routeApi({ 'GET /api/tools': new Error('server down') });
    setup();
    expect(await screen.findByText('server down')).toBeTruthy();
    routeApi({ 'GET /api/tools': tools });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Agent tools' })).toBeTruthy();
  });

  it('lists recent projects only when there are some, and can be skipped', () => {
    const p = setup({ recent: [{ id: 'shop', name: 'orders-api', path: '/code/orders-api', isDefault: true, exists: true, repos: [] }] });
    fireEvent.click(screen.getByRole('button', { name: /orders-api/ }));
    expect(p.onPick).toHaveBeenCalledWith('shop');
    expect(screen.getByText('OA')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without a project' }));
    expect(p.onSkip).toHaveBeenCalled();
  });

  describe('in Tether.app', () => {
    it('offers the drop zone and the folder picker instead of the path field', async () => {
      const { b } = fakeBridge();
      b.openFolder.mockResolvedValue('/code/shop');
      const p = setup();
      expect(screen.queryByRole('textbox', { name: 'Folder path' })).toBeNull();
      const zone = screen.getByRole('region', { name: 'Open a folder' });
      expect(zone.textContent).toContain('Drag a project folder here');
      fireEvent.click(within(zone).getByRole('button', { name: /Open folder…/ }));
      await waitFor(() => expect(p.onAdd).toHaveBeenCalledWith('/code/shop'));
    });

    it('opens a dropped folder and says so when a file is dropped', async () => {
      fakeBridge();
      const p = setup();
      const zone = screen.getByRole('region', { name: 'Open a folder' });
      fireEvent.dragOver(zone, { dataTransfer: dropOf({ name: 'shop', dir: true }) });
      expect(zone.textContent).toContain('Drop to open this folder');
      fireEvent.drop(zone, { dataTransfer: dropOf({ name: 'notes.txt' }) });
      expect(await within(zone).findByRole('alert')).toBeTruthy();
      fireEvent.drop(zone, { dataTransfer: dropOf({ name: 'shop', dir: true }) });
      await waitFor(() => expect(p.onAdd).toHaveBeenCalledWith('/drop/shop'));
    });

    it('names the way back when opened from File → Welcome', () => {
      fakeBridge();
      setup({ skipLabel: 'Back to Tether' });
      expect(screen.getByRole('button', { name: 'Back to Tether' })).toBeTruthy();
    });
  });

  it('hides Recent when empty', () => {
    setup();
    expect(screen.queryByRole('heading', { name: 'Recent' })).toBeNull();
  });
});
