import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import type { SendOutput } from './client';
import { SendToAgent } from './SendToAgent';

const output: SendOutput = {
  historyId: 7,
  request: { method: 'GET', url: 'http://127.0.0.1:4177/api/runs', headers: [] },
  result: { status: 500, statusText: 'Internal Server Error', url: 'http://127.0.0.1:4177/api/runs', headers: [], body: '{}', size: 2048, truncated: false, ms: 42, timing: { ttfb: 40, download: 2 }, redirects: [] },
  checks: [],
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'POST /api/http/send-to-agent': { runId: 'r9' } });
});

describe('SendToAgent', () => {
  it('is disabled until there is a response', () => {
    renderApp(<SendToAgent onStarted={() => {}} onUseAsGate={() => {}} />);
    expect((screen.getByRole('button', { name: /Start run with/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ask Maestro' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Send the request first/)).toBeTruthy();
  });

  it('starts a run with the picked bot and the note, showing the attachments', async () => {
    const onStarted = vi.fn();
    renderApp(<SendToAgent output={output} requestId="runs/list" env="local" onStarted={onStarted} onUseAsGate={() => {}} />);
    expect(screen.getByText('GET /api/runs')).toBeTruthy();
    expect(screen.getByText('500 · 2.0 KB')).toBeTruthy();
    expect(screen.getByText('42 ms')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Scout/ }));
    expect(screen.getByRole('button', { name: /^Scout/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Note for the agent'), { target: { value: 'why 500?' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run with Scout' })));
    expect(calls('POST', '/api/http/send-to-agent')[0]![2]).toEqual({ historyId: 7, target: { kind: 'run', bot: 'planner', mode: 'solo' }, note: 'why 500?' });
    expect(onStarted).toHaveBeenCalledWith('r9');
  });

  it('asks Maestro, or as a team run, and hands the request over as a gate', async () => {
    const onUseAsGate = vi.fn();
    renderApp(<SendToAgent output={output} requestId="runs/list" env="local" onStarted={() => {}} onUseAsGate={onUseAsGate} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask Maestro' })));
    expect(calls('POST', '/api/http/send-to-agent')[0]![2]).toEqual({ historyId: 7, target: { kind: 'maestro' }, note: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Start run with/ })));
    expect((calls('POST', '/api/http/send-to-agent')[1]![2] as { target: unknown }).target).toEqual({ kind: 'run', bot: 'coder', mode: 'team' });
    fireEvent.click(screen.getByRole('button', { name: 'Use as gate in a workflow' }));
    expect(onUseAsGate).toHaveBeenCalledWith({ run: 'runs/list', env: 'local' });
  });

  it('⌘↵ in the note hands the exchange over and never reaches the editor\'s window-wide send', async () => {
    const editorSend = vi.fn();
    const onWindowKey = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && editorSend();
    window.addEventListener('keydown', onWindowKey);
    try {
      const onStarted = vi.fn();
      renderApp(<SendToAgent output={output} onStarted={onStarted} onUseAsGate={() => {}} />);
      const note = screen.getByLabelText('Note for the agent');
      fireEvent.change(note, { target: { value: 'look' } });
      await act(async () => fireEvent.keyDown(note, { key: 'Enter', metaKey: true }));
      expect(editorSend).not.toHaveBeenCalled();
      expect(calls('POST', '/api/http/send-to-agent')[0]![2]).toEqual({ historyId: 7, target: { kind: 'run', bot: 'coder', mode: 'solo' }, note: 'look' });
      expect(onStarted).toHaveBeenCalledWith('r9');
      fireEvent.keyDown(note, { key: 'Enter' });
      expect(calls('POST', '/api/http/send-to-agent')).toHaveLength(1);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('offers only bots that can take a hand-off and shows a network error instead of a status', () => {
    renderApp(<SendToAgent output={{ ...output, result: { ...output.result, status: 0, error: { kind: 'refused', message: 'connect ECONNREFUSED' } } }} onStarted={() => {}} onUseAsGate={() => {}} />);
    expect(screen.queryByRole('button', { name: /^Maestro/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Gate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Probe/ })).toBeNull();
    expect(screen.getByText('refused')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use as gate in a workflow' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
