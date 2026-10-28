/**
 * From beui.dev (github.com/starc007/ui-components) `motion/action-swap-roll.tsx`. MIT License, Copyright (c) 2026 Saurabh Chauhan; the
 * full notice is components/beui/LICENSE. Adapted for Tether: relative imports, Studio tokens through tw.css, lezer instead
 * of Shiki, no metallic or magnetic variants.
 */

import {
  ActionSwapButton,
  ActionSwapIcon,
  ActionSwapText,
  type ActionSwapButtonProps,
  type ActionSwapIconProps,
  type ActionSwapTextProps,
} from "./action-swap";

export type {
  ActionSwapButtonSize,
  ActionSwapButtonVariant,
  ActionSwapItem,
} from "./action-swap";

export type ActionSwapRollButtonProps = Omit<ActionSwapButtonProps, "animation">;
export type ActionSwapRollTextProps = Omit<ActionSwapTextProps, "animation">;
export type ActionSwapRollIconProps = Omit<ActionSwapIconProps, "animation">;

export function ActionSwapRollButton(props: ActionSwapRollButtonProps) {
  return <ActionSwapButton {...props} animation="roll" />;
}

export function ActionSwapRollText(props: ActionSwapRollTextProps) {
  return <ActionSwapText {...props} animation="roll" />;
}

export function ActionSwapRollIcon(props: ActionSwapRollIconProps) {
  return <ActionSwapIcon {...props} animation="roll" />;
}
