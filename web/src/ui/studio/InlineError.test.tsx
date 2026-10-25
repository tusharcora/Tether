import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineError } from './InlineError';

describe('InlineError', () => {
  it('is an alert with a retry', () => {
    const onRetry = vi.fn();
    render(<InlineError message="down" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('down');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
