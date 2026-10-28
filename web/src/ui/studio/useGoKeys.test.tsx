import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GO_WINDOW_MS, useGoKeys } from './useGoKeys';

const press = (key: string, target: Window | Element = window, o: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key, ...o });

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useGoKeys', () => {
  it('goes to a screen with G then its letter', () => {
    const onGo = vi.fn();
    renderHook(() => useGoKeys(onGo, vi.fn()));
    const pairs: [string, string][] = [['c', 'code'], ['b', 'builder'], ['r', 'crew'], ['a', 'api'], ['g', 'graph'], ['t', 'triggers'], ['h', 'home'], ['i', 'inbox'], ['u', 'runs']];
    for (const [k] of pairs) press('g'), press(k);
    expect(onGo.mock.calls.map((c) => c[0])).toEqual(pairs.map(([, s]) => s));
  });

  it('composes with C alone, and an unknown second key does nothing', () => {
    const onGo = vi.fn();
    const onCompose = vi.fn();
    renderHook(() => useGoKeys(onGo, onCompose));
    press('c');
    expect(onCompose).toHaveBeenCalledTimes(1);
    press('g');
    press('x');
    press('c');
    expect(onGo).not.toHaveBeenCalled();
    expect(onCompose).toHaveBeenCalledTimes(2);
  });

  it('waits only a second for the second key', () => {
    vi.useFakeTimers();
    const onGo = vi.fn();
    renderHook(() => useGoKeys(onGo, vi.fn()));
    press('g');
    vi.advanceTimersByTime(GO_WINDOW_MS + 50);
    press('b');
    expect(onGo).not.toHaveBeenCalled();
  });

  it('ignores keys typed in a field, with a modifier, or while a dialog is open', () => {
    const onGo = vi.fn();
    const onCompose = vi.fn();
    renderHook(() => useGoKeys(onGo, onCompose));
    const input = document.body.appendChild(document.createElement('input'));
    press('g', input);
    press('c', input);
    press('g', window, { metaKey: true });
    press('c', window, { ctrlKey: true });
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    press('g');
    press('c');
    expect(onGo).not.toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
  });
});
