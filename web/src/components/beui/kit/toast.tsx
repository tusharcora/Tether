import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { AnimatedToastStack, useAnimatedToastStack, type ToastStatus } from '../motion/animated-toast-stack';

/*
 * Toast API the screens use (`toast({ type, title, description })`) over beui's animated toast stack. One provider holds the
 * queue, one <ToastStack/> draws it, bottom-right; each toast dismisses itself and can be closed by hand.
 */
export type ToastType = 'success' | 'info' | 'warning' | 'error' | 'loading';
export interface ToastOptions { type?: ToastType; title: string; description?: string; duration?: number }

type Api = ReturnType<typeof useAnimatedToastStack>;
const Ctx = createContext<Api | null>(null);
const STATUS: Record<ToastType, ToastStatus> = { success: 'success', info: 'info', warning: 'neutral', error: 'error', loading: 'loading' };

export function ToastStackProvider({ children, duration = 5000, limit = 12 }: { children: ReactNode; duration?: number; limit?: number }) {
  const api = useAnimatedToastStack({ defaultDuration: duration, limit });
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useToastStack() {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToastStack needs a <ToastStackProvider>');
  const { showToast, dismissToast, clearToasts, toasts } = api;
  return useMemo(
    () => ({
      toast: (o: ToastOptions) => showToast({ status: STATUS[o.type ?? 'info'], title: o.title, description: o.description, duration: o.duration }),
      dismiss: dismissToast,
      clear: clearToasts,
      count: toasts.length,
    }),
    [showToast, dismissToast, clearToasts, toasts.length],
  );
}

export function ToastStack({ label = 'Notifications' }: { label?: string }) {
  const api = useContext(Ctx);
  if (!api) return null;
  return (
    <div role="region" aria-label={label}>
      <AnimatedToastStack toasts={api.toasts} onDismiss={api.dismissToast} position="bottom-right" fixed />
    </div>
  );
}
