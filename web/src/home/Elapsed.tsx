import { useEffect, useState } from 'react';
import { ago } from '../api';
import { fmtClock } from './runText';

/** Date.now(), re-rendered every `ms` while `on` (a still clock otherwise). */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

/** A live elapsed clock (hidden from screen readers) with a static "started … ago" label. */
export function Elapsed(props: { since: number }) {
  const now = useNow(true);
  return (
    <span className="elapsed">
      <span aria-hidden="true">{fmtClock(now - props.since)}</span>
      <span className="sl-sr">started {ago(props.since)}</span>
    </span>
  );
}
