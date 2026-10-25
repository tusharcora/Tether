import { AsciiReveal, AsciiSkeleton } from 'ascii-reveal';
import { useEffect, useState, type ReactNode } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** True while the person asks for reduced motion; follows changes live. */
export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY)?.matches);
  useEffect(() => {
    const m = window.matchMedia?.(QUERY);
    if (!m?.addEventListener) return;
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

export interface LoadingProps {
  /** True while the content is on its way: a skeleton holds its place. */
  loading: boolean;
  /** Text-shaped placeholder: this many lines (default 4). */
  lines?: number;
  /** Block-shaped placeholder instead of lines (a JSON body, a chart). */
  rows?: number;
  /** Accessible name while loading. */
  label?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * The one loading look in aorch: a dithered ASCII skeleton where the content will land, then the content decodes in.
 * Under reduced motion the skeleton is still and the content simply appears. Screens use this, never their own skeleton.
 */
export function Loading({ loading, lines = 4, rows, label = 'Loading', className, children }: LoadingProps) {
  const reduced = useReducedMotionPref();
  const busy = loading ? { role: 'status', 'aria-label': label, 'aria-busy': true } : {};
  const skeleton = <AsciiSkeleton variant="dither" lines={rows ? undefined : lines} rows={rows} animate={!reduced} seed={7} aria-hidden="true" />;
  if (reduced)
    return (
      <div className={className} {...busy}>
        {loading ? skeleton : children}
      </div>
    );
  return (
    <AsciiReveal className={className} loading={loading} preset="decode" duration="fast" revealOnMount={false} {...busy}>
      {loading ? skeleton : children}
    </AsciiReveal>
  );
}
