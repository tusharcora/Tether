import { useEffect, useRef } from 'react';

/**
 * The shell's Create menu hands a screen a counter (`create`) when the person asks for a new workflow, bot, trigger or
 * request. The screen runs its own "new" action once, as soon as it is `ready` (its data has loaded, so the load cannot
 * replace the new thing), and never again for the same counter: the shell drops it a moment later.
 */
export function useCreateIntent(create: number | undefined, ready: boolean, run: () => void): void {
  const want = useRef(false);
  const seen = useRef<number | undefined>(undefined);
  if (create !== undefined && create !== seen.current) {
    seen.current = create;
    want.current = true;
  }
  const act = useRef(run);
  act.current = run;
  useEffect(() => {
    if (!want.current || !ready) return;
    want.current = false;
    act.current();
  });
}
