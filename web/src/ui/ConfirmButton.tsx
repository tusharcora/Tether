import { useState } from 'react';
import { Button } from '../components/arc/button/button';

export interface ConfirmButtonProps {
  label: string;
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<unknown>;
  variant?: 'danger' | 'secondary';
  disabled?: boolean;
}

/** A two-step action: the first click asks inline, the second acts. Never a browser dialog. */
export function ConfirmButton(p: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <Button variant={p.variant ?? 'danger'} size="sm" disabled={p.disabled} onClick={() => setAsking(true)}>
        {p.label}
      </Button>
    );
  return (
    <span className="row confirm" role="group" aria-label={p.prompt}>
      <span className="small">{p.prompt}</span>
      <Button
        variant="danger"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await p.onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {p.confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
