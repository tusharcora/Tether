import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { tagModels } from '../../../src/openrouter';
import fixture from '../../../test/fixtures/openrouter-models.json';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { RunsOn } from './RunsOn';
import type { Binding } from './types';

const agents = { claude: { ok: true, models: ['opus'], codeMode: 'mcp' as const }, codex: { ok: false, models: [] }, opencode: { ok: true, models: [], codeMode: null }, ollama: { ok: true, models: ['qwen'], codeMode: 'native' as const } };
const b = (agent: string, model = '', o: Partial<Binding> = {}): Binding => ({ agent, model, toolStyle: 'code', codeReads: false, ...o });
const row = (o = {}) => ({ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null, ...o });
const h = () => ({ onChange: vi.fn(), onSave: vi.fn(), onUnlink: vi.fn() });
const MODELS = tagModels(fixture);
const FREE = 'nvidia/nemotron-3.5-super-vl:free';
const NV_MODELS = ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'nvidia/nemotron-3.5-bolt-e4b'];
const group = (panel: HTMLElement, name: string) => within(panel).getByRole('region', { name });

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('RunsOn', () => {
  it('saves only a changed link and suggests the agent’s models', () => {
    const fns = h();
    const { rerender, container } = render(<RunsOn row={row()} agents={agents} draft={b('claude')} dirty={false} {...fns} />);
    expect(screen.getByRole('region', { name: 'Runs on' })).toBeTruthy();
    expect(screen.getByText('Local models (Ollama, LM Studio, llama.cpp) appear in Agent when their server is running.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect([...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['opus']);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    expect(fns.onChange).toHaveBeenCalledWith({ model: 'opus' });
    rerender(<RunsOn row={row()} agents={agents} draft={b('claude', 'opus')} dirty {...fns} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(fns.onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });

  it('unlinks a linked bot and marks an agent that is not installed', () => {
    const fns = h();
    render(<RunsOn row={row({ binding: { agent: 'codex' } })} agents={agents} draft={b('codex')} dirty={false} {...fns} />);
    expect(screen.getByText('agent not available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(fns.onUnlink).toHaveBeenCalledTimes(1);
  });

  it('picks Code Mode or Direct, offers Code Mode only for reading on Claude Code, and says when an agent falls back to direct', () => {
    const fns = h();
    const { rerender } = render(<RunsOn row={row()} agents={agents} draft={b('')} dirty={false} {...fns} />);
    expect(screen.getByText(/One run_code tool/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /Code Mode only for reading/ }));
    expect(fns.onChange).toHaveBeenCalledWith({ codeReads: true });
    fireEvent.click(screen.getByRole('button', { name: 'Direct' }));
    expect(fns.onChange).toHaveBeenCalledWith({ toolStyle: 'direct', codeReads: false });
    rerender(<RunsOn row={row()} agents={agents} draft={b('opencode')} dirty={false} {...fns} />);
    expect(screen.getByText(/opencode has no per-run route for Code Mode, so this bot’s steps run direct/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /only for reading/ })).toBeNull();
    rerender(<RunsOn row={row()} agents={agents} draft={b('claude', '', { toolStyle: 'direct' })} dirty={false} {...fns} />);
    expect(screen.queryByText(/One run_code tool/)).toBeNull();
  });

  it('keeps Code Mode the default on an OpenAI-compatible model, with a hint that small models may do better direct', () => {
    const { rerender } = render(<RunsOn row={row()} agents={agents} draft={b('ollama', 'qwen')} dirty={false} {...h()} />);
    expect(screen.getByRole('button', { name: 'Code Mode' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Small models may do better with Direct tool calls.')).toBeTruthy();
    rerender(<RunsOn row={row()} agents={agents} draft={b('claude')} dirty={false} {...h()} />);
    expect(screen.queryByText(/Small models may do better/)).toBeNull();
  });

  it('on OpenRouter, picks from Free · OpenRouter, Paid · OpenRouter and Agents & local, with tags, search and Free only', async () => {
    routeApi({ 'GET /api/accounts/openrouter/models': { models: MODELS }, 'GET /api/accounts/openrouter/allowance': { used: 18, limit: 50, remaining: 32, resetsAt: Date.now() + 3_600_000 } });
    const fns = h();
    renderApp(<RunsOn row={row()} agents={{ ...agents, openrouter: { ok: true, models: [], codeMode: 'native' } }} draft={b('openrouter', FREE)} dirty={false} {...fns} />);
    expect(screen.queryByLabelText('Model', { selector: 'input' })).toBeNull();
    const pill = await screen.findByRole('button', { name: /Model Nemotron 3.5 Super VL/ });
    expect(within(pill).getByText('free')).toBeTruthy();
    fireEvent.click(pill);
    const panel = screen.getByRole('dialog', { name: 'Choose a model' });
    const group = (name: string) => within(panel).getByRole('region', { name });
    expect(within(group('Free · OpenRouter')).getByText('nvidia · tools · images · 1M ctx')).toBeTruthy();
    expect(within(group('Free · OpenRouter')).getByText("chat only · can't edit files").closest('button')!.className).toContain('mp-dim');
    expect(within(group('Paid · OpenRouter')).getByText('anthropic · tools · images · 1M ctx · $3 / $15 · 1M')).toBeTruthy();
    expect(within(group('Agents & local')).getByText('claude')).toBeTruthy();
    expect(await within(panel).findByText('32 of 50 free requests left today')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Free only' }));
    expect(within(panel).queryByRole('region', { name: 'Paid · OpenRouter' })).toBeNull();
    expect(within(panel).queryByRole('region', { name: 'Agents & local' })).toBeNull();
    fireEvent.change(within(panel).getByLabelText('Search models'), { target: { value: 'flint' } });
    fireEvent.click(within(panel).getByText('Flint'));
    expect(fns.onChange).toHaveBeenCalledWith({ agent: 'openrouter', model: 'recursive/flint-v1.0:free' });
    expect(screen.queryByRole('dialog', { name: 'Choose a model' })).toBeNull();
  });

  it('on NVIDIA, picks from the NVIDIA group (suggested first, free · 40/min) or Agents & local; no OpenRouter list or counter', async () => {
    routeApi({ 'GET /api/accounts/nvidia/models': { models: NV_MODELS } });
    const fns = h();
    renderApp(<RunsOn row={row()} agents={{ ...agents, nvidia: { ok: true, models: [], codeMode: 'native' } }} draft={b('nvidia', NV_MODELS[0]!)} dirty={false} {...fns} />);
    const pill = await screen.findByRole('button', { name: /Model nemotron-3.5-super-vl-120b-a12b/ });
    expect(within(pill).getByText('free')).toBeTruthy();
    fireEvent.click(pill);
    const panel = screen.getByRole('dialog', { name: 'Choose a model' });
    const nv = within(panel).getByRole('region', { name: 'NVIDIA' });
    expect(within(nv).getAllByRole('button').map((r) => r.querySelector('b')!.textContent)).toEqual(['nemotron-3.5-super-vl-120b-a12b', 'deepseek-v4.1-flash', 'glm-5.3-flash', 'nemotron-3.5-bolt-e4b']);
    expect(within(nv).getByText('z-ai · 40/min')).toBeTruthy();
    expect(within(nv).getAllByText('free')).toHaveLength(4);
    expect(within(group(panel, 'Agents & local')).queryByText('nvidia')).toBeNull();
    expect(within(panel).queryByRole('region', { name: /OpenRouter/ })).toBeNull();
    expect(within(panel).getByText('Free · about 40 requests a minute')).toBeTruthy();
    expect(calls('GET', '/api/accounts/openrouter/models')).toHaveLength(0);
    fireEvent.change(within(panel).getByLabelText('Search models'), { target: { value: 'glm' } });
    fireEvent.click(within(panel).getByText('glm-5.3-flash'));
    expect(fns.onChange).toHaveBeenCalledWith({ agent: 'nvidia', model: 'z-ai/glm-5.3-flash' });
  });

  it('warns when a writing bot is on a chat-only free model, not a read-only one', async () => {
    routeApi({ 'GET /api/accounts/openrouter/models': { models: MODELS }, 'GET /api/accounts/openrouter/allowance': new Error('OpenRouter is not connected') });
    const chatOnly = 'nvidia/nemotron-3.5-content-safety:free';
    const { unmount } = renderApp(<RunsOn row={row()} agents={agents} draft={b('openrouter', chatOnly)} dirty={false} {...h()} />);
    expect(await screen.findByText(/is chat only and can't edit files: this bot writes/)).toBeTruthy();
    unmount();
    renderApp(<RunsOn row={row({ role: 'planner' })} readOnly agents={agents} draft={b('openrouter', chatOnly)} dirty={false} {...h()} />);
    await screen.findByRole('button', { name: /Model Nemotron 3.5 Content Safety/ });
    expect(screen.queryByText(/is chat only/)).toBeNull();
  });

  it('has nothing to link for an approval bot', () => {
    render(<RunsOn row={row({ kind: 'approval' })} agents={agents} draft={b('')} dirty={false} {...h()} />);
    expect(screen.getByText('A person signs off here. Nothing to link.')).toBeTruthy();
    expect(screen.queryByLabelText('Model')).toBeNull();
  });
});
