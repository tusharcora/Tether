import { readFileSync } from 'node:fs';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { EnvDialog } from './EnvDialog';
import { ImportDialog } from './ImportDialog';
import { SecretsDialog } from './SecretsDialog';

const preview = { create: [{ id: 'shop/post-orders', file: { v: 1, name: 'POST /orders', method: 'POST', url: 'http://h/orders', query: [], headers: [], body: { kind: 'none' }, vars: {}, checks: [] } }], collections: [], skip: [{ name: 'Upload', reason: 'form-data bodies (file upload) are not supported' }], warnings: ['"x": store it with: aorch http secret set authorization'] };
let keys: string[] = [];

beforeEach(() => {
  vi.mocked(api).mockReset();
  keys = ['aorch_token'];
  routeApi({
    'POST /api/http/import': (b: { text: string }) => (b.text === 'bad' ? { create: [], collections: [], skip: [], warnings: [], error: 'not a curl command (it must start with "curl")' } : preview),
    'POST /api/http/import/apply': { created: ['shop/post-orders'] },
    'GET /api/http/secrets': () => ({ keys }),
    'PUT /api/http/secrets/new_key': () => ((keys = [...keys, 'new_key']), { keys }),
    'PUT /api/http/secrets/aorch_token': () => ({ keys }),
    'DELETE /api/http/secrets/aorch_token': () => ((keys = keys.filter((k) => k !== 'aorch_token')), { keys }),
    'GET /api/http/environments/local': { name: 'local', v: 1, vars: { base: 'http://127.0.0.1:4177', tok: { secret: 'aorch_token' } } },
    'PUT /api/http/environments/local': (b: unknown) => ({ name: 'local', ...(b as object) }),
    'PUT /api/http/environments/stage': (b: unknown) => ({ name: 'stage', ...(b as object) }),
    'DELETE /api/http/environments/local': { deleted: 'local' },
  });
});

