import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';
import type { CodeLang } from './codeApi';

/** The CodeMirror language for a file the server named, and the name shown in the file bar. */
export const LANGS: Record<CodeLang, { label: string; ext: () => Extension }> = {
  typescript: { label: 'TypeScript', ext: () => javascript({ typescript: true }) },
  tsx: { label: 'TypeScript JSX', ext: () => javascript({ typescript: true, jsx: true }) },
  javascript: { label: 'JavaScript', ext: () => javascript() },
  jsx: { label: 'JavaScript JSX', ext: () => javascript({ jsx: true }) },
  json: { label: 'JSON', ext: () => json() },
  markdown: { label: 'Markdown', ext: () => markdown() },
  css: { label: 'CSS', ext: () => css() },
  html: { label: 'HTML', ext: () => html() },
  python: { label: 'Python', ext: () => python() },
  text: { label: 'Plain text', ext: () => [] },
};
