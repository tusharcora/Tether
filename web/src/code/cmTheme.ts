import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * The editor in Studio Live: every colour is a token, so it follows the theme with no second palette (and no purple).
 * Keywords ink 600, strings green, numbers amber, comments muted italic. Every line a run changed gets a bar on its number
 * (blue while the run is live, green when done); the picked run's lines are tinted. Selection, search matches, the current
 * line and the line opened from search are neutral (blue means live).
 */
export const tetherTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--bg)', fontSize: '12.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.65' },
  '.cm-content': { caretColor: 'var(--ink)', padding: '10px 0' },
  '.cm-line': { paddingRight: '16px', transition: 'background-color var(--t-slow) var(--ease)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--s3)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--mut)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '32px', padding: '0 12px 0 8px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ink) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--s3)', color: 'inherit' },
  '.cm-searchMatch': { backgroundColor: 'var(--s2)', outline: '1px solid var(--edge)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--s3)', outline: '1px solid var(--ink)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--s2)' },
  '.cm-panels': { backgroundColor: 'var(--s1)', color: 'var(--ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit', color: 'var(--ink)' },
  '.cm-textfield': { backgroundColor: 'var(--s1)', border: '1px solid var(--edge)', borderRadius: '6px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--s2)', border: '1px solid var(--line2)', borderRadius: '6px' },
  '.cm-tooltip': { backgroundColor: 'var(--s1)', color: 'var(--ink)', border: '1px solid var(--line2)' },
  '.cm-run-line': { backgroundColor: 'color-mix(in srgb, var(--ok) 8%, transparent)' },
  '.cm-run-line.cm-run-line-live': { backgroundColor: 'var(--accBg)' },
  '.cm-gutterElement.cm-run-done': { boxShadow: 'inset 3px 0 0 var(--ok)' },
  '.cm-gutterElement.cm-run-live': { boxShadow: 'inset 3px 0 0 var(--acc)' },
  '.cm-flash': { backgroundColor: 'color-mix(in srgb, var(--ink) 16%, transparent)', boxShadow: 'inset 3px 0 0 var(--ink)' },
});

export const tetherHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: 'var(--ink)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--ok)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--warn)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--mut)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.operator, t.separator], color: 'var(--mut)' },
  { tag: [t.heading, t.strong], fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--bad)' },
]);
