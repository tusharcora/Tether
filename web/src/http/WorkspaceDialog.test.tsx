import { readFileSync } from 'node:fs';
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { WorkspaceDialog } from './WorkspaceDialog';

const bundle = { v: 1, workspace: { name: 'API' }, notes: '', http: { files: { 'runs/list.req.json': {} } } };
const plan = { dir: '/code/new', create: ['.aorch/http/runs/list.req.json'], overwrite: ['.aorch/workspace.json'], secrets: ['tok'], overwriteSecrets: [] as string[] };
const pick = async (text: string) => {
  const file = new File([text], 'api.aorch.json', { type: 'application/json' });
  await act(async () => fireEvent.change(screen.getByLabelText('Export file'), { target: { files: [file] } }));
};
const into = (v: string) => fireEvent.change(screen.getByLabelText('Into folder (absolute path)'), { target: { value: v } });
beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'POST /api/workspaces/import': (b: { confirm?: boolean }) => (b.confirm ? { workspace: 'api', written: ['.aorch/http/runs/list.req.json'] } : plan),
  });
});

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;

describe('WorkspaceDialog', () => {
  it('reads a bundle file, previews creates and overwrites, then imports', async () => {
    const onImported = vi.fn();
    renderApp(<WorkspaceDialog open onOpenChange={() => {}} onImported={onImported} />);
    expect(screen.getByRole('dialog').classList.contains('api-dialog')).toBe(true);
    await pick(JSON.stringify(bundle));
    into('/code/new');
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull(); // nothing to confirm before a preview
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(calls('POST', '/api/workspaces/import')[0]![2]).toEqual({ bundle, into: '/code/new' });
    expect(screen.getByText('.aorch/http/runs/list.req.json')).toBeTruthy();
    expect(screen.getByText('.aorch/workspace.json')).toBeTruthy();
    expect(screen.getByText(/1 secret: tok/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import and overwrite 1 file' })));
    expect(calls('POST', '/api/workspaces/import')[1]![2]).toEqual({ bundle, into: '/code/new', confirm: true });
    expect(onImported).toHaveBeenCalledWith('api');
  });

  it('offers a plain Import when nothing is overwritten', async () => {
    routeApi({ 'POST /api/workspaces/import': (b: { confirm?: boolean }) => (b.confirm ? { workspace: 'api', written: [] } : { ...plan, overwrite: [], secrets: [], overwriteSecrets: [] }) });
    renderApp(<WorkspaceDialog open onOpenChange={() => {}} onImported={() => {}} />);
    await pick(JSON.stringify(bundle));
    into('/code/new');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it('a secret the target workspace already holds counts as an overwrite and needs the danger confirm', async () => {
    const onImported = vi.fn();
    routeApi({ 'POST /api/workspaces/import': (b: { confirm?: boolean }) => (b.confirm ? { workspace: 'api', written: [] } : { ...plan, overwrite: [], overwriteSecrets: ['tok'] }) });
    renderApp(<WorkspaceDialog open onOpenChange={() => {}} onImported={onImported} />);
    await pick(JSON.stringify(bundle));
    into('/code/new');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByText('Will overwrite')).toBeTruthy();
    expect(screen.getByText('secret tok')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull(); // no plain Import while a value would be replaced
    const go = screen.getByRole('button', { name: 'Import and overwrite 1 secret' });
    await act(async () => fireEvent.click(go));
    expect(calls('POST', '/api/workspaces/import')[1]![2]).toEqual({ bundle, into: '/code/new', confirm: true });
    expect(onImported).toHaveBeenCalledWith('api');
  });

  it('names both when files and secrets are replaced', async () => {
    routeApi({ 'POST /api/workspaces/import': { ...plan, overwriteSecrets: ['tok'] } });
    renderApp(<WorkspaceDialog open onOpenChange={() => {}} onImported={() => {}} />);
    await pick(JSON.stringify(bundle));
    into('/code/new');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByRole('button', { name: 'Import and overwrite 1 file and 1 secret' })).toBeTruthy();
  });

  it('a new folder or file drops the old preview, so a stale plan is never confirmed', async () => {
    renderApp(<WorkspaceDialog open onOpenChange={() => {}} onImported={() => {}} />);
    await pick(JSON.stringify(bundle));
    into('/code/new');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByRole('button', { name: 'Import and overwrite 1 file' })).toBeTruthy();
    into('/code/other');
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
  });

  it('shows a file that is not JSON, and the server refusing the export, without writing', async () => {
    routeApi({ 'POST /api/workspaces/import': new Error('refusing a file path in the export: ../evil.json') });
    renderApp(<WorkspaceDialog open onOpenChange={() => {}} onImported={() => {}} />);
    await pick('{ nope');
    expect(screen.getByRole('alert').textContent).toBe('that file is not JSON');
    into('/code/new');
    const pv = screen.getByRole('button', { name: 'Preview' });
    expect(pv.hasAttribute('disabled') || pv.getAttribute('aria-disabled') === 'true').toBe(true);
    await pick(JSON.stringify(bundle));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByRole('alert').textContent).toMatch(/refusing a file path/);
    expect(calls('POST', '/api/workspaces/import').filter((c) => (c[2] as { confirm?: boolean }).confirm)).toHaveLength(0);
  });

  it('styles the import preview from tokens only, with no purple, gradients or glows', () => {
    const css = readFileSync(new URL('./api.css', here), 'utf8');
    const at = css.indexOf('.import-preview');
    const rule = css.slice(at, css.indexOf('\n', at));
    expect(rule).toContain('var(--');
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|purple|violet|gradient\(|box-shadow/i);
  });
});