describe('ImportDialog', () => {
  it('previews what would be created and skipped, then applies', async () => {
    const onImported = vi.fn();
    renderApp(<ImportDialog open onOpenChange={() => {}} onImported={onImported} />);
    fireEvent.click(screen.getByRole('button', { name: 'cURL' }));
    fireEvent.change(screen.getByLabelText(/Paste/), { target: { value: "curl -X POST 'http://h/orders'" } });
    fireEvent.change(screen.getByLabelText('Into collection (optional)'), { target: { value: 'shop' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(calls('POST', '/api/http/import')[0]![2]).toEqual({ kind: 'curl', text: "curl -X POST 'http://h/orders'", into: 'shop' });
    expect(screen.getByText('shop/post-orders')).toBeTruthy();
    expect(screen.getByText('Upload')).toBeTruthy();
    expect(screen.getByText('form-data bodies (file upload) are not supported')).toBeTruthy();
    expect(screen.getByText(/aorch http secret set authorization/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import 1 request' })));
    expect(calls('POST', '/api/http/import/apply')[0]![2]).toEqual({ kind: 'curl', text: "curl -X POST 'http://h/orders'", into: 'shop', confirm: true });
    expect(onImported).toHaveBeenCalledWith(['shop/post-orders']);
  });

  it('shows a parse error and offers nothing to import', async () => {
    renderApp(<ImportDialog open onOpenChange={() => {}} onImported={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Paste/), { target: { value: 'bad' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByRole('alert').textContent).toMatch(/not a curl command/);
    expect(screen.queryByRole('button', { name: /^Import \d/ })).toBeNull();
  });
});

describe('SecretsDialog', () => {
  it('lists keys and adds a secret without ever showing its value', async () => {
    renderApp(<SecretsDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText('aorch_token')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'new_key' } });
    const value = screen.getByLabelText('Value') as HTMLInputElement;
    expect(value.type).toBe('password');
    expect(value.autocomplete).toBe('off');
    fireEvent.change(value, { target: { value: 'TOP-SECRET-1' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save secret' })));
    expect(calls('PUT', '/api/http/secrets/new_key')[0]![2]).toEqual({ value: 'TOP-SECRET-1' });
    expect(await screen.findByText('new_key')).toBeTruthy();
    expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain('TOP-SECRET-1');
  });

  it('replaces and deletes', async () => {
    renderApp(<SecretsDialog open onOpenChange={() => {}} />);
    await screen.findByText('aorch_token');
    fireEvent.click(screen.getByRole('button', { name: 'Replace aorch_token' }));
    fireEvent.change(screen.getByLabelText('New value for aorch_token'), { target: { value: 'rotated' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save new value' })));
    expect(calls('PUT', '/api/http/secrets/aorch_token')[0]![2]).toEqual({ value: 'rotated' });
    expect(document.body.innerHTML).not.toContain('rotated');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    await waitFor(() => expect(screen.queryByText('aorch_token')).toBeNull());
  });
});

describe('EnvDialog', () => {
  it('edits values and secret refs and saves the environment', async () => {
    const onSaved = vi.fn();
    renderApp(<EnvDialog open onOpenChange={() => {}} name="local" onSaved={onSaved} />);
    expect(await screen.findByDisplayValue('http://127.0.0.1:4177')).toBeTruthy();
    expect((screen.getByLabelText('Secret for tok') as HTMLSelectElement).value).toBe('aorch_token');
    fireEvent.change(screen.getByDisplayValue('http://127.0.0.1:4177'), { target: { value: 'http://localhost:4177' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByLabelText('Variable name 3'), { target: { value: 'limit' } });
    fireEvent.change(screen.getByLabelText('Value for limit'), { target: { value: '20' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save environment' })));
    expect(calls('PUT', '/api/http/environments/local')[0]![2]).toEqual({ v: 1, vars: { base: 'http://localhost:4177', tok: { secret: 'aorch_token' }, limit: '20' } });
    expect(onSaved).toHaveBeenCalledWith('local');
  });

  it('creates a new environment with a secret ref', async () => {
    const onSaved = vi.fn();
    renderApp(<EnvDialog open onOpenChange={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Environment name'), { target: { value: 'stage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByLabelText('Variable name 1'), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'tok is a secret' }));
    await screen.findByRole('option', { name: 'aorch_token' });
    fireEvent.change(screen.getByLabelText('Secret for tok'), { target: { value: 'aorch_token' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save environment' })));
    expect(calls('PUT', '/api/http/environments/stage')[0]![2]).toEqual({ v: 1, vars: { tok: { secret: 'aorch_token' } } });
  });
});

describe('dialog errors are shown, never swallowed', () => {
  it('import: a failed preview call shows its message, and an id that already exists is listed as skipped', async () => {
    routeApi({ 'POST /api/http/import': new Error('server down') });
    renderApp(<ImportDialog open onOpenChange={() => {}} onImported={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Paste/), { target: { value: 'curl http://h' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByRole('alert').textContent).toBe('server down');
    expect(calls('POST', '/api/http/import/apply')).toHaveLength(0);

    routeApi({ 'POST /api/http/import': { ...preview, create: [], skip: [{ name: 'shop/post-orders', reason: 'exists' }], warnings: [] } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    expect(screen.getByText('shop/post-orders')).toBeTruthy();
    expect(screen.getByText('already exists, not overwritten')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Import \d/ })).toBeNull();
  });

  it('import: a failed apply keeps the preview and reports the error', async () => {
    renderApp(<ImportDialog open onOpenChange={() => {}} onImported={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Paste/), { target: { value: 'curl http://h/orders' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
    routeApi({ 'POST /api/http/import/apply': new Error('disk full') });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import 1 request' })));
    expect(await screen.findByText('disk full')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import 1 request' })).toBeTruthy();
  });

  it('secrets: a failed key list shows the error instead of an empty list', async () => {
    routeApi({ 'GET /api/http/secrets': new Error('secrets.json is too open: run chmod 600') });
    renderApp(<SecretsDialog open onOpenChange={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/chmod 600/);
    expect(screen.queryByText('No secrets yet.')).toBeNull();
  });

  it('secrets: a typed value never reaches the DOM — while typing, after a failed save, or after close and reopen', async () => {
    const { rerender } = renderApp(<SecretsDialog open onOpenChange={() => {}} />);
    await screen.findByText('aorch_token');
    routeApi({ 'GET /api/http/secrets': () => ({ keys }), 'PUT /api/http/secrets/k2': new Error('invalid secret key'), 'PUT /api/http/secrets/aorch_token': new Error('write failed') });
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'k2' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'HIDDEN-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace aorch_token' }));
    fireEvent.change(screen.getByLabelText('New value for aorch_token'), { target: { value: 'ROTATED-7' } });
    expect(document.body.innerHTML).not.toContain('HIDDEN-9');
    expect(document.body.innerHTML).not.toContain('ROTATED-7');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save secret' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save new value' })));
    expect(await screen.findByText('invalid secret key')).toBeTruthy();
    expect(await screen.findByText('write failed')).toBeTruthy();
    expect(screen.queryByText('k2')).toBeNull();
    expect(document.body.innerHTML).not.toContain('HIDDEN-9');
    expect(document.body.innerHTML).not.toContain('ROTATED-7');
    rerender(<SecretsDialog open={false} onOpenChange={() => {}} />);
    rerender(<SecretsDialog open onOpenChange={() => {}} />);
    await screen.findByText('aorch_token');
    expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText('New value for aorch_token')).toBeNull();
    expect(document.body.innerHTML).not.toContain('HIDDEN-9');
    expect(document.body.innerHTML).not.toContain('ROTATED-7');
  });

  it('secrets: Cancel on the replace form never saves', async () => {
    renderApp(<SecretsDialog open onOpenChange={() => {}} />);
    await screen.findByText('aorch_token');
    fireEvent.click(screen.getByRole('button', { name: 'Replace aorch_token' }));
    fireEvent.change(screen.getByLabelText('New value for aorch_token'), { target: { value: 'nope' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    expect(calls('PUT', '/api/http/secrets/aorch_token')).toHaveLength(0);
    expect(screen.queryByLabelText('New value for aorch_token')).toBeNull();
  });

  it('env: failed loads of the environment or of the secret keys are shown', async () => {
    routeApi({ 'GET /api/http/secrets': new Error('no workspace'), 'GET /api/http/environments/local': new Error('no environment "local"') });
    renderApp(<EnvDialog open onOpenChange={() => {}} name="local" onSaved={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/no environment "local"/));
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/secret keys: no workspace/);
  });

  it('env: deletes the environment and reports null', async () => {
    const onSaved = vi.fn();
    renderApp(<EnvDialog open onOpenChange={() => {}} name="local" onSaved={onSaved} />);
    await screen.findByDisplayValue('http://127.0.0.1:4177');
    fireEvent.click(screen.getByRole('button', { name: 'Delete environment' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect(calls('DELETE', '/api/http/environments/local')).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledWith(null);
  });
});

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;

describe('dialogs in Studio Live', () => {
  it('scope the whole dialog panel to .studio', async () => {
    renderApp(<SecretsDialog open onOpenChange={() => {}} />);
    await screen.findByText('aorch_token');
    expect(screen.getByRole('dialog').classList.contains('studio')).toBe(true);
  });

  it('style the dialogs from tokens only, with no purple, gradients or glows', () => {
    const css = readFileSync(new URL('./api.css', here), 'utf8');
    const section = css.slice(css.indexOf('/* Dialogs'));
    expect(css.indexOf('/* Dialogs')).toBeGreaterThan(0);
    expect(section).toContain('.api-dialog');
    expect(section).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(section).not.toMatch(/purple|violet|gradient\(|box-shadow/i);
  });
});
