import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { ConfirmButton } from './ConfirmButton';
import { cn, fromNone, NONE } from './cn';
import { RunDiff, parseDiff } from './RunDiff';
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

describe('ConfirmButton guards', () => {
  it('keeps the confirm step disabled while its own action runs', async () => {
    let finish!: () => void;
    function Host() {
      const [busy, setBusy] = useState(false);
      return (
        <ConfirmButton
          label="Delete"
          prompt="Delete t1?"
          confirmLabel="Yes, delete"
          disabled={busy}
          onConfirm={async () => {
            setBusy(true);
            await new Promise<void>((r) => (finish = r));
            setBusy(false);
          }}
        />
      );
    }
    renderApp(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect((screen.getByRole('button', { name: /Yes, delete/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('backs out of the question when disabled from outside while asking', () => {
    const go = vi.fn();
    const { rerender } = renderApp(<ConfirmButton label="Delete" prompt="Delete t1?" confirmLabel="Yes, delete" onConfirm={go} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    rerender(<ConfirmButton label="Delete" prompt="Delete t1?" confirmLabel="Yes, delete" disabled onConfirm={go} />);
    expect(screen.queryByRole('button', { name: 'Yes, delete' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('swallows a rejected onConfirm and resets', async () => {
    const go = vi.fn().mockRejectedValue(new Error('nope'));
    renderApp(<ConfirmButton label="Delete" prompt="Delete t1?" confirmLabel="Yes, delete" cancelLabel="Keep it" onConfirm={go} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
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

describe('RunDiff', () => {
  const patch = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', ' same', '-removed', '+added', 'diff --git a/b.json b/b.json', '@@ -0,0 +1 @@', '+{}'].join('\n');
  it('splits a unified diff into files with typed, numbered lines', () => {
    const { files, truncated } = parseDiff(patch);
    expect(truncated).toBe(false);
    expect(files.map((f) => f.file)).toEqual(['src/a.ts', 'b.json']);
    const lines = files[0]!.lines;
    expect(lines.map((l) => l.type)).toEqual(['context', 'context', 'removed', 'added']);
    expect(lines[2]).toMatchObject({ oldLine: 2, content: 'removed' });
    expect(lines[3]).toMatchObject({ newLine: 2, content: 'added' });
  });
  it('treats a bare patch as one file called changes', () => {
    expect(parseDiff('+line').files.map((f) => f.file)).toEqual(['changes']);
  });
  it('draws a disclosure per file with live counts and stops long diffs', () => {
    renderApp(<RunDiff text={patch} />);
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('b.json')).toBeTruthy();
    const long = ['diff --git a/x b/x', '@@ -1 +1 @@', ...Array(3001).fill('+x')].join('\n');
    expect(parseDiff(long).truncated).toBe(true);
    renderApp(<RunDiff text={long} />);
    expect(screen.getByText(/diff truncated/)).toBeTruthy();
  });
});
