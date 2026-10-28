import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunsOn } from './RunsOn';
import type { Binding } from './types';

const agents = { claude: { ok: true, models: ['opus'], codeMode: 'mcp' as const }, codex: { ok: false, models: [] }, opencode: { ok: true, models: [], codeMode: null }, ollama: { ok: true, models: ['qwen'], codeMode: 'native' as const } };
const b = (agent: string, model = '', o: Partial<Binding> = {}): Binding => ({ agent, model, toolStyle: 'code', codeReads: false, ...o });
const row = (o = {}) => ({ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null, ...o });
const h = () => ({ onChange: vi.fn(), onSave: vi.fn(), onUnlink: vi.fn() });

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

  it('has nothing to link for an approval bot', () => {
    render(<RunsOn row={row({ kind: 'approval' })} agents={agents} draft={b('')} dirty={false} {...h()} />);
    expect(screen.getByText('A person signs off here. Nothing to link.')).toBeTruthy();
    expect(screen.queryByLabelText('Model')).toBeNull();
  });
});
