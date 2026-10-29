import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Editor, FLASH_MS, type EditorProps } from './Editor';

const TEXT = 'const a = 1;\n// two\nlet b = "s";\nfour\n';
const base: EditorProps = { docKey: 'a.ts#1', text: TEXT, lang: 'typescript', readOnly: true, label: 'Edit a.ts', onChange: () => {} };
const viewOf = (c: HTMLElement) => EditorView.findFromDOM(c.querySelector('.cm-editor') as HTMLElement)!;

describe('Editor', () => {
  it('shows the text with line numbers, named for screen readers, in the file’s language', () => {
    const { container } = render(<Editor {...base} />);
    const v = viewOf(container);
    expect(v.state.doc.toString()).toBe(TEXT);
    expect(container.querySelector('.cm-content')!.getAttribute('aria-label')).toBe('Edit a.ts');
    expect(container.querySelector('.cm-lineNumbers')).toBeTruthy();
    expect(v.state.facet(language)?.name).toBe('typescript');
  });

  it('is read-only in View and editable in Edit, reporting changes', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<Editor {...base} onChange={onChange} />);
    expect(viewOf(container).state.readOnly).toBe(true);
    rerender(<Editor {...base} readOnly={false} onChange={onChange} />);
    const v = viewOf(container);
    expect(v.state.readOnly).toBe(false);
    act(() => v.dispatch({ changes: { from: 0, insert: 'x' } }));
    expect(onChange).toHaveBeenLastCalledWith(`x${TEXT}`);
  });

  it('keeps each document’s edits when switching keys, and starts fresh for a new key', () => {
    const { container, rerender } = render(<Editor {...base} readOnly={false} />);
    act(() => viewOf(container).dispatch({ changes: { from: 0, insert: 'edited ' } }));
    rerender(<Editor {...base} docKey="b.json#1" text="{}" lang="json" readOnly={false} />);
    expect(viewOf(container).state.doc.toString()).toBe('{}');
    expect(viewOf(container).state.facet(language)?.name).toBe('json');
    rerender(<Editor {...base} readOnly={false} />);
    expect(viewOf(container).state.doc.toString()).toBe(`edited ${TEXT}`);
    rerender(<Editor {...base} docKey="a.ts#2" text="reloaded" readOnly={false} />);
    expect(viewOf(container).state.doc.toString()).toBe('reloaded');
  });

  it('marks every run in the gutter; live wins; the picked run is tinted', () => {
    // a hunk past the end (the run's version was longer) and a pure deletion mark nothing
    const runs = [
      { hunks: [{ start: 1, lines: 2 }], live: true },
      { hunks: [{ start: 2, lines: 2 }, { start: 9, lines: 1 }, { start: 4, lines: 0 }], live: false, picked: true },
    ];
    const { container, rerender } = render(<Editor {...base} runs={runs} />);
    const gutter = (cls: string) => [...container.querySelectorAll(`.cm-gutterElement.${cls}`)].map((e) => e.textContent);
    const tinted = () => [...container.querySelectorAll('.cm-line.cm-run-line')].map((l) => l.textContent);
    expect(gutter('cm-run-live')).toEqual(['1', '2']);
    expect(gutter('cm-run-done')).toEqual(['3']);
    expect(tinted()).toEqual(['// two', 'let b = "s";']);
    expect(container.querySelector('.cm-run-line-live')).toBeNull();
    rerender(<Editor {...base} runs={[{ ...runs[0]!, picked: true }]} />);
    expect(container.querySelectorAll('.cm-line.cm-run-line.cm-run-line-live')).toHaveLength(2);
    rerender(<Editor {...base} runs={[]} />);
    expect([...gutter('cm-run-live'), ...gutter('cm-run-done'), ...tinted()]).toEqual([]);
  });

  it('reports the cursor line and column', () => {
    const onCursor = vi.fn();
    const { container } = render(<Editor {...base} onCursor={onCursor} />);
    expect(onCursor).toHaveBeenLastCalledWith(1, 1);
    act(() => viewOf(container).dispatch({ selection: { anchor: TEXT.indexOf('two') } }));
    expect(onCursor).toHaveBeenLastCalledWith(2, 4);
  });

  it('highlights a line it was asked to show, then lets it fade', () => {
    vi.useFakeTimers();
    const { container } = render(<Editor {...base} flash={{ line: 3, seq: 1 }} />);
    expect(container.querySelector('.cm-flash')!.textContent).toBe('let b = "s";');
    expect(viewOf(container).state.selection.main.head).toBe(TEXT.indexOf('let'));
    act(() => vi.advanceTimersByTime(FLASH_MS));
    expect(container.querySelector('.cm-flash')).toBeNull();
  });
});
