import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Crew } from './Crew';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const bots = [{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change', look, builtin: true }];

const crewReply = { bots, packs: [], parts: { body: ['pebble'], eyes: ['dots'], mouth: ['none'], top: ['none'], side: ['none'], pattern: ['none'] }, kinds: [{ kind: 'agent', blurb: 'does a job' }, { kind: 'verdict', blurb: 'passes or fails' }], style: 'pebble', styles: [{ id: 'pebble', blurb: 'pixel bots' }, { id: 'sigil', blurb: 'glyphs' }], shapes: {}, glyphs: {}, evolve: {}, ecc: null as { ref: string; at: string } | null, eccDefault: 'v2.2.3' };
const botsReply = { crew: [{ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null as { agent: string; model?: string } | null }], agents: { claude: { ok: true, models: ['opus'] }, codex: { ok: true, models: [] } } };
const routes = {
  'GET /api/crew': crewReply,
  'GET /api/bots': botsReply,
  'PUT /api/bots/coder': {},
  'DELETE /api/bots/coder': {},
  'PUT /api/crew/quill': {},
  'PUT /api/crew/coder': {},
  'PUT /api/crew/go-reviewer': {},
  'POST /api/crew/import': { ref: 'v2.2.3', added: ['go-reviewer'], updated: [], removed: [], skipped: [], notes: [], skills: 1, commands: 1 },
  'DELETE /api/crew': { removed: ['go-reviewer'] },
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi(routes);
});

describe('Crew', () => {
  it('shows the ascii skeleton while the crew loads', () => {
    routeApi({ ...routes, 'GET /api/crew': new Promise(() => {}) });
    const { container } = renderApp(<Crew />);
    expect(screen.getByRole('status', { name: 'Checking which agents are installed' })).toBeTruthy();
    expect(container.querySelector('[data-ascii-skeleton]')).toBeTruthy();
    expect(screen.queryByText('Checking which agents are installed…')).toBeNull();
  });
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

  it('creates a bot from the editor with a live face preview and no server preview', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New bot' }));
    const name = await screen.findByLabelText('Name');
    expect(screen.getByRole('img', { name: 'New bot preview' })).toBeTruthy();
    vi.mocked(api).mockClear();
    fireEvent.change(name, { target: { value: 'Quill' } });
    expect(screen.getByRole('img', { name: 'Quill preview' })).toBeTruthy();
    expect(calls('POST', '/api/crew/preview')).toHaveLength(0);
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

describe('crew sources and faces', () => {
  it('filters by source and shows when-to-use', async () => {
    routeApi({ ...routes, 'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', persona: '', look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go' }], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } }, 'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] } });
    renderApp(<Crew />);
    expect(await screen.findByText('Use for Go')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Built-in/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Built-in/ }));
    expect(screen.queryByText('Go Reviewer')).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /ECC/ }));
    fireEvent.click(screen.getByRole('tab', { name: /ECC/ }));
    expect(screen.getByText('Go Reviewer')).toBeTruthy();
  });

  it('imports ECC after confirming in a dialog', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: 'Import ECC…' }));
    expect(await screen.findByText(/v2\.2\.3/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import' })));
    expect(calls('POST', '/api/crew/import')[0]![2]).toEqual({ source: 'ecc' });
  });

  it('edits a face with sliders and saves it on the bot', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    const before = (await screen.findByRole('img', { name: 'Bolt preview' })).innerHTML;
    fireEvent.keyDown(screen.getByRole('slider', { name: /Hue/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('img', { name: 'Bolt preview' }).innerHTML).not.toBe(before);
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    expect(calls('PUT', '/api/crew/coder')[0]![2]).toMatchObject({ look: { face: { hue: expect.any(Number) } } });
  });

  it('shows no ECC wording when nothing is imported except the import button', async () => {
    renderApp(<Crew />);
    await screen.findByText('Bolt');
    expect(screen.queryByRole('tab', { name: /ECC/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove ECC' })).toBeNull();
    const ecc = screen.queryAllByText(/ECC/);
    expect(ecc).toHaveLength(1);
    expect(ecc[0]!.closest('button')?.textContent).toBe('Import ECC…');
  });

  it('does not save the default hue until the slider moves, and resets to the generated face', async () => {
    routeApi({ ...routes, 'GET /api/crew': { ...crewReply, bots: [{ ...bots[0]!, look: { ...look, face: { hue: 10, tone: 0.3 } } }] } });
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset to generated' }));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    const sent = calls('PUT', '/api/crew/coder')[0]![2] as { look: Record<string, unknown> };
    expect('face' in sent.look).toBe(false);
  });

  describe('imported bots', () => {
    const imported = { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', persona: 'You review Go…', personaTruncated: true, look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go' };
    beforeEach(() => {
      routeApi({
        ...routes,
        'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, imported], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } },
        'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] },
      });
    });

    it('loads the full persona for the editor and saves the edited full text', async () => {
      const full = 'You review Go. '.repeat(300);
      routeApi({
        ...routes,
        'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, imported], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } },
        'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] },
        'GET /api/crew/go-reviewer': { ...imported, persona: full, personaTruncated: undefined },
      });
      renderApp(<Crew />);
      fireEvent.click(await screen.findByRole('button', { name: /Edit Go Reviewer/ }));
      expect(calls('GET', '/api/crew/go-reviewer')).toHaveLength(1);
      const persona = (await screen.findByLabelText(/Persona/)) as HTMLTextAreaElement;
      await waitFor(() => expect(persona.value).toBe(full));
      expect(persona.readOnly).toBe(false);
      expect(screen.getByText('From ECC; an update replaces your edits')).toBeTruthy();
      fireEvent.change(persona, { target: { value: full + 'Be brief.' } });
      await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
      const sent = calls('PUT', '/api/crew/go-reviewer')[0]![2] as Record<string, unknown>;
      expect(sent.persona).toBe(full + 'Be brief.');
      expect('personaTruncated' in sent).toBe(false);
    });

    it('keeps the truncated persona read-only and sends personaTruncated when the full bot cannot load', async () => {
      renderApp(<Crew />);
      fireEvent.click(await screen.findByRole('button', { name: /Edit Go Reviewer/ }));
      expect(await screen.findByText('Showing the first 2000 characters; edits are disabled until the full text loads')).toBeTruthy();
      const persona = screen.getByLabelText(/Persona/) as HTMLTextAreaElement;
      expect(persona.readOnly).toBe(true);
      fireEvent.change(persona, { target: { value: 'lost edit' } });
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'gopher' } });
      await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
      expect(calls('PUT', '/api/crew/go-reviewer')[0]![2]).toMatchObject({ title: 'gopher', personaTruncated: true, persona: 'You review Go…' });
    });

    it('shows an ECC badge, offers update and removes ECC after confirming', async () => {
      renderApp(<Crew />);
      expect(await screen.findByRole('button', { name: 'Update ECC…' })).toBeTruthy();
      expect(screen.getAllByText('ECC').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Remove ECC' }));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove' })));
      expect(calls('DELETE', '/api/crew?source=ecc')).toHaveLength(1);
    });

    it('shows the version change in the update dialog', async () => {
      renderApp(<Crew />);
      fireEvent.click(await screen.findByRole('button', { name: 'Update ECC…' }));
      expect(await screen.findByText('Version v2.2.3 → v2.2.3')).toBeTruthy();
    });
  });
});
