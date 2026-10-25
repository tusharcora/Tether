import type { ReactNode } from 'react';
import './parts.css';

export const isApple = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

/** A keyboard hint. `mod` prefixes the platform's command key: ⌘ on Apple, Ctrl elsewhere. */
export function Kbd(props: { mod?: boolean; children: ReactNode }) {
  // the ⌘ glyph is named for screen readers; "Ctrl" reads fine as text
  const prefix = props.mod ? (isApple() ? <span role="img" aria-label="Command">⌘</span> : 'Ctrl ') : '';
  return (
    <kbd className="sl-kbd">
      {prefix}
      {props.children}
    </kbd>
  );
}
