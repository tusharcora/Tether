import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Picker, type PickerOption } from './Picker';

const OPTIONS: PickerOption[] = [
  { id: 'coder', name: 'coder', hint: 'Bolt · coder' },
  { id: 'reviewer', name: 'reviewer', hint: 'Lens · reviewer' },
  { id: 'tester', name: 'tester', disabled: true },
  { id: 'planner', name: 'planner' },
];

function Harness(p: { start?: string[]; multiple?: boolean; custom?: boolean; onChange?: (v: string[]) => void }) {
  const [v, setV] = useState<string[]>(p.start ?? []);
  return (
    <>
      <button type="button">before</button>
      <Picker label="Bot" options={OPTIONS} value={v} multiple={p.multiple} custom={p.custom ? { label: 'Another role' } : undefined} onChange={(n) => (setV(n), p.onChange?.(n))} />
    </>
  );
}
const pill = () => screen.getByRole('combobox', { name: 'Bot' });

describe('Picker', () => {
  it('is a combobox named by its label with a placeholder until something is chosen', () => {
    render(<Harness />);
    expect(pill().getAttribute('aria-haspopup')).toBe('listbox');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    expect(pill().textContent).toContain('Choose');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a listbox of the real options, marks the chosen one, and picks with a click, then closes', () => {
    const onChange = vi.fn();
    render(<Harness start={['coder']} onChange={onChange} />);
    fireEvent.click(pill());
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['coder', 'reviewer', 'tester', 'planner']);
    expect(within(list).getByRole('option', { name: 'coder' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(list).getByRole('option', { name: 'reviewer' }));
    expect(onChange).toHaveBeenCalledWith(['reviewer']);
    expect(pill().textContent).toContain('reviewer');
  });

  it('moves with the arrow keys over disabled options, chooses with Enter and gives focus back to the pill', async () => {
    const onChange = vi.fn();
    render(<Harness start={['coder']} onChange={onChange} />);
    fireEvent.keyDown(pill(), { key: 'ArrowDown' });
    const list = await screen.findByRole('listbox');
    expect(document.activeElement).toBe(within(list).getByRole('option', { name: 'coder' }));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(list).getByRole('option', { name: 'reviewer' }));
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // tester is disabled: skipped
    expect(document.activeElement).toBe(within(list).getByRole('option', { name: 'planner' }));
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // wraps
    expect(document.activeElement).toBe(within(list).getByRole('option', { name: 'coder' }));
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['planner']);
    expect(document.activeElement).toBe(pill());
  });

  it('jumps by typing, never picks a disabled option, and Escape closes without choosing', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(pill());
    const list = await screen.findByRole('listbox');
    fireEvent.keyDown(list, { key: 'p' });
    expect(document.activeElement).toBe(within(list).getByRole('option', { name: 'planner' }));
    fireEvent.click(within(list).getByRole('option', { name: 'tester' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(pill());
  });

  it('chooses several in multiple mode and keeps the list open', () => {
    const onChange = vi.fn();
    render(<Harness multiple onChange={onChange} />);
    fireEvent.click(pill());
    fireEvent.click(screen.getByRole('option', { name: 'coder' }));
    fireEvent.click(screen.getByRole('option', { name: 'planner' }));
    expect(onChange).toHaveBeenLastCalledWith(['coder', 'planner']);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    expect(pill().textContent).toContain('2 chosen');
    fireEvent.click(screen.getByRole('option', { name: 'coder' }));
    expect(onChange).toHaveBeenLastCalledWith(['planner']);
  });

  it('takes a custom value from its text row and shows it in the pill', async () => {
    const onChange = vi.fn();
    render(<Harness custom onChange={onChange} />);
    fireEvent.click(pill());
    const field = screen.getByLabelText('Another role') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'security-auditor' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['security-auditor']);
    expect(pill().textContent).toContain('security-auditor');
  });

  it('closes on a press outside', async () => {
    render(<Harness />);
    fireEvent.click(pill());
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'before' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});
