import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
// './Crew' (or './Crew.js') resolves to crew.ts on a case-insensitive disk: Vite tries .ts before .tsx, so name the file exactly
import { Crew } from './Crew.tsx';
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
});
