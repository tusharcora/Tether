import { Button } from '../../components/arc/button/button';
import './parts.css';

/** A data panel's own load error, with a retry. Never a silent empty list. */
export function InlineError(props: { message: string; onRetry: () => void }) {
  return (
    <div className="sl-alert" role="alert">
      <span>{props.message}</span>
      <Button variant="secondary" size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}
