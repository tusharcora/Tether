import { useEffect, useState } from 'react';
import { ago } from '../api';
import { fmtClock } from './runText';

/** A live elapsed clock (hidden from screen readers) with a static "started … ago" label. */
export function Elapsed(props: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="elapsed">
      <span aria-hidden="true">{fmtClock(now - props.since)}</span>
      <span className="sl-sr">started {ago(props.since)}</span>
    </span>
  );
}
