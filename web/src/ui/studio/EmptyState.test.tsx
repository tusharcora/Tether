import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('says what is empty and offers one action', () => {
    render(<EmptyState title="No runs yet" description="Start one from Home." action={<button>Start a run</button>} />);
    expect(screen.getByText('No runs yet')).toBeTruthy();
    expect(screen.getByText('Start one from Home.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a run' })).toBeTruthy();
  });
});
