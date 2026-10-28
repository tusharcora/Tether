import { EditorView } from '@codemirror/view';
import { readFileSync } from 'node:fs';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, ApiError } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { cssRule } from '../test/css';
import { renderApp } from '../test/render';
import { Code, type CodeProps } from './Code';

const shop = { id: 'shop', name: 'shop', path: '/code/shop', isDefault: true, exists: true, repos: [] };
const A = 'const MAX = 1;\nexport function limit() {}\nlet c = 3;\n';
const file = (o: Record<string, unknown> = {}) => ({ path: 'src/a.ts', text: A, size: A.length, mtimeMs: 100, lang: 'typescript', ...o });
const runs = [
  { runId: 'r-2', title: 'Tune the window', label: 'Team run', status: 'running', live: true, at: Date.now(), add: 1, del: 1, hunks: [{ start: 3, lines: 1 }], patch: '@@ -3 +3 @@\n-let c = 2;\n+let c = 3;' },
  { runId: 'r-1', title: 'Add rate limiting', label: 'ship', status: 'done', live: false, at: Date.now(), add: 2, del: 0, hunks: [{ start: 1, lines: 2 }], patch: '@@ -0,0 +1,2 @@\n+const MAX = 1;' },
];
let routes: Record<string, unknown>;
beforeEach(() => {
  vi.mocked(api).mockReset();
  routes = {
    'GET /api/code/tree?ws=shop&dir=': { entries: [{ name: 'src', path: 'src', kind: 'dir' }, { name: '.env', path: '.env', kind: 'file' }, { name: 'README.md', path: 'README.md', kind: 'file', git: '?' }], git: true, files: 4 },
    'GET /api/code/tree?ws=shop&dir=src': { entries: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file', git: 'M' }, { name: 'b.ts', path: 'src/b.ts', kind: 'file' }], git: true },
    'GET /api/code/changed?ws=shop': { paths: ['src/a.ts'] },
    'GET /api/code/file?ws=shop&path=src%2Fa.ts': file(),
    'GET /api/code/file?ws=shop&path=src%2Fb.ts': file({ path: 'src/b.ts', text: 'b\n' }),
    'GET /api/code/file?ws=shop&path=.env': file({ path: '.env', text: 'K=1\n', lang: 'text', secret: true, readOnly: true }),
    'GET /api/code/runs-for-file?ws=shop&path=src%2Fa.ts': runs,
    'GET /api/code/runs-for-file?ws=shop&path=src%2Fb.ts': [],
    'GET /api/code/runs-for-file?ws=shop&path=.env': [],
    'PUT /api/code/file': (b: { text: string }) => ({ path: 'src/a.ts', mtimeMs: 200, size: b.text.length }),
    'GET /api/code/search?ws=shop&q=limit&mode=text': { hits: [{ path: 'src/a.ts', line: 2, col: 16, text: 'export function limit() {}' }], truncated: false },
  };
  routeApi(routes);
});

// through a variable so Vite leaves the URL alone (as test/css.ts does)
const here = import.meta.url;
const setup = (o: Partial<CodeProps> = {}) => {
  const p = { project: shop, onPath: vi.fn(), onOpenRun: vi.fn(), onDirtyChange: vi.fn(), ...o };
  const r = renderApp(<Code {...p} />);
  return { ...p, ...r };
};
const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const editorText = () => view().state.doc.toString();
const type = (text: string) => act(() => view().dispatch({ changes: { from: 0, insert: text } }));
const openA = async () => {
  setup({ path: 'src/a.ts' });
  await waitFor(() => expect(editorText()).toBe(A));
};

describe('Code screen', () => {
  it('says where it is: the project, its file count and the files runs changed', async () => {
    setup();
    expect(await screen.findByText('4 files · 1 changed by runs')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Code' })).toBeTruthy();
    expect(screen.getByText('shop').getAttribute('title')).toBe('/code/shop');
    expect(screen.getByText('changed by a run in 30 days')).toBeTruthy();
    expect(screen.getByText('Pick a file')).toBeTruthy();
  });

  it('opens folders lazily, moves with the keyboard and opens a file with Enter', async () => {
    const p = setup();
    const tree = await screen.findByRole('tree', { name: 'Files' });
    const src = within(tree).getByRole('treeitem', { name: /src/ });
    expect(src.getAttribute('aria-expanded')).toBe('false');
    src.focus();
    fireEvent.keyDown(src, { key: 'ArrowRight' });
    const a = await within(tree).findByRole('treeitem', { name: /a\.ts/ });
    expect(src.getAttribute('aria-expanded')).toBe('true');
    expect(a.textContent).toContain('modified');
    expect(a.querySelector('.code-run-dot')).toBeTruthy();
    fireEvent.keyDown(src, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: 'Enter' });
    expect(p.onPath).toHaveBeenCalledWith('src/a.ts', undefined);
    await waitFor(() => expect(editorText()).toBe(A));
    expect(a.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'a.ts' }).getAttribute('aria-selected')).toBe('true');
  });

  it('draws the tree with beui: branch lines and a sliding highlight', async () => {
    setup();
    const tree = await screen.findByRole('tree', { name: 'Files' });
    expect(tree.querySelectorAll('button[role="treeitem"]').length).toBeGreaterThan(0);
    // beui assumes Tailwind's preflight; without it the rows would take the app's default button box
    expect(cssRule('code/code.css', '.code-tree-list [role="treeitem"]')).toContain('border: 0');
    expect(cssRule('code/code.css', '.code-tree-list [role="treeitem"]:not([aria-selected="true"])')).toContain('background-color: transparent');
  });

  it('draws a guide line for every level, git badges as tinted letters and the run dot in blue', async () => {
    routeApi({
      ...routes,
      'GET /api/code/tree?ws=shop&dir=src': { entries: [{ name: 'http', path: 'src/http', kind: 'dir' }, { name: 'a.ts', path: 'src/a.ts', kind: 'file', git: 'M' }], git: true },
      'GET /api/code/tree?ws=shop&dir=src%2Fhttp': { entries: [{ name: 'c.ts', path: 'src/http/c.ts', kind: 'file' }], git: true },
      'GET /api/code/file?ws=shop&path=src%2Fhttp%2Fc.ts': file({ path: 'src/http/c.ts' }),
      'GET /api/code/runs-for-file?ws=shop&path=src%2Fhttp%2Fc.ts': [],
    });
    setup({ path: 'src/http/c.ts' });
    const tree = await screen.findByRole('tree', { name: 'Files' });
    const guides = (el: HTMLElement) => el.querySelectorAll(':scope > span.w-px').length;
    expect(guides(await within(tree).findByRole('treeitem', { name: /c\.ts/ }))).toBe(2);
    expect(guides(within(tree).getByRole('treeitem', { name: /a\.ts/ }))).toBe(1);
    expect(guides(within(tree).getByRole('treeitem', { name: /^src/ }))).toBe(0);
    expect(cssRule('code/code.css', '.code-git.g-mod')).toContain('background: var(--warnBg)');
    expect(cssRule('code/code.css', '.code-git.g-add')).toContain('background: var(--okBg)');
    expect(() => cssRule('code/code.css', '.code-git.g-del')).toThrow();
    expect(cssRule('code/code.css', '.code-run-dot')).toContain('background: var(--acc)');
  });

  it('keeps the vendored MIT notice', () => {
    expect(readFileSync(new URL('../components/beui/motion/file-tree.tsx', here), 'utf8')).toMatch(/MIT License, Copyright \(c\) 2026 Saurabh Chauhan/);
    expect(readFileSync(new URL('../components/beui/motion/shared-layout-bg.tsx', here), 'utf8')).toMatch(/MIT License, Copyright \(c\) 2026/);
  });

  it('opens read-only; Edit makes it editable, the tab shows unsaved work and Save writes it with the base mtime', async () => {
    await openA();
    expect(view().state.readOnly).toBe(true);
    const save = screen.getByRole('button', { name: /Save/ });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(view().state.readOnly).toBe(false);
    type('// note\n');
    expect(screen.getByRole('tab', { name: /a\.ts/ }).textContent).toContain('unsaved');
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls('PUT', '/api/code/file')).toHaveLength(1));
    expect(calls('PUT', '/api/code/file')[0]![2]).toEqual({ ws: 'shop', path: 'src/a.ts', text: `// note\n${A}`, baseMtimeMs: 100 });
    expect(await screen.findByText('Saved a.ts')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /a\.ts/ }).textContent).not.toContain('unsaved');
  });

  it('lays out the card: tabs with icons, the path as crumbs, and a status bar', async () => {
    await openA();
    const card = screen.getByRole('region', { name: 'Editor' });
    expect(screen.getByRole('tab', { name: 'a.ts' }).querySelector('svg')).toBeTruthy();
    expect([...card.querySelectorAll('.code-path .code-crumb')].map((c) => c.textContent)).toEqual(['src', 'a.ts']);
    const status = () => card.querySelector('.code-status')!.textContent!;
    for (const s of ['saved', 'Ln 1, Col 1', '3 lines', 'TypeScript', 'UTF-8']) expect(status()).toContain(s);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    type('x');
    expect(status()).toContain('unsaved');
  });

  it('keeps Edit and Save visible with many tabs: the tabs scroll inside the header, a long path ellipsizes', () => {
    const rule = (sel: string) => cssRule('code/code.css', sel);
    expect(rule('.code-tablist')).toContain('overflow-x: auto');
    expect(rule('.code-tab-actions')).toContain('flex: none');
    for (const p of ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis']) expect(rule('.code-crumbs')).toContain(p);
    // × shows on hover, on the open tab, and whenever the keyboard is in the tab
    expect(rule('.code-tab:hover .code-tab-close, .code-tab.on .code-tab-close, .code-tab:focus-within .code-tab-close')).toContain('opacity: 1');
  });

  it('closing the runs panel or switching files clears the picked run', async () => {
    setup({ path: 'src/a.ts' });
    await waitFor(() => expect(editorText()).toBe(A));
    const chip = await screen.findByRole('button', { name: '2 runs touched it' });
    const pick = async () => {
      fireEvent.click(chip);
      fireEvent.click(await screen.findByRole('button', { name: /Tune the window/ }));
      await waitFor(() => expect(document.querySelectorAll('.cm-run-line')).toHaveLength(1));
    };
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Close Runs on this file' }));
    expect(document.querySelectorAll('.cm-run-line')).toHaveLength(0);
    await pick();
    // the panel follows the open file
    fireEvent.click(within(screen.getByRole('tree')).getByRole('treeitem', { name: /b\.ts/ }));
    await waitFor(() => expect(editorText()).toBe('b\n'));
    const dock = screen.getByRole('complementary', { name: 'Runs on this file' });
    expect(within(dock).getByText('b.ts')).toBeTruthy();
    expect(await within(dock).findByText('No run has changed this file yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'a.ts' }));
    await waitFor(() => expect(editorText()).toBe(A));
    expect(document.querySelectorAll('.cm-run-line')).toHaveLength(0);
  });

  it('saves with ⌘S and reports unsaved work to the shell', async () => {
    const p = setup({ path: 'src/a.ts' });
    await waitFor(() => expect(editorText()).toBe(A));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    type('x');
    expect(p.onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(p.onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(calls('PUT', '/api/code/file')).toHaveLength(1);
  });

  it('asks on a changed-on-disk conflict: Overwrite resends without the base check, Reload drops the edits', async () => {
    routeApi({ ...routes, 'PUT /api/code/file': (b: { baseMtimeMs?: number; text: string }) => (b.baseMtimeMs ? new ApiError('changed-on-disk', 409) : { path: 'src/a.ts', mtimeMs: 300, size: b.text.length }) });
    await openA();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    type('mine ');
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    const dialog = await screen.findByRole('dialog', { name: 'a.ts changed on disk' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(calls('PUT', '/api/code/file')).toHaveLength(2));
    expect(calls('PUT', '/api/code/file')[1]![2]).not.toHaveProperty('baseMtimeMs');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    type('again ');
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(editorText()).toBe(A));
    expect(calls('GET', '/api/code/file?ws=shop&path=src%2Fa.ts').length).toBeGreaterThanOrEqual(2);
  });

  it('pauses saving while a run writes in this folder, with a way to the run', async () => {
    const lock = { runId: 'r-9', node: 'code', bot: 'Bolt' };
    routeApi({ ...routes, 'GET /api/code/file?ws=shop&path=src%2Fa.ts': file({ lock }) });
    const p = setup({ path: 'src/a.ts' });
    const banner = (await screen.findByText(/Bolt is editing/)).closest<HTMLElement>('[role="status"]')!;
    expect(banner.textContent).toMatch(/Bolt is editing files in this folder in run r-9\. Saving is paused/);
    expect(within(banner).getByRole('img', { name: 'Bolt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    type('x');
    expect(screen.getByRole('button', { name: /Save/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(banner).getByRole('button', { name: 'Open run' }));
    expect(p.onOpenRun).toHaveBeenCalledWith('r-9');
  });

  it('lists the runs that changed the file; picking one marks its lines and shows its diff', async () => {
    const p = setup({ path: 'src/a.ts' });
    fireEvent.click(await screen.findByRole('button', { name: '2 runs touched it' }));
    const lens = screen.getByRole('complementary', { name: 'Runs on this file' });
    expect(within(lens).getByText('a.ts')).toBeTruthy();
    const tune = await within(lens).findByRole('button', { name: /Tune the window/ });
    expect(tune.textContent).toContain('+1');
    expect(tune.textContent).toContain('running');
    await waitFor(() => expect(editorText()).toBe(A));
    fireEvent.click(tune);
    expect(tune.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect([...document.querySelectorAll('.cm-run-line')].map((l) => l.textContent)).toEqual(['let c = 3;']));
    expect(within(lens).getByRole('button', { name: /changes/ })).toBeTruthy();
    expect(lens.textContent).toContain('let c = 3;');
    fireEvent.click(within(lens).getByRole('button', { name: 'Open run' }));
    expect(p.onOpenRun).toHaveBeenCalledWith('r-2');
    fireEvent.click(tune);
    expect(document.querySelectorAll('.cm-run-line')).toHaveLength(0);
  });

  it('marks every run’s lines in the gutter without a pick: blue while live, green when done', async () => {
    await openA();
    const gutter = (cls: string) => [...document.querySelectorAll(`.cm-gutterElement.${cls}`)].map((e) => e.textContent);
    await waitFor(() => expect(gutter('cm-run-live')).toEqual(['3']));
    expect(gutter('cm-run-done')).toEqual(['1', '2']);
    expect(document.querySelectorAll('.cm-run-line')).toHaveLength(0);
  });

  it('searches in the tree’s place and opens a hit at its line with a highlight', async () => {
    const p = setup();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search code' }), { target: { value: 'limit' } });
    const hit = await screen.findByRole('button', { name: /src\/a\.ts:2/ });
    expect(screen.queryByRole('tree')).toBeNull();
    expect(hit.querySelector('mark')!.textContent).toBe('limit');
    expect(screen.getByText(/1 match · secrets files skipped/)).toBeTruthy();
    fireEvent.click(hit);
    expect(p.onPath).toHaveBeenCalledWith('src/a.ts', 2);
    await waitFor(() => expect(document.querySelector('.cm-flash')?.textContent).toBe('export function limit() {}'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search code' }), { key: 'Escape' });
    expect(await screen.findByRole('tree')).toBeTruthy();
  });

  it('focuses search with ⌘⇧F', async () => {
    setup();
    await screen.findByRole('tree');
    fireEvent.keyDown(window, { key: 'f', metaKey: true, shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search code' }));
  });

  it('opens a deep link at its line', async () => {
    setup({ path: 'src/a.ts', line: 3 });
    await waitFor(() => expect(document.querySelector('.cm-flash')?.textContent).toBe('let c = 3;'));
  });

  it('opens secrets read-only with a banner', async () => {
    setup({ path: '.env' });
    expect(await screen.findByText(/Secrets file: read-only here/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read-only' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(editorText()).toBe('K=1\n'));
    expect(document.querySelector('.code-status')!.textContent).toContain('read-only');
  });

  it('shows a file over 2 MB as a panel instead of the editor', async () => {
    routeApi({ ...routes, 'GET /api/code/file?ws=shop&path=src%2Fb.ts': file({ path: 'src/b.ts', text: '', size: 3_000_000, tooLarge: true }) });
    setup({ path: 'src/b.ts' });
    expect(await screen.findByText('Too large to open here')).toBeTruthy();
    expect(document.querySelector('.cm-editor')).toBeNull();
  });

  it('asks before closing a tab with unsaved edits', async () => {
    await openA();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    type('x');
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('tab', { name: /a\.ts/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Pick a file')).toBeTruthy();
  });

  it('says when the folder is empty, and when it is not a git repo hides badges, filter, legend and the runs chip', async () => {
    routeApi({ ...routes, 'GET /api/code/tree?ws=shop&dir=': { entries: [], git: false } });
    setup({ path: 'src/a.ts' });
    expect(await screen.findByText('This folder is empty.')).toBeTruthy();
    expect(screen.getByText(/Not a git repository/)).toBeTruthy();
    await waitFor(() => expect(editorText()).toBe(A));
    expect(screen.queryByRole('button', { name: /touched it/ })).toBeNull();
    expect(screen.queryByText('changed by a run in 30 days')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Changed by runs' })).toBeNull();
  });

  it('shows the files runs changed as their own tree', async () => {
    setup();
    await screen.findByRole('tree');
    fireEvent.click(screen.getByRole('button', { name: 'Changed by runs' }));
    const tree = screen.getByRole('tree');
    expect(within(tree).getAllByRole('treeitem').map((t) => t.querySelector('.code-row-name')!.textContent)).toEqual(['src', 'a.ts']);
  });

  it('is bounded to the screen: the tree dock and the editor card each scroll inside themselves', async () => {
    const rule = (sel: string) => cssRule('code/code.css', sel);
    // the tree dock and the editor card float on the frame: clipped flex columns with one scroller each
    for (const sel of ['.code-tree', '.code-main']) for (const p of ['position: absolute', 'min-height: 0', 'overflow: hidden']) expect(rule(sel), sel).toContain(p);
    // the runs dock takes the right edge, so the card stops short of it
    expect(rule('.code.docked .code-main')).toContain('right: 352px');
    for (const p of ['flex: 1', 'min-height: 0', 'overflow: auto']) expect(rule('.code-pane')).toContain(p);
    for (const p of ['flex: 1', 'min-height: 0', 'overflow: hidden']) expect(rule('.code-editor-wrap')).toContain(p);
    for (const p of ['position: absolute', 'inset: 0']) expect(rule('.code-editor')).toContain(p);
    // the scrollers' contents never scroll on their own (a second scroller would grow the column instead)
    expect(rule('.code-tree-list')).not.toContain('overflow');
    expect(rule('.code-hits')).not.toContain('overflow');
    // and the tree really sits in the pane, loading wrapper and all
    setup();
    expect((await screen.findByRole('tree')).closest('.code-tree > .code-pane')).toBeTruthy();
  });

  it('gives the tree its own error with Retry', async () => {
    routeApi({ ...routes, 'GET /api/code/tree?ws=shop&dir=': new Error('the folder of "shop" is gone') });
    setup();
    expect(await screen.findByText('the folder of "shop" is gone')).toBeTruthy();
    routeApi(routes);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('tree')).toBeTruthy();
  });
});
