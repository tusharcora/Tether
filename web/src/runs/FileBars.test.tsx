import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileBars } from './FileBars';

const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n';

describe('FileBars', () => {
  it('names each changed file; with onOpen a name opens the file', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<FileBars diff={DIFF} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    rerender(<FileBars diff={DIFF} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts' }));
    expect(onOpen).toHaveBeenCalledWith('src/a.ts');
  });
});
