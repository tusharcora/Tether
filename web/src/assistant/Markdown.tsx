import { createElement, Fragment, type ReactNode } from 'react';
import { CodeBlock } from '../components/beui/agents/code-block';
import { Citation } from '../components/beui/agents/citations';
import type { AgentCodeLanguage } from '../components/beui/agents/agent-code';

/**
 * A small Markdown renderer for the assistant's replies and Markdown artifacts (no dependency): headings, paragraphs, bullet and numbered lists, fenced code
 * (a CodeBlock), and inline `code`, **bold**, *italic* and [n] citation markers. Everything is React text, never HTML.
 * While a reply streams, an unclosed fence or marker simply shows as it is until it closes.
 */
export interface MarkdownProps {
  text: string;
  /** Citation numbers that exist: `[n]` becomes the marker chip for those. */
  cites?: Set<number>;
  idPrefix?: string;
  onCite?: (n: number) => void;
}

const LANGS: Record<string, AgentCodeLanguage> = { ts: 'typescript', typescript: 'typescript', tsx: 'tsx', jsx: 'tsx', js: 'typescript', javascript: 'typescript', json: 'json', bash: 'bash', sh: 'bash', shell: 'bash', diff: 'diff' };

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![*\w])\*([^*\n]+)\*(?!\*)|\[(\d{1,2})\]/g;

export function inline(text: string, o: Pick<MarkdownProps, 'cites' | 'idPrefix' | 'onCite'>, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (m[4] !== undefined && !o.cites?.has(Number(m[4]))) continue;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}${at}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], o, `${k}b`)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], o, `${k}i`)}</em>);
    else {
      const n = Number(m[4]);
      out.push(<Citation key={k} citationId={`c${n}`} index={n} idPrefix={o.idPrefix ?? 'cite'} onOpen={o.onCite ? () => o.onCite!(n) : undefined} />);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { t: 'p'; text: string } | { t: 'h'; level: number; text: string } | { t: 'ul' | 'ol'; items: string[] } | { t: 'code'; lang: string; code: string };

const HEADING = /^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/;
/** `#` is the document's top heading: one level under the screen's own. */
const H_CLASS = ['', 'text-lg', 'text-base', 'text-sm', 'text-sm'];

export function blocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      out.push({ t: 'code', lang: fence[1]!.toLowerCase(), code: code.join('\n') });
    } else if (HEADING.test(line)) {
      const h = HEADING.exec(line)!;
      out.push({ t: 'h', level: h[1]!.length, text: h[2]! });
      i++;
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      out.push({ t: ordered ? 'ol' : 'ul', items });
    } else if (!line.trim()) i++;
    else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^\s*```/.test(lines[i]!) && !HEADING.test(lines[i]!) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) para.push(lines[i++]!);
      out.push({ t: 'p', text: para.join('\n') });
    }
  }
  return out;
}

export function Markdown({ text, ...o }: MarkdownProps) {
  return (
    <>
      {blocks(text).map((b, i) =>
        b.t === 'p' ? (
          <p key={i} className="m-0 [&+*]:mt-3">
            {inline(b.text, o)}
          </p>
        ) : b.t === 'h' ? (
          createElement(`h${b.level + 1}`, { key: i, className: `mt-4 mb-2 font-semibold leading-snug first:mt-0 ${H_CLASS[b.level]}` }, inline(b.text, o))
        ) : b.t === 'code' ? (
          <div key={i} className="my-3">
            <CodeBlock code={b.code} language={LANGS[b.lang] ?? 'text'} status="complete" filename={b.lang || undefined} />
          </div>
        ) : (
          <Fragment key={i}>
            {b.t === 'ul' ? (
              <ul>{b.items.map((it, j) => <li key={j}>{inline(it, o, `${j}-`)}</li>)}</ul>
            ) : (
              <ol>{b.items.map((it, j) => <li key={j}>{inline(it, o, `${j}-`)}</li>)}</ol>
            )}
          </Fragment>
        ),
      )}
    </>
  );
}
