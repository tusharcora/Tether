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

  it('has a compact form for a failed refresh over data still shown', () => {
    render(<InlineError compact message="Couldn't refresh" onRetry={() => {}} />);
    expect(screen.getByRole('alert').className).toContain('compact');
  });
});
