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

  it('marks the lines a run changed and clears them', () => {
    const { container, rerender } = render(<Editor {...base} marks={[{ start: 2, lines: 2 }, { start: 9, lines: 1 }]} />);
    const marked = () => [...container.querySelectorAll('.cm-line.cm-run-line')].map((l) => l.textContent);
    expect(marked()).toEqual(['// two', 'let b = "s";']);
    rerender(<Editor {...base} marks={[]} />);
    expect(marked()).toEqual([]);
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
