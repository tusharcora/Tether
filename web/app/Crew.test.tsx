import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Crew } from './Crew';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const bots = [{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change', look, builtin: true }];

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'GET /api/crew': { bots, packs: [], parts: { body: ['pebble'], eyes: ['dots'], mouth: ['none'], top: ['none'], side: ['none'], pattern: ['none'] }, kinds: [{ kind: 'agent', blurb: 'does a job' }], style: 'pebble', styles: [{ id: 'pebble', blurb: 'pixel bots' }, { id: 'sigil', blurb: 'glyphs' }], shapes: {}, glyphs: {}, evolve: {} },
    'GET /api/bots': { crew: [{ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null }], agents: { claude: { ok: true, models: ['opus'] }, codex: { ok: true, models: [] } } },
    'PUT /api/bots/coder': {},
    'DELETE /api/bots/coder': {},
    'PUT /api/crew/style': {},
    'POST /api/crew/preview': { grid: ['#'], colors: { '#': '#fff' } },
    'PUT /api/crew/quill': {},
  });
});

describe('Crew', () => {
  it('saves a link only when changed; the default agent unlinks (as in the Solid UI)', async () => {
    renderApp(<Crew />);
    expect(await screen.findByText('Bolt')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    expect(save.disabled).toBe(false);
    await act(async () => fireEvent.click(save));
    // the agent select still shows "default (claude)" (NONE -> ''), and an empty agent means DELETE
    expect(calls('DELETE', '/api/bots/coder')).toHaveLength(1);
    expect(calls('PUT', '/api/bots/coder')).toHaveLength(0);
  });

  it('switches the crew style', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: 'sigil' }));
    await waitFor(() => expect(calls('PUT', '/api/crew/style')[0]![2]).toEqual({ style: 'sigil' }));
  });

  it('creates a bot from the editor and debounces the preview', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New bot' }));
    const name = await screen.findByLabelText('Name');
    vi.mocked(api).mockClear();
    fireEvent.change(name, { target: { value: 'Q' } });
    fireEvent.change(name, { target: { value: 'Qu' } });
    fireEvent.change(name, { target: { value: 'Quill' } });
    await waitFor(() => expect(calls('POST', '/api/crew/preview')).toHaveLength(1));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    expect(calls('PUT', '/api/crew/quill')[0]![2]).toMatchObject({ id: 'quill', name: 'Quill' });
  });

  it('shows a load failure inline and retries', async () => {
    const bots = { crew: [{ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null }], agents: { claude: { ok: true, models: [] } } };
    let down = true;
    const prev = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/api/bots') {
        if (down) throw new Error('down');
        return structuredClone(bots) as never;
      }
      return prev(method, path, body);
    });
    renderApp(<Crew />);
    expect((await screen.findByRole('alert')).textContent).toContain('down');
    down = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() => expect(calls('GET', '/api/bots')).toHaveLength(2));
    expect(screen.queryByText('down')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
