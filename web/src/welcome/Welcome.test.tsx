import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { routeApi } from '../test/fixtures';
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

  it('hides Recent when empty', () => {
    setup();
    expect(screen.queryByRole('heading', { name: 'Recent' })).toBeNull();
  });
});
