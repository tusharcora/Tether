import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import type { ChatMessage, ContextUse } from './api';
import { ContextRing } from './ContextRing';
import { Thread } from './Thread';
import type { Assistant } from './useAssistant';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));

const use = (o: Partial<ContextUse> = {}): ContextUse => ({
  parts: { prompt: [['Who Tether is', 4000]], tools: [['run_code', 2000], ['Code Mode notes', 400]], memory: [], messages: [['3 earlier messages', 1200], ['This message', 400]] },
  agent: 'claude',
  model: 'opus',
  size: 200_000,
  tokens: 20_000,
  ...o,
});
const msgs = (n: number, last: Partial<ChatMessage> = {}): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'tether' : 'you', text: `message ${i}`, at: i, ...(i === n - 1 ? last : {}) }) as ChatMessage);
const chatOf = (messages: ChatMessage[], o: Partial<Assistant> = {}) => ({ messages, compacting: false, compact: vi.fn(async () => {}), ...o }) as unknown as Assistant;
const open = async (chat: Assistant) => {
  renderApp(<ContextRing chat={chat} />);
  fireEvent.click(screen.getByRole('button', { name: /^Context \d+% used$/ }));
  return screen.findByRole('group', { name: 'Context window' });
};

describe('ContextRing', () => {
  it('shows no ring without a record or when the model size is unknown', () => {
    const { container } = renderApp(<ContextRing chat={chatOf(msgs(6))} />);
    expect(container.textContent).toBe('');
    renderApp(<ContextRing chat={chatOf(msgs(6, { context: use({ size: undefined }) }))} />);
    expect(screen.queryByRole('button', { name: /Context/ })).toBeNull();
  });

  it('opens on the parts of the last turn, from the reported count, with each part’s make-up on focus', async () => {
    const pop = await open(chatOf(msgs(6, { context: use() })));
    expect(screen.getByRole('button', { name: 'Context 14% used' })).toBeTruthy();
    expect(pop.textContent).toContain('Context14%');
    expect(pop.textContent).toContain('28k of 200k · opus');
    expect(pop.textContent).not.toContain('about');
    const rows = ["Tether's prompt", 'Tools', 'Memory', 'Messages', 'Reserved', 'Free'].map((l) => screen.getByRole('button', { name: new RegExp(`^${l}`) }));
    fireEvent.focus(rows[1]!);
    expect(rows[1]!.getAttribute('aria-expanded')).toBe('true');
    expect(pop.textContent).toContain("Agent's own prompt and tools");
    expect(pop.textContent).toContain('152k until auto-compact');
  });

  it('says "about" for an estimate', async () => {
    const pop = await open(chatOf(msgs(6, { context: use({ tokens: undefined }) })));
    expect(pop.textContent).toContain('about 10k of 200k');
  });

  it('shows the free-tier limits that apply: OpenRouter’s count, NVIDIA’s pace', async () => {
    const resetsAt = new Date(2026, 9, 29, 20, 0).getTime();
    routeApi({ 'GET /api/accounts/openrouter/allowance': { used: 32, limit: 50, remaining: 18, resetsAt } });
    const pop = await open(chatOf(msgs(6, { context: use({ limit: 'openrouter', agent: 'openrouter', model: 'x/y:free' }) })));
    expect(await screen.findByText('32 of 50')).toBeTruthy();
    expect(pop.textContent).toContain('resets 20:00');
    expect(vi.mocked(api)).toHaveBeenCalledWith('GET', '/api/accounts/openrouter/allowance');
  });

  it('shows NVIDIA’s pace', async () => {
    const pop = await open(chatOf(msgs(6, { context: use({ limit: 'nvidia' }) })));
    expect(pop.textContent).toContain('NVIDIAabout 40 a minute');
  });

  it('compacts now, and only when there is something to fold', async () => {
    const chat = chatOf(msgs(6, { context: use() }));
    await open(chat);
    fireEvent.click(screen.getByRole('button', { name: 'Compact now' }));
    expect(chat.compact).toHaveBeenCalledWith(false);
  });

  it('cannot compact a short chat', async () => {
    await open(chatOf(msgs(4, { context: use() })));
    expect((screen.getByRole('button', { name: 'Compact now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it is summarizing while a compaction runs', async () => {
    const pop = await open(chatOf(msgs(6, { context: use() }), { compacting: true }));
    expect(pop.textContent).toContain('Summarizing older messages…');
    expect((screen.getByRole('button', { name: 'Compacting…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers Undo right after a compaction', async () => {
    const ms = msgs(6).map((m, i) => (i < 2 ? { ...m, compactedBy: 's1' } : m));
    ms.splice(2, 0, { id: 's1', role: 'tether', text: 'They talked.', at: 2, compact: { count: 2 }, context: use({ about: true }) });
    const chat = chatOf(ms);
    const pop = await open(chat);
    expect(pop.textContent).toContain('Compacted: 2 messages → summary + last 4');
    expect(pop.textContent).toContain('about');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(chat.compact).toHaveBeenCalledWith(true);
  });
});

describe('a compacted chat in the thread', () => {
  const ms: ChatMessage[] = [
    { id: 'y1', role: 'you', text: 'first question', at: 1, compactedBy: 's1' },
    { id: 't1', role: 'tether', text: 'first answer', at: 2, compactedBy: 's1' },
    { id: 's1', role: 'tether', text: 'They talked about limits.', at: 3, compact: { count: 2, auto: true } },
    { id: 'y2', role: 'you', text: 'next question', at: 4 },
  ];
  it('folds the originals under their summary; Show brings them back; Undo is on the newest summary', () => {
    const chat = chatOf(ms);
    renderApp(<Thread chat={chat} onGo={() => {}} empty="" />);
    expect(screen.queryByText('first question')).toBeNull();
    expect(screen.getByText('Tether summarized 2 earlier messages to make room')).toBeTruthy();
    expect(screen.getByText('next question')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('first question')).toBeTruthy();
    expect(screen.getByText('They talked about limits.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(chat.compact).toHaveBeenCalledWith(true);
  });
});
