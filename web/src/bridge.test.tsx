import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { bridge, carriesFiles, droppedFolder, useBridgeEvents } from './bridge';
import { dropOf, fakeBridge } from './test/fixtures';

const asDt = (d: ReturnType<typeof dropOf>) => d as unknown as DataTransfer;

describe('the Tether.app bridge', () => {
  it('is absent in a browser, so nothing reads a dropped path or listens', () => {
    expect(bridge()).toBeUndefined();
    expect(droppedFolder(asDt(dropOf({ name: 'shop', dir: true })))).toBeUndefined();
    const open = vi.fn();
    renderHook(() => useBridgeEvents({ open, command: vi.fn() }));
    fireEvent.drop(window, { dataTransfer: dropOf({ name: 'shop', dir: true }) });
    expect(open).not.toHaveBeenCalled();
  });

  it('reads the path of the first dropped folder, never a file', () => {
    const { b } = fakeBridge();
    expect(bridge()).toBe(b);
    expect(droppedFolder(asDt(dropOf({ name: 'a.txt' }, { name: 'shop', dir: true })))).toBe('/drop/shop');
    expect(droppedFolder(asDt(dropOf({ name: 'a.txt' })))).toBeUndefined();
    expect(carriesFiles(asDt(dropOf()))).toBe(true);
    expect(carriesFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
  });

  it('delivers folders to open, hashes to show and menu commands, says it is ready, and stops on unmount', () => {
    const { b, emit, listeners } = fakeBridge();
    const open = vi.fn();
    const command = vi.fn();
    const { unmount } = renderHook(() => useBridgeEvents({ open, command }));
    expect(b.ready).toHaveBeenCalledTimes(1);
    emit.open('/code/shop');
    expect(open).toHaveBeenCalledWith('/code/shop');
    emit.route('#/runs/r1');
    expect(location.hash).toBe('#/runs/r1');
    emit.command('welcome');
    expect(command).toHaveBeenCalledWith('welcome');
    fireEvent.drop(window, { dataTransfer: dropOf({ name: 'blog', dir: true }) });
    expect(open).toHaveBeenLastCalledWith('/drop/blog');
    unmount();
    expect(listeners.open).toHaveLength(0);
    fireEvent.drop(window, { dataTransfer: dropOf({ name: 'x', dir: true }) });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps a dropped file from replacing the page', () => {
    fakeBridge();
    renderHook(() => useBridgeEvents({ open: vi.fn(), command: vi.fn() }));
    const over = fireEvent.dragOver(window, { dataTransfer: dropOf({ name: 'a.txt' }) });
    const drop = fireEvent.drop(window, { dataTransfer: dropOf({ name: 'a.txt' }) });
    expect(over).toBe(false);
    expect(drop).toBe(false);
  });
});
