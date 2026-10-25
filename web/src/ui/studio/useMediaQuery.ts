import { useEffect, useState } from 'react';

export const PHONE = '(max-width: 899px)';
export const BELOW_WIDE = '(max-width: 1199px)';

/** True while the media query matches; follows changes. False where matchMedia is missing (the wide layout). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query)?.matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    setMatches(m.matches);
    const on = () => setMatches(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}
