import { forwardRef, type ReactNode } from 'react';
import { Button as BeuiButton, type ButtonProps as BeuiButtonProps } from '../motion/button';
import { cn } from '../lib/utils';

/**
 * Tether's button: beui's spring-pressed Button on Studio tokens. Ink primary, hairline secondary, quiet ghost, red-text danger;
 * 36 / 44 / 50 px tall with the Studio control radius (no pills). `loading` keeps the button focusable and swallows presses.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';
export interface ButtonProps extends Omit<BeuiButtonProps, 'variant' | 'size' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<ButtonVariant, { beui: NonNullable<BeuiButtonProps['variant']>; cls: string }> = {
  primary: { beui: 'primary', cls: 'bg-primary text-primary-foreground hover:bg-primary/90' },
  secondary: { beui: 'secondary', cls: 'border border-border bg-card text-foreground hover:bg-muted' },
  ghost: { beui: 'ghost', cls: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground' },
  danger: { beui: 'secondary', cls: 'border border-border bg-card text-destructive hover:border-destructive hover:bg-muted' },
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 gap-2 rounded-lg px-3 text-sm',
  md: 'h-11 gap-2 rounded-lg px-4 text-sm',
  lg: 'h-[3.125rem] gap-2 rounded-lg px-5 text-sm',
  icon: 'size-9 rounded-lg p-0 text-sm',
};

/** A Button's look, for a native button someone else draws (the create menu's trigger). */
export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'sm') =>
  cn('inline-flex cursor-pointer select-none items-center justify-center font-medium', SIZE[size], VARIANT[variant].cls, 'whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring');

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, className, disabled, onClick, children, ...rest },
  ref,
) {
  const v = VARIANT[variant];
  return (
    <BeuiButton
      ref={ref}
      variant={v.beui}
      size={size === 'icon' ? 'icon' : size}
      pressScale={0.97}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      className={cn(SIZE[size], v.cls, 'whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', loading && 'cursor-progress', className)}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
      whileHover={undefined}
    >
      {loading ? <span aria-hidden="true" className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" /> : null}
      {children}
    </BeuiButton>
  );
});

export default Button;
