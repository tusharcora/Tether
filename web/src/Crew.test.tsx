import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Crew } from './Crew';
import { calls, makeRow, routeApi } from './test/fixtures';
import { cssRule } from './test/css';
import { renderApp } from './test/render';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const bots = [{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change', look, builtin: true }];

const crewReply = { bots, packs: [], parts: { body: ['pebble'], eyes: ['dots'], mouth: ['none'], top: ['none'], side: ['none'], pattern: ['none'] }, kinds: [{ kind: 'agent', blurb: 'does a job' }, { kind: 'verdict', blurb: 'passes or fails' }], style: 'pebble', styles: [{ id: 'pebble', blurb: 'pixel bots' }, { id: 'sigil', blurb: 'glyphs' }], shapes: {}, glyphs: {}, evolve: {}, ecc: null as { ref: string; at: string } | null, eccDefault: 'v2.2.3' };
const botsReply = { crew: [{ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null as { agent: string; model?: string } | null }], agents: { claude: { ok: true, models: ['opus'] }, codex: { ok: true, models: [] } } };
const routes = {
  'GET /api/runs': [],
  'GET /api/crew': crewReply,
  'GET /api/bots': botsReply,
  'PUT /api/bots/coder': {},
  'DELETE /api/bots/coder': {},
  'PUT /api/crew/quill': {},
  'PUT /api/crew/coder': {},
  'PUT /api/crew/go-reviewer': {},
  'POST /api/crew/import': { ref: 'v2.2.3', added: ['go-reviewer'], updated: [], removed: [], skipped: [], notes: [], skills: 1, commands: 1 },
  'DELETE /api/crew': { removed: ['go-reviewer'] },
  // the bot as a teammate (Teams), on its card
  'GET /api/agents/coder': { bot: 'coder', profile: {}, lessons: [], teams: [], recent: [] },
  'GET /api/agents/go-reviewer': { bot: 'go-reviewer', profile: {}, lessons: [], teams: [], recent: [] },
};
const goBot = { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', persona: '', look, source: 'ecc@v2.2.3', whenToUse: 'Use for Go' };
const twoBots = () =>
  routeApi({
    ...routes,
    'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, goBot], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } },
    'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] },
  });

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi(routes);
});
const moreMenu = async () => fireEvent.click(await screen.findByRole('button', { name: 'More crew actions' }));

describe('Crew', () => {
  it('shows the ascii skeleton while the crew loads', () => {
    routeApi({ ...routes, 'GET /api/crew': new Promise(() => {}) });
    const { container } = renderApp(<Crew />);
    expect(screen.getByRole('status', { name: 'Checking which agents are installed' })).toBeTruthy();
    expect(container.querySelector('[data-ascii-skeleton]')).toBeTruthy();
    expect(screen.queryByText('Checking which agents are installed…')).toBeNull();
  });
  it('opens a new bot when the Create menu asks for one, once the crew has loaded', async () => {
    renderApp(<Crew create={1} />);
    expect(await screen.findByRole('img', { name: 'New bot preview' })).toBeTruthy();
  });
  it('saves a link only when changed; the default agent unlinks (as in the Solid UI)', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    const save = screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement;
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
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Coder' }));
    const name = await screen.findByLabelText('Name');
    expect(screen.getByRole('img', { name: 'New bot preview' })).toBeTruthy();
    vi.mocked(api).mockClear();
    fireEvent.change(name, { target: { value: 'Quill' } });
    expect(screen.getByRole('img', { name: 'Quill preview' })).toBeTruthy();
    expect(calls('POST', '/api/crew/preview')).toHaveLength(0);
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    expect(calls('PUT', '/api/crew/quill')[0]![2]).toMatchObject({ id: 'quill', name: 'Quill' });
  });

  it('New bot presets prefill title/persona/look, never a built-in id or name; Planner sets read-only', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New bot' }));
    const menu = await screen.findByRole('menu', { name: '+ New bot' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('aria-label'))).toEqual(['Coder', 'Reviewer', 'Planner', 'Tester']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Coder' }));
    expect((await screen.findByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('coder');
    expect((screen.getByLabelText(/^Persona/) as HTMLTextAreaElement).value).toBe('Writes the change');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coder' } });
    vi.mocked(api).mockClear();
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    // "coder" is the built-in's id: the new bot gets its own
    const put = vi.mocked(api).mock.calls.find((c) => c[0] === 'PUT' && String(c[1]).startsWith('/api/crew/'))!;
    expect(put[1]).toBe('/api/crew/coder2');
    expect(put[2]).toMatchObject({ id: 'coder2', name: 'Coder', kind: 'agent', title: 'coder', persona: 'Writes the change', look: { color: '#3fb97c' } });
    expect(put[2]).not.toHaveProperty('builtin');
  });

  it('the Planner preset makes the new bot read-only', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New bot' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Planner' }));
    expect((await screen.findByRole('switch', { name: /read-only/ })).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('planner');
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
    expect(await screen.findByRole('button', { name: /Edit Bolt/ })).toBeTruthy();
  });

  it('counts the roles in the top bar and opens Evolve for the selected bot from the menu', async () => {
    routeApi({
      ...routes,
      'GET /api/harness/coder': { bot: 'coder', evolvable: true, current: { version: 1, persona: 'Writes code', guidance: [], skills: [] }, versions: [{ version: 1, at: '2026-10-20T10:00:00Z' }], total: 1 },
      'GET /api/proposals': { proposals: [] },
      'GET /api/lessons': { lessons: [] },
    });
    const onBot = vi.fn();
    renderApp(<Crew onBot={onBot} />);
    expect(await screen.findByText('1 role · 0 working')).toBeTruthy();
    await moreMenu();
    expect((screen.getByRole('menuitem', { name: 'Evolve…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Edit Bolt/ }));
    expect(onBot).toHaveBeenCalledWith('coder');
    expect(screen.getByRole('button', { name: /Edit Bolt/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('complementary', { name: 'Bot card' })).getByRole('button', { name: /^Evolve/ })).toBeTruthy();
    await moreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Evolve…' }));
    expect(await screen.findByRole('region', { name: 'Evolve Bolt' })).toBeTruthy();
  });

  it('finds library bots by name or when-to-use', async () => {
    twoBots();
    renderApp(<Crew />);
    await screen.findByRole('button', { name: /Edit Go Reviewer/ });
    fireEvent.change(screen.getByLabelText('Find a bot'), { target: { value: 'use for go' } });
    expect(screen.getByRole('button', { name: /Edit Go Reviewer/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a bot'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('button', { name: /Edit Go Reviewer/ })).toBeNull();
    expect(screen.getByText('No bots match')).toBeTruthy();
    // the search narrows the library, never the lineup
    expect(screen.getByRole('button', { name: /Edit Bolt/ })).toBeTruthy();
  });

  it('lines up the built-in roles with who is working, and you on Gate', async () => {
    const gate = { ...bots[0]!, id: 'approval', name: 'Gate', title: 'approver', kind: 'approval', persona: 'A person.' };
    routeApi({
      ...routes,
      'GET /api/crew': { ...crewReply, bots: [...bots, gate] },
      'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'approval', name: 'Gate', title: 'approver', kind: 'approval', binding: null }] },
      'GET /api/runs': [makeRow({ live: true, steps: [{ id: 'code', status: 'running', bot: 'coder' }] })],
    });
    renderApp(<Crew />);
    const roles = await screen.findByRole('region', { name: 'Roles' });
    expect(within(roles).getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Edit Bolt', 'Edit Gate']);
    expect(await screen.findByText('2 roles · 1 working')).toBeTruthy();
    expect(within(roles).getByText('working')).toBeTruthy();
    expect(within(roles).getByText('you')).toBeTruthy();
    expect(within(roles).getByText('a person')).toBeTruthy();
  });

  it('opens a slot or a library bot in the dock, and Esc closes it', async () => {
    twoBots();
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    const dock = screen.getByRole('complementary', { name: 'Bot card' });
    expect((within(dock).getByLabelText('Name') as HTMLInputElement).value).toBe('Bolt');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Bot card' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Edit Go Reviewer/ }));
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Go Reviewer'));
  });

  it('lets the lineup fill the screen and keeps Swap… whole on narrow slots', () => {
    // Loading's wrapper is positioned inline (AsciiReveal): sized to the screen, the absolute lineup inside it fills the screen too
    expect(cssRule('crew/crew.css', '.cw-load')).toContain('height: 100%');
    expect(cssRule('crew/crew.css', '.cw-load')).toContain('box-sizing: border-box');
    expect(cssRule('crew/crew.css', '.cw-slot-swap')).toContain('flex: none');
  });

  it('hides and shows the library from Library', async () => {
    renderApp(<Crew />);
    const lib = await screen.findByRole('button', { name: /Library/ });
    expect(lib.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(lib);
    expect(screen.queryByLabelText('Find a bot')).toBeNull();
    fireEvent.click(lib);
    expect(screen.getByLabelText('Find a bot')).toBeTruthy();
    // a bottom-wide bar: it stops short of the assistant launcher
    expect(document.querySelector('.cw-bench')!.classList.contains('tf-wide')).toBe(true);
  });

  it('keeps Crew packs, Evolve, Import and Remove ECC in one menu', async () => {
    renderApp(<Crew />);
    await moreMenu();
    expect((screen.getByRole('menuitem', { name: 'Evolve…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'Import ECC…' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Remove ECC…' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Crew packs…' }));
    expect(await screen.findByRole('dialog', { name: 'Crew packs' })).toBeTruthy();
  });

  it('asks before switching bots with unsaved edits', async () => {
    twoBots();
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: /Edit Go Reviewer/ }));
    expect(await screen.findByText('Discard your changes to Bolt?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('changed');
    fireEvent.click(await screen.findByRole('button', { name: /Edit Go Reviewer/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Go Reviewer'));
  });

  it('keeps the board and the editor when a refresh fails, with a retry', async () => {
    let n = 0;
    const prev = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/api/bots' && ++n === 2) throw new Error('refresh down');
      return prev(method, path, body);
    });
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Bolt/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'builder' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect((await screen.findByRole('alert')).textContent).toContain('refresh down');
    expect(screen.getByRole('button', { name: /Edit Bolt/ })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('builder');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('asks before a deep link (e.g. Back) replaces a bot with unsaved edits', async () => {
    twoBots();
    const { rerender } = renderApp(<Crew bot="go-reviewer" onBot={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Go Reviewer'));
    rerender(<Crew bot="coder" onBot={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Bolt'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'changed' } });
    rerender(<Crew bot="go-reviewer" onBot={() => {}} />);
    expect(await screen.findByText('Discard your changes to Bolt?')).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('changed');
  });

  it('clears the selection when the hash goes back to plain #/crew', async () => {
    const { rerender } = renderApp(<Crew bot="coder" onBot={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Bolt'));
    rerender(<Crew onBot={() => {}} />);
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
    expect(screen.getByRole('button', { name: /Edit Bolt/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('moves focus to the first card after removing a bot', async () => {
    const quill = { ...bots[0]!, id: 'quill', name: 'Quill', builtin: false };
    routeApi({
      ...routes,
      'GET /api/crew': { ...crewReply, bots: [...bots, quill] },
      'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'quill', name: 'Quill', title: 'coder', kind: 'agent', binding: null }] },
      'DELETE /api/crew/quill': {},
    });
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit Quill/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove' })));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Edit Bolt/ })));
  });

  it('opens the bot a deep link names and says so when there is none', async () => {
    const { unmount } = renderApp(<Crew bot="coder" onBot={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Bolt'));
    unmount();
    renderApp(<Crew bot="ghost" onBot={() => {}} />);
    expect(await screen.findByText('No bot called “ghost”.')).toBeTruthy();
  });
});

describe('a library bot plays a role (§15.1)', () => {
  const quill = { id: 'quill', name: 'Quill', title: 'poet', kind: 'agent', persona: 'Writes poems', look };
  const gate = { ...bots[0]!, id: 'approval', name: 'Gate', title: 'approver', kind: 'approval', persona: 'A person.' };
  const row = (b: { id: string; name: string; title: string; kind: string }) => ({ role: b.id, name: b.name, title: b.title, kind: b.kind, binding: null });
  /** Bolt (built-in), Quill (your own agent bot), and with `gate` also Gate and Go Reviewer (a verdict bot from ECC). */
  const withQuill = (o: { coderEdited?: boolean; gate?: boolean; refuse?: Error } = {}) => {
    const coder = { ...bots[0]!, ...(o.coderEdited ? { edited: true } : {}) };
    const all = [coder, ...(o.gate ? [gate] : []), quill, ...(o.gate ? [goBot] : [])];
    routeApi({
      ...routes,
      'GET /api/crew': { ...crewReply, bots: all, ...(o.gate ? { ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } } : {}) },
      'GET /api/bots': { ...botsReply, crew: all.map(row) },
      'PUT /api/crew/coder': o.refuse ?? {},
      'DELETE /api/crew/coder': {},
    });
  };
  const slotOf = (name: string) => screen.getByRole('button', { name: `Edit ${name}` }).closest('.cw-slot')!;
  const dropQuillOnBolt = async () => {
    fireEvent.dragStart(await screen.findByRole('button', { name: /Edit Quill/ }));
    fireEvent.dragOver(slotOf('Bolt'));
    await act(async () => fireEvent.drop(slotOf('Bolt')));
  };

  it('links a bench bot to a same-kind role by drag and drop; Undo deletes the fresh override', async () => {
    withQuill();
    renderApp(<Crew />);
    fireEvent.dragStart(await screen.findByRole('button', { name: /Edit Quill/ }));
    fireEvent.dragOver(slotOf('Bolt'));
    expect(slotOf('Bolt').classList.contains('over')).toBe(true);
    await act(async () => fireEvent.drop(slotOf('Bolt')));
    expect(calls('PUT', '/api/crew/coder')[0]![2]).toEqual({ id: 'coder', name: 'Quill', title: 'coder', kind: 'agent', persona: 'Writes poems', look });
    expect(screen.getByText('Quill now plays coder. Applies to the next run.')).toBeTruthy();
    expect(slotOf('Bolt').classList.contains('over')).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(calls('DELETE', '/api/crew/coder')).toHaveLength(1);
    expect(screen.queryByText('Quill now plays coder. Applies to the next run.')).toBeNull();
  });

  it('Undo puts back an earlier override', async () => {
    withQuill({ coderEdited: true });
    renderApp(<Crew />);
    await dropQuillOnBolt();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(calls('PUT', '/api/crew/coder')[1]![2]).toMatchObject({ id: 'coder', name: 'Bolt', persona: 'Writes the change' });
    expect(calls('DELETE', '/api/crew/coder')).toHaveLength(0);
  });

  it('dims other kinds and Gate while dragging and refuses their drop', async () => {
    withQuill({ gate: true });
    renderApp(<Crew />);
    fireEvent.dragStart(await screen.findByRole('button', { name: /Edit Go Reviewer/ }));
    expect(slotOf('Bolt').classList.contains('dim')).toBe(true);
    expect(slotOf('Gate').classList.contains('dim')).toBe(true);
    fireEvent.dragOver(slotOf('Bolt'));
    expect(slotOf('Bolt').classList.contains('over')).toBe(false);
    await act(async () => fireEvent.drop(slotOf('Bolt')));
    expect(calls('PUT', '/api/crew/coder')).toHaveLength(0);
    fireEvent.dragEnd(screen.getByRole('button', { name: /Edit Go Reviewer/ }));
    expect(slotOf('Bolt').classList.contains('dim')).toBe(false);
  });

  it('Swap… picks a same-kind bot from the keyboard; Gate has no Swap', async () => {
    withQuill({ gate: true });
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: 'Swap Bolt…' }));
    expect(screen.queryByRole('button', { name: 'Swap Gate…' })).toBeNull();
    const dlg = await screen.findByRole('dialog', { name: 'Swap Bolt' });
    expect(within(dlg).queryByText('Go Reviewer')).toBeNull();
    await act(async () => fireEvent.click(within(dlg).getByRole('button', { name: /Quill/ })));
    expect(calls('PUT', '/api/crew/coder')[0]![2]).toMatchObject({ name: 'Quill', kind: 'agent' });
    expect(await screen.findByText('Quill now plays coder. Applies to the next run.')).toBeTruthy();
  });

  it("asks before a drop replaces the open bot's unsaved edits", async () => {
    withQuill();
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Bolt' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'changed' } });
    await dropQuillOnBolt();
    expect(calls('PUT', '/api/crew/coder')).toHaveLength(0);
    expect(await screen.findByText('Discard your changes to Bolt?')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Discard' })));
    expect(calls('PUT', '/api/crew/coder')).toHaveLength(1);
  });

  it('a refused drop shows the error and no note', async () => {
    withQuill({ refuse: new Error('too many bots; remove some first') });
    renderApp(<Crew />);
    await dropQuillOnBolt();
    expect(await screen.findByText('too many bots; remove some first')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('crew sources and faces', () => {
  it('filters the library by source and shows when-to-use', async () => {
    const quill = { ...bots[0]!, id: 'quill', name: 'Quill', builtin: false };
    routeApi({ ...routes, 'GET /api/crew': { ...crewReply, bots: [...crewReply.bots, quill, goBot], ecc: { ref: 'v2.2.3', at: '2026-10-24T00:00:00Z' } }, 'GET /api/bots': { ...botsReply, crew: [...botsReply.crew, { role: 'quill', name: 'Quill', title: 'coder', kind: 'agent', binding: null }, { role: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', binding: null }] } });
    renderApp(<Crew />);
    expect(await screen.findByText('Use for Go')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Built-in/ })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Yours/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Yours/ }));
    expect(screen.queryByRole('button', { name: /Edit Go Reviewer/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Edit Quill/ })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /ECC/ }));
    fireEvent.click(screen.getByRole('tab', { name: /ECC/ }));
    expect(screen.getByRole('button', { name: /Edit Go Reviewer/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit Quill/ })).toBeNull();
  });

  it('imports ECC after confirming in a dialog', async () => {
    renderApp(<Crew />);
    await moreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import ECC…' }));
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
    expect(screen.queryAllByText(/ECC/)).toHaveLength(0);
    await moreMenu();
    expect(screen.queryByRole('menuitem', { name: 'Remove ECC…' })).toBeNull();
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
      const persona = (await screen.findByLabelText(/Persona \(/)) as HTMLTextAreaElement;
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
      const persona = screen.getByLabelText(/Persona \(/) as HTMLTextAreaElement;
      expect(persona.readOnly).toBe(true);
      fireEvent.change(persona, { target: { value: 'lost edit' } });
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'gopher' } });
      await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
      expect(calls('PUT', '/api/crew/go-reviewer')[0]![2]).toMatchObject({ title: 'gopher', personaTruncated: true, persona: 'You review Go…' });
    });

    it('shows an ECC badge, offers update and removes ECC after confirming', async () => {
      renderApp(<Crew />);
      await moreMenu();
      expect(screen.getByRole('menuitem', { name: 'Update ECC…' })).toBeTruthy();
      expect(screen.getAllByText('ECC').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ECC…' }));
      await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Remove' })));
      expect(calls('DELETE', '/api/crew?source=ecc')).toHaveLength(1);
    });

    it('shows the version change in the update dialog', async () => {
      renderApp(<Crew />);
      await moreMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Update ECC…' }));
      expect(await screen.findByText('Version v2.2.3 → v2.2.3')).toBeTruthy();
    });
  });
});
