import { useMemo } from 'react';
import { useToastStack } from '../components/arc/toast-stack/toast-stack';

/** Toasts for action results. Load failures are shown inline by the screen instead. */
export function useNotify() {
  const { toast } = useToastStack();
  return useMemo(
    () => ({
      ok: (title: string, description?: string) => void toast({ type: 'success', title, description }),
      info: (title: string) => void toast({ type: 'info', title }),
      fail: (e: unknown) => void toast({ type: 'error', title: e instanceof Error ? e.message : String(e) }),
    }),
    [toast],
  );
}
