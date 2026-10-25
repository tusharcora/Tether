import { Button } from '../../components/arc/button/button';
import './parts.css';

/**
 * A data panel's own load error, with a retry. Never a silent empty list.
 * `compact`: a one-line "couldn't refresh · Retry" above data the panel still shows from an earlier success.
 */
export function InlineError(props: { message: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div className={props.compact ? 'sl-alert compact' : 'sl-alert'} role="alert">
      <span>{props.message}</span>
      <Button variant="secondary" size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}
