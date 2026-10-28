/**
 * From beui.dev (github.com/starc007/ui-components) `agents/agent-code.tsx`. MIT License, Copyright (c) 2026 Saurabh Chauhan;
 * the full notice is components/beui/LICENSE. Adapted for Tether: Shiki replaced by lezer (lib/highlight.ts); a token carries
 * a tw.css class (`tk-kw`, ...) instead of a light and a dark colour, so both themes follow data-theme.
 */
import { Fragment } from 'react';
import { cn } from '../lib/utils';
import { type AgentCodeLanguage, type CodeToken, useCodeTokens } from '../lib/highlight';

export type { AgentCodeLanguage };
export type AgentCodeToken = CodeToken;
export type AgentCodeTokenLines = CodeToken[][];

/** The tokens of `code` once lezer has loaded, else null (plain text meanwhile). */
export const useAgentCodeTokens = useCodeTokens;

export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
}

export function AgentCodeLine({ code, tokens, className }: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span key={`${token.offset}-${token.content}`} className={token.cls}>
              {token.content}
            </span>
          ))
        : code}
    </span>
  );
}

export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export function AgentCode({ code, language = 'bash', className }: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language);
  let offset = 0;
  const lines = code.split('\n').map((content) => {
    const line = { content, offset };
    offset += content.length + 1;
    return line;
  });
  return (
    <pre className={cn('m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground/85', className)}>
      <code>
        {lines.map((line, index) => (
          <Fragment key={line.offset}>
            <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
            {index < lines.length - 1 ? '\n' : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
