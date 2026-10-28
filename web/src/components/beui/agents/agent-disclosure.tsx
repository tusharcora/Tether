/**
 * From beui.dev (github.com/starc007/ui-components) `agents/agent-disclosure.tsx`. MIT License, Copyright (c) 2026 Saurabh Chauhan; the
 * full notice is components/beui/LICENSE. Adapted for Tether: relative imports, Studio tokens through tw.css, lezer instead
 * of Shiki, no metallic or magnetic variants.
 */

import { motion, type HTMLMotionProps, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { EASE_OUT } from "../lib/ease";
import { cn } from "../lib/utils";

export interface AgentDisclosureProps
  extends Omit<HTMLMotionProps<"div">, "animate" | "initial"> {
  open: boolean;
  openHeight?: CSSProperties["height"];
}

/** Shared transform-only reveal for collapsible agent content. */
export function AgentDisclosure({
  open,
  openHeight = "auto",
  className,
  style,
  transition,
  ...props
}: AgentDisclosureProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <motion.div
      {...props}
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={
        reduce
          ? { opacity: open ? 1 : 0 }
          : {
              opacity: open ? 1 : 0,
              clipPath: open ? "inset(0 0 0% 0)" : "inset(0 0 100% 0)",
              y: open ? 0 : -4,
            }
      }
      transition={
        transition ?? {
          duration: reduce ? 0 : open ? 0.22 : 0.14,
          ease: EASE_OUT,
        }
      }
      className={cn("overflow-hidden", className)}
      style={{
        ...style,
        height: open ? openHeight : 0,
        pointerEvents: open ? undefined : "none",
        transformOrigin: "top",
      }}
    />
  );
}
