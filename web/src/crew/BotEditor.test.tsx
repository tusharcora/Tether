import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BotDef } from '../crewStore';
import { BotEditor } from './BotEditor';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const bolt: BotDef = { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change', look, builtin: true };
const kinds = [{ kind: 'agent', blurb: 'does a job' }, { kind: 'verdict', blurb: 'passes or fails' }];
const handlers = () => ({ onPatch: vi.fn(), onFace: vi.fn(), onResetFace: vi.fn(), onPersona: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() });

describe('BotEditor', () => {
  it('edits the look and fields of a built-in bot, with its kind locked', () => {
    const h = handlers();
    render(<BotEditor bot={bolt} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    expect(screen.getByRole('region', { name: 'Edit Bolt' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bolt preview' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: /Hue/ }), { key: 'ArrowRight' });
    expect(h.onFace).toHaveBeenCalledWith({ hue: expect.any(Number) });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'builder' } });
    expect(h.onPatch).toHaveBeenCalledWith({ title: 'builder' });
    expect((screen.getByRole('combobox', { name: /Kind/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('switch', { name: /read-only/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to original' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([h.onSave, h.onCancel].map((f) => f.mock.calls.length)).toEqual([1, 1]);
  });

  it('offers Reset to original for an edited built-in and Remove for your own bot', () => {
    const h = handlers();
    const { rerender } = render(<BotEditor bot={{ ...bolt, edited: true }} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to original' }));
    expect(h.onRemove).toHaveBeenCalledTimes(1);
    rerender(<BotEditor bot={{ ...bolt, id: 'quill', name: 'Quill', builtin: false }} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'read-only (may not edit files)' }));
    expect(h.onPatch).toHaveBeenCalledWith({ readOnly: true });
  });

  it('keeps the persona read-only until the full text loads, and says why', () => {
    const h = handlers();
    const ecc = { ...bolt, id: 'go-reviewer', name: 'Go Reviewer', builtin: false, source: 'ecc@v2.2.3' };
    const { rerender } = render(<BotEditor bot={ecc} isNew={false} kinds={kinds} personaLoad="loading" {...h} />);
    const persona = screen.getByLabelText(/Persona/) as HTMLTextAreaElement;
    expect(persona.readOnly).toBe(true);
    expect(screen.getByText('Loading the full persona…')).toBeTruthy();
    fireEvent.change(persona, { target: { value: 'lost' } });
    expect(h.onPersona).not.toHaveBeenCalled();
    rerender(<BotEditor bot={ecc} isNew={false} kinds={kinds} personaLoad="failed" {...h} />);
    expect(screen.getByText('Showing the first 2000 characters; edits are disabled until the full text loads')).toBeTruthy();
    rerender(<BotEditor bot={ecc} isNew={false} kinds={kinds} personaLoad="ok" {...h} />);
    expect(screen.getByText('From ECC; an update replaces your edits')).toBeTruthy();
    expect(persona.maxLength).toBe(24000);
    fireEvent.change(persona, { target: { value: 'Be brief.' } });
    expect(h.onPersona).toHaveBeenCalledWith('Be brief.');
  });

  it('names a new bot "New bot" and offers no Remove', () => {
    render(<BotEditor bot={{ ...bolt, id: '', name: '', builtin: false }} isNew kinds={kinds} personaLoad="ok" {...handlers()} />);
    expect(screen.getByRole('region', { name: 'New bot' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'New bot preview' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
