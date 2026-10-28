/**
 * From beui.dev (github.com/starc007/ui-components) `lib/hooks/use-hover-capable.ts`. MIT License, Copyright (c) 2026 Saurabh Chauhan; the
 * full notice is components/beui/LICENSE. Adapted for Tether: relative imports, Studio tokens through tw.css, lezer instead
 * of Shiki, no metallic or magnetic variants.
 */

import { useEffect, useState } from "react";

/**
 * Returns true only on devices that have a true hover (mouse / trackpad).
 * Touch devices fire phantom `:hover` on tap that sticks until tap-elsewhere
 * — gate hover-only effects (scale lifts, magnetic pulls) behind this.
 */
export function useHoverCapable() {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  return canHover;
}
