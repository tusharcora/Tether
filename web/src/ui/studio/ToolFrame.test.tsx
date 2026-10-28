import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule } from '../../test/css';
import { Dock, FloatBar, MenuButton, ToolScreen } from './ToolFrame';

describe('ToolFrame', () => {
  it('pins bars to the edge they name', () => {
    const { container } = render(
      <ToolScreen>
        <FloatBar at="left">a</FloatBar>
        <FloatBar at="bottom">b</FloatBar>
      </ToolScreen>,
    );
    expect(container.querySelector('.tf-screen > .tf-bar.tf-left')!.textContent).toBe('a');
    expect(container.querySelector('.tf-bar.tf-bottom')).toBeTruthy();
  });

  it('docks a labelled panel that × closes, handing focus back', () => {
    const onClose = vi.fn();
    render(<button>opener</button>);
    screen.getByText('opener').focus(); // focused before the dock mounts: that is where focus goes back
    render(
      <Dock label="Step editor" head={<h2>Code</h2>} onClose={onClose}>
        <input aria-label="Prompt" />
      </Dock>,
    );
    const dock = screen.getByRole('complementary', { name: 'Step editor' });
    expect(within(dock).getByRole('heading', { name: 'Code' })).toBeTruthy();
    screen.getByLabelText('Prompt').focus();
    fireEvent.click(within(dock).getByRole('button', { name: 'Close Step editor' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('closes on Esc; Esc in a field blurs it; with a dialog, menu or listbox open the dock stays', () => {
    const onClose = vi.fn();
    render(
      <Dock label="Bot" onClose={onClose}>
        <input aria-label="Name" />
      </Dock>,
    );
    const field = screen.getByLabelText('Name');
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
    const pop = (html: string) => document.body.appendChild(Object.assign(document.createElement('div'), { innerHTML: html }));
    for (const html of ['<div role="dialog"></div>', '<div role="menu"></div>', '<div role="listbox"></div>']) {
      const p = pop(html);
      fireEvent.keyDown(window, { key: 'Escape' });
      p.remove();
    }
    expect(onClose).not.toHaveBeenCalled();
    const closedSelect = pop('<div role="listbox" aria-hidden="true"></div>'); // beui's Select keeps its listbox mounted, hidden
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    closedSelect.remove();
  });

  it('opens a menu, marks the current item, runs a pick and closes', () => {
    const pick = vi.fn();
    render(
      <MenuButton
        title="Workflows"
        label="▾"
        items={[{ label: 'a', current: true, onSelect: () => {} }, 'rule', { label: 'b', onSelect: pick }, { label: 'c', disabled: true, onSelect: pick }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    const menu = screen.getByRole('menu', { name: 'Workflows' });
    expect(within(menu).getByRole('menuitem', { name: 'a' }).getAttribute('aria-current')).toBe('true');
    expect((within(menu).getByRole('menuitem', { name: 'c' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'b' }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps bottom-wide bars clear of the assistant launcher (fixed 52 px at right 20 px)', () => {
    expect(cssRule('ui/studio/toolframe.css', '.tf-screen')).toContain('--tf-launcher: 84px');
    expect(cssRule('ui/studio/toolframe.css', '.tf-wide')).toContain('right: var(--tf-launcher)');
    expect(cssRule('ui/studio/toolframe.css', '.tf-wide')).toContain('transform: none');
  });

  it('draws the backdrop dots with a mask and turns the dock into a bottom sheet on narrow screens', () => {
    expect(cssRule('ui/studio/toolframe.css', '.tf-screen::before')).toContain('mask-image');
    expect(cssRule('ui/studio/toolframe.css', '.tf-screen::before')).toContain('background: var(--line2)');
    expect(cssRule('ui/studio/toolframe.css', '.tf-dock', '@media (max-width: 899px)')).toContain('bottom: 8px');
  });
});
