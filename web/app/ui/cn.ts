type Part = string | false | null | undefined | Record<string, boolean>;

export function cn(...parts: Part[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else for (const [k, on] of Object.entries(p)) if (on) out.push(k);
  }
  return out.join(' ');
}

/** Radix Select cannot hold '': "none / default / follow" options use this value instead. */
export const NONE = '__none';
export const fromNone = (v: string): string => (v === NONE ? '' : v);
