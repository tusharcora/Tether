/**
 * Tether's stand-in for beui's Shiki highlighter (plan: "Code highlighting: lezer, no Shiki"). The lezer parsers behind
 * CodeMirror load lazily, so they share the chunk the Code screen already loads and stay out of the main bundle. Tokens
 * carry a class from tw.css (`tk-kw`, `tk-str`, ...) whose colours are Studio tokens, so both themes follow data-theme.
 * bash, diff and text stay untokenised: file-diff colours its own rows.
 */
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight';
import type { Parser } from '@lezer/common';
import { useEffect, useState } from 'react';

export type AgentCodeLanguage = 'bash' | 'diff' | 'json' | 'text' | 'tsx' | 'typescript';

export interface CodeToken {
  content: string;
  offset: number;
  /** A tw.css highlight class, or none for plain text. */
  cls?: string;
}
export type CodeTokenLines = CodeToken[][];

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], class: 'tk-kw' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: 'tk-str' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'tk-num' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tk-com' },
  { tag: [t.punctuation, t.bracket, t.operator, t.separator], class: 'tk-punc' },
  { tag: t.invalid, class: 'tk-bad' },
]);

const parsers: Partial<Record<AgentCodeLanguage, () => Promise<Parser>>> = {
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.typescriptLanguage.parser),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.tsxLanguage.parser),
  json: () => import('@codemirror/lang-json').then((m) => m.jsonLanguage.parser),
};

const cache = new Map<string, CodeTokenLines>();
const MAX_CACHE = 200;

/** The code's tokens line by line, or undefined for a language without a parser (bash, diff, text). */
export async function tokenize(code: string, language: AgentCodeLanguage): Promise<CodeTokenLines | undefined> {
  const load = parsers[language];
  if (!load) return undefined;
  const key = `${language}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const parser = await load();
  const lines: CodeTokenLines = [[]];
  let offset = 0;
  highlightCode(
    code,
    parser.parse(code),
    highlighter,
    (text, classes) => {
      lines[lines.length - 1]!.push({ content: text, offset, ...(classes ? { cls: classes } : {}) });
      offset += text.length;
    },
    () => {
      lines.push([]);
      offset += 1;
    },
  );
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, lines);
  return lines;
}

/**
 * beui's `useAgentCodeTokens`, on lezer: the tokens once they are ready, else null (plain text meanwhile). While code
 * streams in, the last result keeps showing as long as the new code extends it, so rows never flash back to plain text.
 */
export function useCodeTokens(code: string, language: AgentCodeLanguage): CodeTokenLines | null {
  const [result, setResult] = useState<{ code: string; language: AgentCodeLanguage; lines: CodeTokenLines } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void tokenize(code, language).then((lines) => {
      if (!cancelled && lines) setResult({ code, language, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);
  if (!result || result.language !== language) return null;
  return result.code === code || code.startsWith(result.code) ? result.lines : null;
}
