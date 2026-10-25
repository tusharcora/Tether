import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { HttpRequestFile, VarInfo } from './client';
import { RequestEditor, urlTokens } from './RequestEditor';

const base: HttpRequestFile = { v: 1, name: 'List runs', method: 'GET', url: '{{base}}/api/runs/{{tok}}?x={{nope}}', query: [], headers: [], body: { kind: 'none' }, vars: { own: 'mine' }, checks: [] };
const vars: Record<string, VarInfo | null> = { base: { source: { from: 'env', env: 'local' }, value: 'http://127.0.0.1:4177' }, tok: { source: { from: 'secret', key: 'aorch_token' }, value: 'SECRET' }, nope: null };

function Harness(p: { onChange?: (f: HttpRequestFile) => void; onSend?: () => void; onSave?: () => void; file?: HttpRequestFile }) {
  const [file, setFile] = useState(p.file ?? base);
  return (
    <RequestEditor
      file={file}
      vars={vars}
      dirty={file !== (p.file ?? base)}
      sending={false}
      onChange={(f) => (setFile(f), p.onChange?.(f))}
      onSend={p.onSend ?? (() => {})}
      onSave={p.onSave ?? (() => {})}
    />
  );
}
const tab = (name: RegExp) => {
  const t = screen.getByRole('tab', { name });
  fireEvent.mouseDown(t);
  fireEvent.click(t);
};

