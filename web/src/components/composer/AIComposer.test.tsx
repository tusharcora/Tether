import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Plus, Square } from 'lucide-react';
import { AIComposer, makerOf, menuState, type ComposerPerson, type SlashCommand } from './AIComposer';

function Harness(p: { onSubmit: (t: string, m?: string) => void; loading?: boolean; onStop?: () => void; tags?: Record<string, string[]>; commands?: SlashCommand[]; people?: ComposerPerson[] }) {
  const [value, setValue] = useState('');
  const [model, setModel] = useState<string | undefined>();
  return (
    <AIComposer
      aria-label="Message"
      value={value}
      onValueChange={setValue}
      models={['opus', 'gpt-5']}
      model={model}
      autoModel="opus"
      onModelChange={setModel}
      onSubmit={p.onSubmit}
      loading={p.loading}
      onStop={p.onStop}
      files={[]}
      onFiles={() => {}}
      onRemoveFile={() => {}}
      favKey="test.favs"
      tags={p.tags}
      commands={p.commands}
      people={p.people}
    />
  );
}

describe('the AI composer', () => {
  it('sends on Enter with no model under Auto, then with the picked model', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const box = screen.getByLabelText('Message');
    fireEvent.change(box, { target: { value: 'hi' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenLastCalledWith('hi', undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    fireEvent.click(screen.getByRole('option', { name: /gpt-5/ }));
    expect(screen.getByRole('button', { name: 'Model: gpt-5' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));
    expect(onSubmit).toHaveBeenLastCalledWith('hi', 'gpt-5');
  });

  it('groups models by maker, with starred ones first, and starring does not pick', () => {
    localStorage.removeItem('test.favs');
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const heads = () => [...document.querySelectorAll('[cmdk-group-heading]')].map((h) => h.textContent);
    expect(heads()).toEqual(['Anthropic', 'OpenAI']);
    fireEvent.click(screen.getByRole('button', { name: 'Star gpt-5' }));
    expect(heads()).toEqual(['Starred', 'Anthropic', 'OpenAI']);
    // the open dialog hides the page behind it from assistive tech; the trigger still says Auto
    expect(screen.getByRole('button', { name: 'Model: Auto', hidden: true })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('test.favs')!)).toEqual(['gpt-5']);
  });

  it('names the maker from an OpenRouter id or a known model name', () => {
    expect(makerOf('nvidia/nemotron-3.5-super-vl:free')).toEqual({ logo: 'nvidia', name: 'NVIDIA' });
    expect(makerOf('meta-llama/llama-4:free')).toEqual({ logo: 'llama', name: 'Meta' });
    expect(makerOf('sonnet')).toEqual({ logo: 'anthropic', name: 'Anthropic' });
    expect(makerOf('mystery-7b')).toEqual({ name: 'Other' });
  });

  it('names NVIDIA’s makers by their own slugs, and an unlisted maker by its slug capitalised with no logo', () => {
    expect(makerOf('deepseek-ai/deepseek-v4.1-flash')).toEqual({ logo: 'deepseek', name: 'DeepSeek' });
    expect(makerOf('meta/llama-3.2-90b-vision-instruct')).toEqual({ logo: 'llama', name: 'Meta' });
    expect(makerOf('minimaxai/minimax-m3.1-flash')).toEqual({ logo: 'minimax', name: 'MiniMax' });
    expect(makerOf('nv-mistralai/mistral-nemo-12b-instruct')).toEqual({ logo: 'mistral', name: 'Mistral' });
    expect(makerOf('z-ai/glm-5.3-flash')).toEqual({ logo: 'zai', name: 'Z.ai' });
    expect(makerOf('ibm/granite-3.0-8b-instruct')).toEqual({ name: 'IBM' });
    expect(makerOf('microsoft/phi-3.5-moe-instruct')).toEqual({ name: 'Microsoft' });
    expect(makerOf('writer/palmyra-med-70b')).toEqual({ name: 'Writer' });
  });

  it('puts a model under the heading groupOf gives instead of its maker', () => {
    localStorage.removeItem('test.favs');
    render(<AIComposer aria-label="Message" value="" onValueChange={() => {}} models={['opus', 'z-ai/glm-5.3-flash', 'meta/llama-4']} onModelChange={() => {}} onSubmit={() => {}} files={[]} onFiles={() => {}} onRemoveFile={() => {}} favKey="test.favs" groupOf={(m) => (m.includes('/') ? 'NVIDIA (build.nvidia.com)' : undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    expect([...document.querySelectorAll('[cmdk-group-heading]')].map((h) => h.textContent)).toEqual(['Anthropic', 'NVIDIA (build.nvidia.com)']);
  });

  it('tags models when it is given tags (OpenRouter: free, tools, images)', () => {
    localStorage.removeItem('test.favs');
    render(<Harness onSubmit={vi.fn()} tags={{ 'gpt-5': ['free', 'tools'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const row = screen.getByRole('option', { name: /gpt-5/ });
    expect([...row.querySelectorAll('.aic-tag')].map((t) => t.textContent)).toEqual(['free', 'tools']);
    expect(row.querySelector('.aic-tag.free')).toBeTruthy();
  });

  it('turns send into Stop while a reply streams', () => {
    const onStop = vi.fn();
    render(<Harness onSubmit={vi.fn()} loading onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe('slash commands and mentions', () => {
  const setup = () => {
    const onSubmit = vi.fn();
    const commands = [
      { name: 'new', description: 'Start a new chat', icon: Plus, run: vi.fn() },
      { name: 'stop', description: 'Stop the reply', icon: Square, run: vi.fn() },
    ];
    const people: ComposerPerson[] = [
      { name: 'Bolt', role: 'agent' },
      { name: 'Brick', role: 'agent' },
      { name: 'Scout', role: 'agent' },
    ];
    render(<Harness onSubmit={onSubmit} commands={commands} people={people} />);
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    const type = (v: string) => fireEvent.change(box, { target: { value: v } });
    const key = (k: string, o: Record<string, unknown> = {}) => fireEvent.keyDown(box, { key: k, ...o });
    const active = () => document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent ?? '';
    return { onSubmit, commands, box, type, key, active };
  };

  it('"/" lists the commands (with /model for the picker); arrows move the highlight, Enter runs it and clears the text', () => {
    const { commands, box, type, key, active, onSubmit } = setup();
    type('/');
    const list = screen.getByRole('listbox', { name: 'Commands' });
    expect(screen.getAllByRole('option').map((o) => o.textContent?.split('/')[1]?.split(/[A-Z]/)[0])).toEqual(['new', 'stop', 'model']);
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(active()).toContain('/new');
    key('ArrowDown');
    expect(active()).toContain('/stop');
    expect(screen.getByRole('option', { name: /stop/ }).getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    key('ArrowUp');
    expect(active()).toContain('/model');
    key('ArrowDown');
    key('Enter');
    expect(commands[0]!.run).toHaveBeenCalled();
    expect(box.value).toBe('');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by what follows the slash, runs with Tab or a click, and /model opens the picker', () => {
    const { commands, type, key } = setup();
    type('/st');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    key('Tab');
    expect(commands[1]!.run).toHaveBeenCalled();
    type('/n');
    fireEvent.click(screen.getByRole('option', { name: /new/ }));
    expect(commands[0]!.run).toHaveBeenCalled();
    type('/mo');
    key('Enter');
    expect(screen.getByRole('dialog', { name: 'Choose a model' })).toBeTruthy();
  });

  it('Escape closes the menu until the text changes, and a slash that matches nothing sends as text', () => {
    const { type, key, onSubmit } = setup();
    type('/');
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    act(() => void screen.getByLabelText('Message').dispatchEvent(esc));
    document.removeEventListener('keydown', outer);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    type('/n');
    expect(screen.getByRole('listbox')).toBeTruthy();
    type('/etc/hosts is broken');
    expect(screen.queryByRole('listbox')).toBeNull();
    key('Enter');
    expect(onSubmit).toHaveBeenCalledWith('/etc/hosts is broken', undefined);
  });

  it('"@" lists the people whose name starts with what follows; Enter puts the name in', () => {
    const { box, type, key, active } = setup();
    type('ask @b');
    expect(screen.getByRole('listbox', { name: 'Mention' })).toBeTruthy();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['BBoltagent', 'BBrickagent']);
    key('ArrowDown');
    expect(active()).toContain('Brick');
    key('Enter');
    expect(box.value).toBe('ask @Brick ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('works out which menu is open', () => {
    expect(menuState('/', undefined, 2, 0)).toBe('commands');
    expect(menuState('@b', undefined, 0, 1)).toBe('mention');
    expect(menuState('@b', '@b', 0, 1)).toBeUndefined();
    expect(menuState('hi', undefined, 0, 0)).toBeUndefined();
  });
});
