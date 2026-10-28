import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { CenterMorphModal, CenterMorphModalContent } from '../motion/center-morph-modal';
import { Drawer as BeuiDrawer } from '../motion/drawer';
import { cn } from '../lib/utils';

/*
 * Dialog and Drawer with the shape the screens already use (a root that owns open, a content part with a title), drawn with
 * beui's center-morph modal and side drawer. Titles name the dialog; Escape and the scrim close; focus returns to the opener.
 */

interface OpenState { open: boolean; onOpenChange: (open: boolean) => void }
const DialogCtx = createContext<OpenState | null>(null);
const DrawerCtx = createContext<OpenState | null>(null);

function useOpenState(open: boolean | undefined, defaultOpen: boolean | undefined, onOpenChange: ((open: boolean) => void) | undefined): OpenState {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const value = open ?? inner;
  return { open: value, onOpenChange: (next) => { if (open === undefined) setInner(next); onOpenChange?.(next); } };
}

export function Dialog({ open, defaultOpen, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const state = useOpenState(open, defaultOpen, onOpenChange);
  return <DialogCtx.Provider value={state}><CenterMorphModal open={state.open} onOpenChange={state.onOpenChange}>{children}</CenterMorphModal></DialogCtx.Provider>;
}

export function DialogClose({ children }: { children: ReactNode }) { return <>{children}</>; }

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <CenterMorphModalContent ariaLabel={title} closeButtonLabel="Close dialog" className={cn('max-w-[34rem] rounded-xl', className)}>
      <div className="px-6 pt-6 pr-14">
        <h2 className="m-0 text-lg font-medium leading-snug text-foreground">{title}</h2>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="px-6 pb-6 pt-4 text-sm">{children}</div>
    </CenterMorphModalContent>
  );
}

export function Drawer({ open, defaultOpen, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const state = useOpenState(open, defaultOpen, onOpenChange);
  return <DrawerCtx.Provider value={state}>{children}</DrawerCtx.Provider>;
}

/** The last item a drawer showed, so its content stays on screen while the panel slides out. */
export function useDrawerItem<T>(item: T | null | undefined): T | null | undefined {
  const [last, setLast] = useState(item);
  if (item != null && item !== last) setLast(item);
  return item ?? last;
}

export function DrawerContent({ title, description, children, side = 'right', className, onOpenAutoFocus, onCloseAutoFocus }: { title: string; description?: string; children: ReactNode; side?: 'left' | 'right'; className?: string; /** Runs as the drawer opens, before focus moves into it. */ onOpenAutoFocus?: () => void; /** Runs after the drawer closed and focus went back to its opener; focus something else here to override. */ onCloseAutoFocus?: (event: { preventDefault: () => void }) => void }) {
  const state = useContext(DrawerCtx);
  if (!state) throw new Error('DrawerContent must sit inside <Drawer>');
  const open = state.open;
  const was = useRef(false);
  const onOpen = useRef(onOpenAutoFocus);
  const onClose = useRef(onCloseAutoFocus);
  onOpen.current = onOpenAutoFocus;
  onClose.current = onCloseAutoFocus;
  useLayoutEffect(() => { if (open) onOpen.current?.(); }, [open]);
  useEffect(() => {
    if (!open && was.current) onClose.current?.({ preventDefault: () => undefined });
    was.current = open;
  }, [open]);
  return createPortal(
    <BeuiDrawer open={state.open} onOpenChange={state.onOpenChange} side={side} ariaLabel={title} className={cn('w-[min(30rem,calc(100vw-1rem))] bg-card', className)} backdropClassName="bg-foreground/30">
      <div className="flex flex-none items-start justify-between gap-4 border-b border-border p-5">
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-medium leading-snug text-foreground">{title}</h2>
          {description ? <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <button type="button" aria-label="Close drawer" onClick={() => state.onOpenChange(false)} className="grid size-8 flex-none place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5 text-sm [overscroll-behavior:contain]">{children}</div>
    </BeuiDrawer>,
    document.body,
  );
}