describe('RequestEditor', () => {
  it('splits a URL into text and variables', () => {
    expect(urlTokens('{{base}}/a/{{ id }}')).toEqual([{ var: 'base' }, { text: '/a/' }, { var: 'id' }]);
  });

  it('shows variables as chips whose popover gives the value and source; secrets show only the key', () => {
    render(<Harness />);
    const chip = (name: string) => screen.getByText(name, { selector: '.var-chip > .var-name' }).parentElement!;
    const pop = (name: string) => document.getElementById(chip(name).getAttribute('aria-describedby')!)!.textContent;
    expect(pop('base')).toBe('http://127.0.0.1:4177 · env local');
    expect(pop('tok')).toBe('secret · aorch_token');
    expect(pop('nope')).toBe('not defined');
    expect(chip('nope').getAttribute('data-state')).toBe('missing');
    expect(chip('base').tabIndex).toBe(0);
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('floats the popover outside the scrolling URL box and opens it on hover and on focus', () => {
    render(<Harness />);
    const chip = screen.getByText('base', { selector: '.var-chip > .var-name' }).parentElement!;
    const pop = document.getElementById(chip.getAttribute('aria-describedby')!)!;
    expect(pop.getAttribute('role')).toBe('tooltip');
    expect(chip.closest('.url-view')!.contains(pop)).toBe(false);
    expect(pop.closest('.urlbar')).toBeTruthy();
    expect(pop.hasAttribute('data-open')).toBe(false);
    fireEvent.mouseEnter(chip);
    expect(pop.hasAttribute('data-open')).toBe(true);
    fireEvent.mouseLeave(chip);
    expect(pop.hasAttribute('data-open')).toBe(false);
    fireEvent.focus(chip);
    expect(pop.hasAttribute('data-open')).toBe(true);
    fireEvent.blur(chip);
    expect(pop.hasAttribute('data-open')).toBe(false);
  });

  it('edits the URL in place', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('textbox', { name: 'URL' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value: '{{base}}/v2' } });
    expect(onChange.mock.calls.at(-1)![0].url).toBe('{{base}}/v2');
    expect(screen.getByText('unsaved', { exact: false })).toBeTruthy();
  });

  it('adds a query parameter and a header', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('New parameter name'), { target: { value: 'limit' } });
    fireEvent.change(screen.getByLabelText('New parameter value'), { target: { value: '{{limit}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }));
    expect(onChange.mock.calls.at(-1)![0].query).toEqual([{ key: 'limit', value: '{{limit}}', on: true }]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use parameter limit' }));
    expect(onChange.mock.calls.at(-1)![0].query[0].on).toBe(false);
    tab(/Headers/);
    fireEvent.change(screen.getByLabelText('New header name'), { target: { value: 'Accept' } });
    fireEvent.change(screen.getByLabelText('New header value'), { target: { value: 'application/json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    expect(onChange.mock.calls.at(-1)![0].headers).toEqual([{ key: 'Accept', value: 'application/json', on: true }]);
  });

  it('JSON body: keeps the last valid value while the text is not JSON yet', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab(/Body/);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(onChange.mock.calls.at(-1)![0].body).toEqual({ kind: 'json', value: {} });
    const n = onChange.mock.calls.length;
    fireEvent.change(screen.getByLabelText('JSON body'), { target: { value: '{"a": ' } });
    expect(onChange.mock.calls.length).toBe(n);
    expect(screen.getByText('not valid JSON yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('JSON body'), { target: { value: '{"a": 1}' } });
    expect(onChange.mock.calls.at(-1)![0].body).toEqual({ kind: 'json', value: { a: 1 } });
  });

  it('adds and edits checks', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab(/Checks/);
    fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
    expect(onChange.mock.calls.at(-1)![0].checks).toEqual([{ kind: 'status', op: 'eq', value: 200 }]);
    fireEvent.change(screen.getByLabelText('Check 1 kind'), { target: { value: 'json' } });
    fireEvent.change(screen.getByLabelText('Check 1 path'), { target: { value: '$[0].id' } });
    fireEvent.change(screen.getByLabelText('Check 1 op'), { target: { value: 'exists' } });
    expect(onChange.mock.calls.at(-1)![0].checks).toEqual([{ kind: 'json', path: '$[0].id', op: 'exists' }]);
  });

  it('keeps a check value as typed while it is half-written', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab(/Checks/);
    fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
    fireEvent.change(screen.getByLabelText('Check 1 op'), { target: { value: 'in' } });
    const value = screen.getByLabelText('Check 1 value') as HTMLInputElement;
    fireEvent.focus(value);
    for (const t of ['200', '200,', '200,2', '200,201']) {
      fireEvent.change(value, { target: { value: t } });
      expect(value.value).toBe(t);
    }
    expect(onChange.mock.calls.at(-1)![0].checks).toEqual([{ kind: 'status', op: 'in', value: [200, 201] }]);
    fireEvent.change(value, { target: { value: '' } });
    expect(value.value).toBe('');
  });

  it('opens the URL for editing from the keyboard and closes it with Escape', () => {
    render(<Harness />);
    const view = screen.getByRole('textbox', { name: 'URL' });
    expect(view.tagName).toBe('DIV');
    fireEvent.keyDown(view, { key: 'Enter' });
    const input = screen.getByRole('textbox', { name: 'URL' }) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('textbox', { name: 'URL' }).tagName).toBe('DIV');
  });

  it('does not send twice while a send is in flight', () => {
    const onSend = vi.fn();
    render(<RequestEditor file={base} vars={vars} dirty={false} sending onChange={() => {}} onSend={onSend} onSave={() => {}} />);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps a variable while its name is cleared and retyped', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab(/Vars/);
    fireEvent.change(screen.getByLabelText('Variable name 1'), { target: { value: '' } });
    expect((screen.getByLabelText('Variable value 1') as HTMLInputElement).value).toBe('mine');
    fireEvent.change(screen.getByLabelText('Variable name 1'), { target: { value: 'own2' } });
    expect(onChange.mock.calls.at(-1)![0].vars).toEqual({ own2: 'mine' });
  });

  it('flags a duplicate variable name and keeps both values until it is resolved', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab(/Vars/);
    fireEvent.change(screen.getByLabelText('New variable name'), { target: { value: 'own' } });
    fireEvent.change(screen.getByLabelText('New variable value'), { target: { value: 'theirs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    expect(screen.getByRole('alert').textContent).toContain('own');
    expect(screen.getByLabelText('Variable name 2').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('Variable value 1') as HTMLInputElement).value).toBe('mine');
    expect((screen.getByLabelText('Variable value 2') as HTMLInputElement).value).toBe('theirs');
    expect(onChange.mock.calls.at(-1)?.[0].vars ?? base.vars).toEqual({ own: 'mine' });
    tab(/Params/);
    tab(/Vars/);
    expect((screen.getByLabelText('Variable value 2') as HTMLInputElement).value).toBe('theirs');
    fireEvent.change(screen.getByLabelText('Variable name 2'), { target: { value: 'other' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange.mock.calls.at(-1)![0].vars).toEqual({ own: 'mine', other: 'theirs' });
  });

  it('edits request vars', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab(/Vars/);
    fireEvent.change(screen.getByLabelText('Variable value 1'), { target: { value: 'yours' } });
    expect(onChange.mock.calls.at(-1)![0].vars).toEqual({ own: 'yours' });
  });

  it('⌘↵ sends and ⌘S saves', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    render(<Harness onSend={onSend} onSave={onSave} />);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })));
    expect(onSend).toHaveBeenCalledTimes(1);
    const ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    act(() => void window.dispatchEvent(ev));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;
const read = (p: string) => readFileSync(new URL(p, here), 'utf8');

describe('API tab styles', () => {
  it('keeps purple, gradients and glows out of the editor styles', () => {
    const css = read('./api.css');
    expect(css).not.toMatch(/purple|violet|#7747ff|#a78bff|#9333ea/i);
    expect(css).not.toMatch(/(linear|radial|conic)-gradient\(/);
    expect(css).not.toMatch(/box-shadow:\s*0 0 \d+px/);
  });

  it('slides the tab underline on the Studio Live curve instead of Arc\'s spring', () => {
    const css = read('./api.css');
    expect(css).toMatch(/\.req-tabs \[role="tab"\] > span\[aria-hidden="true"\] \{ display: none; \}/);
    const line = css.slice(css.indexOf('.tab-line[data-slides] {'), css.indexOf('}', css.indexOf('.tab-line[data-slides] {')));
    expect(line).toContain('var(--t-med) var(--ease)');
    render(<Harness />);
    const el = document.querySelector('.req-tabs-wrap .tab-line')!;
    // the first placement (the editor remounts per request) does not slide in from the corner; a tab switch does
    expect(el.hasAttribute('data-slides')).toBe(false);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Headers/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Headers/ }));
    expect(el.hasAttribute('data-slides')).toBe(true);
  });

  it('bridges every accent and control colour the Arc parts used here read, so the root violet accent never shows', () => {
    const studio = read('../studio.css');
    for (const part of ['button/button', 'segmented-control/segmented-control', 'tabs/tabs', 'textarea/textarea', 'search-field/search-field', 'select/select', 'empty-state/empty-state', 'dialog/dialog']) {
      const used = new Set([...read(`../components/arc/${part}.module.css`).matchAll(/var\((--(?:accent|control-(?!height))[a-z-]*)/g)].map((m) => m[1]!));
      for (const v of used) expect(studio, `${part} reads ${v}`).toContain(`${v}: var(`);
    }
  });
});
