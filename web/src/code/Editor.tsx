import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, RangeSet, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, gutterLineClass, GutterMarker, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { tetherHighlight, tetherTheme } from './cmTheme';
import type { CodeLang } from './codeApi';
import { LANGS } from './langs';

export type Hunk = { start: number; lines: number };
/** A run that touched the file: the lines it changed, whether it is live, whether it is the one picked in the runs panel. */
export type RunMarks = { hunks: Hunk[]; live: boolean; picked?: boolean };

/** How long a line opened from search or a link keeps its highlight before it fades. */
export const FLASH_MS = 2400;

const setRuns = StateEffect.define<RunMarks[]>();
const setFlash = StateEffect.define<number | null>();
const gutterMark = (cls: string) =>
  new (class extends GutterMarker {
    elementClass = cls;
  })();
const liveGutter = gutterMark('cm-run-live');
const doneGutter = gutterMark('cm-run-done');
const pickLine = Decoration.line({ class: 'cm-run-line' });
const pickLiveLine = Decoration.line({ class: 'cm-run-line cm-run-line-live' });
const flashLine = Decoration.line({ class: 'cm-flash' });

/** The line numbers `hunks` cover, inside the document, in order (a pure deletion covers no line). */
function lineNos(doc: Text, hunks: Hunk[]): number[] {
  const lines = new Set<number>();
  for (const h of hunks) for (let n = h.start; n < h.start + h.lines; n++) if (n >= 1 && n <= doc.lines) lines.add(n);
  return [...lines].sort((a, b) => a - b);
}

/**
 * Every run's changed lines as a bar on their number (blue where a live run touched the line, else green), and the
 * picked run's lines tinted (blue if it is live, green if done).
 */
const marksField = StateField.define<{ deco: DecorationSet; gutter: RangeSet<GutterMarker> }>({
  create: () => ({ deco: Decoration.none, gutter: RangeSet.empty }),
  update(v, tr) {
    for (const e of tr.effects)
      if (e.is(setRuns)) {
        const doc = tr.state.doc;
        const at = (n: number) => doc.line(n).from;
        const live = new Set(lineNos(doc, e.value.filter((r) => r.live).flatMap((r) => r.hunks)));
        const pick = e.value.find((r) => r.picked);
        return {
          deco: pick ? Decoration.set(lineNos(doc, pick.hunks).map((n) => (pick.live ? pickLiveLine : pickLine).range(at(n)))) : Decoration.none,
          gutter: RangeSet.of(lineNos(doc, e.value.flatMap((r) => r.hunks)).map((n) => (live.has(n) ? liveGutter : doneGutter).range(at(n)))),
        };
      }
    return tr.docChanged ? { deco: v.deco.map(tr.changes), gutter: v.gutter.map(tr.changes) } : v;
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), gutterLineClass.from(f, (v) => v.gutter)],
});

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFlash)) return e.value && e.value <= tr.state.doc.lines ? Decoration.set([flashLine.range(tr.state.doc.line(e.value).from)]) : Decoration.none;
    return v.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface EditorProps {
  /** The document's identity: a new key shows `text` as a new document; going back to a key brings back its edits and undo history. */
  docKey: string;
  text: string;
  lang: CodeLang;
  readOnly: boolean;
  label: string;
  onChange: (text: string) => void;
  /** The runs that touched the file (gutter bars for all, a tint for the picked one). */
  runs?: RunMarks[];
  /** Scroll to a line and highlight it briefly; a new `seq` repeats it. */
  flash?: { line: number; seq: number };
  /** The cursor's 1-based line and column, on every move and when a document is shown. */
  onCursor?: (line: number, col: number) => void;
}

const cursorOf = (s: EditorState) => {
  const at = s.selection.main.head;
  const line = s.doc.lineAt(at);
  return [line.number, at - line.from + 1] as const;
};

/** CodeMirror 6 in Studio Live tokens: line numbers, history, search (⌘F), bracket matching, read-only by default upstream. */
export function Editor(p: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const shown = useRef<string>(undefined);
  const states = useRef(new Map<string, EditorState>());
  const parts = useRef({ lang: new Compartment(), readOnly: new Compartment() });
  const onChange = useRef(p.onChange);
  onChange.current = p.onChange;
  const onCursor = useRef(p.onCursor);
  onCursor.current = p.onCursor;

  const fresh = (text: string) =>
    EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        syntaxHighlighting(tetherHighlight),
        tetherTheme,
        parts.current.lang.of(LANGS[p.lang].ext()),
        parts.current.readOnly.of(EditorState.readOnly.of(p.readOnly)),
        EditorView.contentAttributes.of({ 'aria-label': p.label }),
        marksField,
        flashField,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange.current(u.state.doc.toString());
          if (u.selectionSet) onCursor.current?.(...cursorOf(u.state));
        }),
      ],
    });

  useEffect(() => {
    view.current = new EditorView({ parent: host.current! });
    return () => view.current?.destroy();
  }, []);

  // show the document for this key: its kept state (edits, undo, selection) or a new one from `text`
  useEffect(() => {
    const v = view.current!;
    if (shown.current !== undefined) states.current.set(shown.current, v.state);
    v.setState(states.current.get(p.docKey) ?? fresh(p.text));
    shown.current = p.docKey;
    onCursor.current?.(...cursorOf(v.state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.docKey]);
  useEffect(() => {
    view.current!.dispatch({ effects: [parts.current.lang.reconfigure(LANGS[p.lang].ext()), parts.current.readOnly.reconfigure(EditorState.readOnly.of(p.readOnly))] });
  }, [p.docKey, p.lang, p.readOnly]);
  useEffect(() => {
    view.current!.dispatch({ effects: setRuns.of(p.runs ?? []) });
  }, [p.docKey, p.runs]);
  useEffect(() => {
    const v = view.current!;
    const f = p.flash;
    if (!f || f.line < 1 || f.line > v.state.doc.lines) return;
    const at = v.state.doc.line(f.line).from;
    v.dispatch({ selection: { anchor: at }, effects: [setFlash.of(f.line), EditorView.scrollIntoView(at, { y: 'center' })] });
    const t = setTimeout(() => view.current?.dispatch({ effects: setFlash.of(null) }), FLASH_MS);
    return () => clearTimeout(t);
  }, [p.docKey, p.flash]);

  return <div ref={host} className="code-editor" />;
}
