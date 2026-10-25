import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isApple, Kbd } from './Kbd';

const setPlatform = (p: string) => Object.defineProperty(navigator, 'platform', { value: p, configurable: true });
afterEach(() => setPlatform(''));

describe('Kbd', () => {
  it('shows ⌘ on Apple platforms', () => {
    setPlatform('MacIntel');
    expect(isApple()).toBe(true);
    const { container } = render(<Kbd mod>K</Kbd>);
    expect(container.querySelector('kbd')!.textContent).toBe('⌘K');
    expect(screen.getByRole('img', { name: 'Command' }).textContent).toBe('⌘');
  });
  it('shows Ctrl elsewhere', () => {
    setPlatform('Win32');
    render(<Kbd mod>K</Kbd>);
    expect(screen.getByText('Ctrl K')).toBeTruthy();
  });
  it('shows a plain key without a modifier', () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc')).toBeTruthy();
  });
});
