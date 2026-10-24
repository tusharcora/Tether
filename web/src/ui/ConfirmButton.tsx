import { useEffect, useState } from 'react';
import { Button } from '../components/arc/button/button';

export interface ConfirmButtonProps {
  label: string;
  prompt: string;
  confirmLabel: string;
  /** Callers report their own errors; a rejection here only resets the button. */
  onConfirm: () => void | Promise<unknown>;
  variant?: 'danger' | 'secondary';
  disabled?: boolean;
  /** Label for the button that backs out of the question (default "Cancel"). */
  cancelLabel?: string;
  /** Told when the inline question opens or closes, so a parent can hide competing actions. */
  onAskingChange?: (asking: boolean) => void;
}

/** A two-step action: the first click asks inline, the second acts. Never a browser dialog. */
export function ConfirmButton(p: ConfirmButtonProps) {
  const [asking, setAskingState] = useState(false);
  const [busy, setBusy] = useState(false);
  const { onAskingChange, disabled } = p;

  const setAsking = (next: boolean) => {
    setAskingState(next);
    onAskingChange?.(next);
  };

  // Something else started (the parent went busy) while we were asking: back out of the question.
  // While our own action runs the parent is busy too, so keep the loading confirm step then.
  useEffect(() => {
    if (disabled && asking && !busy) {
      setAskingState(false);
      onAskingChange?.(false);
    }
  }, [disabled, asking, busy, onAskingChange]);

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
        disabled={p.disabled}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await p.onConfirm();
          } catch {
            // the caller reports the error; just reset
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {p.confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking(false)}>
        {p.cancelLabel ?? 'Cancel'}
      </Button>
    </span>
  );
}
