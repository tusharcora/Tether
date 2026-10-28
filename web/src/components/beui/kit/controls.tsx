import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Tabs as BeuiTabs, TabsContent as BeuiTabsContent, TabsList as BeuiTabsList, TabsTrigger as BeuiTabsTrigger } from '../motion/tabs';
import { Tooltip as BeuiTooltip, TooltipProvider } from '../motion/tooltip';
import { SPRING_LAYOUT } from '../lib/ease';
import { cn } from '../lib/utils';

export { TooltipProvider };

/** Tabs (role="tablist"): beui's segment variant with the spring indicator. Panels mount when chosen. */
export function Tabs(props: { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; className?: string; children: ReactNode }) {
  return <BeuiTabs variant="segment" {...props} />;
}
export function TabsList({ className, ...rest }: { 'aria-label'?: string; className?: string; children: ReactNode }) {
  return <BeuiTabsList {...rest} className={cn('text-sm', className)} />;
}
export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return <BeuiTabsTrigger value={value} className={cn('px-3 py-1.5 text-sm', className)}>{children}</BeuiTabsTrigger>;
}
export function TabsContent({ value, children, className, forceMount }: { value: string; children: ReactNode; className?: string; forceMount?: boolean }) {
  return <BeuiTabsContent value={value} className={className} forceMount={forceMount}>{children}</BeuiTabsContent>;
}

export interface Segment { value: string; label: string; /** Content after the label, such as a count. */ accessory?: ReactNode }
export interface SegmentedControlProps {
  options: Segment[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Called when the pointer or focus reaches an option, before it is chosen (to start loading what it shows). */
  onOptionIntent?: (value: string) => void;
  className?: string;
}

/**
 * A short row of exclusive choices (a view, a mode, a theme). Pressed buttons in a group, one tab stop, arrows move and choose;
 * the selection pill glides between options on beui's layout spring.
 */
export function SegmentedControl({ options, value, onValueChange, label, onOptionIntent, className }: SegmentedControlProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  useLayoutEffect(() => {
    const node = track.current;
    const on = node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!node || !on || node.scrollWidth <= node.clientWidth) return;
    const left = on.offsetLeft - 20, right = on.offsetLeft + on.offsetWidth + 20 - node.clientWidth;
    node.scrollLeft = node.scrollLeft > left ? left : node.scrollLeft < right ? right : node.scrollLeft;
  }, [value]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const to = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (selected === last ? 0 : selected + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (selected === 0 ? last : selected - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    const next = options[to];
    if (!next) return;
    event.preventDefault();
    onValueChange(next.value);
    track.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus({ preventScroll: true });
  };
  return (
    <div role="group" aria-label={label} className={cn('max-w-full min-w-0', className)}>
      <LayoutGroup id={id}>
        <div ref={track} className="inline-flex max-w-full gap-0 overflow-x-auto rounded-lg bg-card p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                data-value={o.value}
                aria-pressed={on}
                tabIndex={i === selected ? 0 : -1}
                onClick={() => onValueChange(o.value)}
                onKeyDown={onKeyDown}
                onPointerEnter={onOptionIntent ? () => onOptionIntent(o.value) : undefined}
                onFocus={onOptionIntent ? () => onOptionIntent(o.value) : undefined}
                className={cn('relative isolate inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border-0 bg-transparent px-3 text-sm font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring', on ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {on ? <motion.span layoutId="seg-pill" transition={reduced ? { duration: 0 } : SPRING_LAYOUT} aria-hidden="true" className="absolute inset-0 -z-10 rounded-md bg-primary" /> : null}
                {o.label}{o.accessory}
              </button>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
}

/** Hover and focus tooltip for a control; keeps its trigger as the child. */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: React.ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return <BeuiTooltip content={content} side={side}>{children}</BeuiTooltip>;
}

/** A quiet placeholder block for content on its way. */
export function Skeleton({ lines = 3, label = 'Loading content', className }: { lines?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn('grid gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => <span key={i} aria-hidden="true" className={cn('block h-3 animate-pulse rounded bg-muted', i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />)}
    </div>
  );
}
