import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { ConfirmButton } from './ConfirmButton';
import { cn, fromNone, NONE } from './cn';
import { Diff } from './Diff';
import { useNotify } from './notify';

describe('cn', () => {
  it('joins strings and truthy keys', () => {
    expect(cn('a', false, undefined, { b: true, c: false }, 'd')).toBe('a b d');
    expect(fromNone(NONE)).toBe('');
    expect(fromNone('x')).toBe('x');
  });
});

describe('ConfirmButton', () => {
  it('asks before acting and can be cancelled', async () => {
    const go = vi.fn();
    renderApp(<ConfirmButton label="Delete" prompt="Delete t1?" confirmLabel="Yes, delete" onConfirm={go} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});

describe('useNotify', () => {
  it('shows an error toast with the message', async () => {
    function Boom() {
      const n = useNotify();
      return <button onClick={() => n.fail(new Error('server said no'))}>go</button>;
    }
    renderApp(<Boom />);
    await act(async () => fireEvent.click(screen.getByText('go')));
    expect(await screen.findByText('server said no')).toBeTruthy();
  });
});

describe('Diff', () => {
  it('classes diff lines and truncates long diffs', () => {
    const text = ['diff --git a b', '@@ -1 +1 @@', '+added', '-removed', ' same', ...Array(3001).fill('x')].join('\n');
    const { container } = renderApp(<Diff text={text} />);
    expect(container.querySelector('.da')?.textContent).toContain('+added');
    expect(container.querySelector('.dd')?.textContent).toContain('-removed');
    expect(container.textContent).toContain('diff truncated');
  });
});
