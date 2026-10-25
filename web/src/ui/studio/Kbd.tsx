import type { ReactNode } from 'react';
import './parts.css';

export const isApple = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

/** A keyboard hint. `mod` prefixes the platform's command key: ⌘ on Apple, Ctrl elsewhere. */
export function Kbd(props: { mod?: boolean; children: ReactNode }) {
  const prefix = props.mod ? (isApple() ? '⌘' : 'Ctrl ') : '';
  return (
    <kbd className="sl-kbd">
      {prefix}
      {props.children}
    </kbd>
  );
}
