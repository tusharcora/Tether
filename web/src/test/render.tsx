import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ToastStack, ToastStackProvider } from '../components/arc/toast-stack/toast-stack';

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastStackProvider>
      {children}
      <ToastStack />
    </ToastStackProvider>
  );
}

/** Render inside the providers the app shell supplies (toasts). `rerender` keeps them. */
export const renderApp = (ui: ReactElement) => render(ui, { wrapper: Providers });
