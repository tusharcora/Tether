import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../src/adapters/index.js';
import { loadConfig } from '../src/config.js';
import { addEndpoint, keyRef, listProviders, removeEndpoint } from '../src/providers.js';

describe('providers', () => {
  it('adds and removes an endpoint, keeping the rest of the config file', () => {
    const home = mkdtempSync(join(tmpdir(), 'aorch-p-'));
    writeFileSync(join(home, 'aorch.config.json'), JSON.stringify({ vault: '/v' }));
    const cfg = loadConfig({ home });
    addEndpoint(cfg, 'deepseek', { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'env:DEEPSEEK_API_KEY' });
    const file = JSON.parse(readFileSync(join(home, 'aorch.config.json'), 'utf8'));
    expect(file.vault).toBe('/v');
    expect(file.endpoints.deepseek.apiKey).toBe('env:DEEPSEEK_API_KEY');
    const rows = listProviders(cfg, defaultRegistry(cfg.adapters, cfg.endpoints));
    expect(rows.find((r) => r.id === 'deepseek')).toMatchObject({ kind: 'endpoint', removable: true, keySet: false });
    expect(rows.find((r) => r.id === 'ollama')).toMatchObject({ kind: 'local server', removable: false });
    removeEndpoint(cfg, 'deepseek');
    expect(JSON.parse(readFileSync(join(home, 'aorch.config.json'), 'utf8')).endpoints).toEqual({});
  });

  it('refuses built-in names, bad URLs, duplicates, literal keys and keys over plain http', () => {
    const home = mkdtempSync(join(tmpdir(), 'aorch-p-'));
    const cfg = loadConfig({ home });
    expect(() => addEndpoint(cfg, 'claude', { baseUrl: 'https://x.io/v1' })).toThrow(/built in/);
    expect(() => addEndpoint(cfg, 'ok', { baseUrl: 'nope' })).toThrow(/valid URL/);
    expect(() => addEndpoint(cfg, 'ok', { baseUrl: 'http://example.com/v1', apiKey: 'env:K' })).toThrow(/plain http/);
    addEndpoint(cfg, 'ok', { baseUrl: 'http://127.0.0.1:9000/v1', apiKey: 'env:K' });
    expect(() => addEndpoint(cfg, 'ok', { baseUrl: 'https://x.io/v1' })).toThrow(/already exists/);
    expect(() => keyRef('sk-abc123-secret!')).toThrow(/NAME of an environment variable/);
    expect(keyRef('MY_KEY')).toBe('env:MY_KEY');
    expect(keyRef('')).toBeUndefined();
  });
});

describe('forgiving input', () => {
  it('turns hosts and sites into names and URLs', async () => {
    const { providerName, baseUrlOf } = await import('../src/providers.js');
    expect(providerName('experimentallabs.ai')).toBe('experimentallabs');
    expect(providerName('https://api.Foo-Bar.com/v1')).toBe('foo-bar');
    expect(baseUrlOf('api.experimentallabs.ai')).toBe('https://api.experimentallabs.ai/v1');
    expect(baseUrlOf('https://x.io/custom/v2/')).toBe('https://x.io/custom/v2');
    expect(baseUrlOf('localhost:8000')).toBe('http://localhost:8000/v1');
  });
});
