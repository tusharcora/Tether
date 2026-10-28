import { useEffect, useState } from 'react';
import { api } from '../api';

/** The diff on show: the path it came from, its text once loaded, or the load error. */
interface DiffState {
  path?: string;
  text?: string;
  error?: string;
}

/**
 * A diff from `path`, refetched when `path`, `key` (e.g. the steps' commits) or a retry changes. A refetch of the same path
 * keeps showing the old text; a different path counts as loading until it lands. No path: nothing to load.
 */
export function useDiff(path: string | undefined, key: string): { path?: string; text?: string; error?: string; loading: boolean; retry: () => void } {
  const [diff, setDiff] = useState<DiffState>({});
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (!path) return setDiff({});
    let cancelled = false;
    setDiff((d) => (d.path === path && d.text !== undefined ? { path, text: d.text } : { path }));
    api<{ diff: string }>('GET', path)
      .then((d) => !cancelled && setDiff({ path, text: d.diff }))
      .catch((e: unknown) => !cancelled && setDiff({ path, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [path, key, retries]);
  // until the effect catches up, a diff from another path counts as loading
  const stale = diff.path !== path;
  return {
    path,
    text: stale ? undefined : diff.text,
    error: stale ? undefined : diff.error,
    loading: !!path && (stale || (diff.text === undefined && !diff.error)),
    retry: () => setRetries((n) => n + 1),
  };
}
