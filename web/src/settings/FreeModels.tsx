import { useEffect, useState } from 'react';
import { CREDITS_URL, type Allowance } from '../../../src/openrouter';
import { api, clock } from '../api';
import { usePoll } from '../hooks';
import { useNotify } from '../ui/notify';
import { ALLOWANCE_MS, ALLOWANCE_PATH, type OrFlow } from './accountsApi';

/** How often the screen asks the server how the OpenRouter approval is going (the server waits for the browser). */
export const FLOW_POLL_MS = 2000;

/**
 * Connect OpenRouter (free models spec §7.1): the server starts the approval and hands back OpenRouter's page, which opens
 * in the browser; the screen then follows the flow until the key is in. Settings and Home's first-launch row share it.
 */
export function useOpenRouterConnect(onDone: () => unknown) {
  const notify = useNotify();
  const [flow, setFlow] = useState<OrFlow>({ state: 'idle' });

  useEffect(() => {
    if (flow.state !== 'pending') return;
    const t = setInterval(() => {
      api<OrFlow>('GET', '/api/accounts/openrouter/flow').then((s) => {
        setFlow(s);
        if (s.state === 'connected') {
          notify.ok('OpenRouter connected', s.bound.length ? 'The crew runs on free models' : 'Free models are ready');
          void onDone();
        }
      }, notify.fail);
    }, FLOW_POLL_MS);
    return () => clearInterval(t);
  }, [flow.state, notify, onDone]);

  const connect = async () => {
    try {
      const { url } = await api<{ url: string }>('POST', '/api/accounts/openrouter');
      setFlow({ state: 'pending', url });
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      notify.fail(e);
    }
  };
  return { flow, connect };
}

/** "32 of 50 free requests left today · resets 20:00", with a bar; asked when shown and every 60 s after (spec §7.6). */
export function FreeCounter(p: { compact?: boolean }) {
  const { data, error } = usePoll<Allowance>(ALLOWANCE_PATH, ALLOWANCE_MS);
  if (!data) return error ? <p className="acc-note">{error}</p> : null;
  const left = `${data.remaining} of ${data.limit} free requests left today`;
  if (p.compact) return <span className="fm-count">{left}</span>;
  return (
    <div className="fm-counter">
      <div className="fm-counter-line">
        <b>{left}</b>
        <span className="sl-meta">resets {clock(data.resetsAt)}</span>
      </div>
      <div className="fm-meter" role="meter" aria-label="Free requests left today" aria-valuemin={0} aria-valuemax={data.limit} aria-valuenow={data.remaining}>
        <span style={{ width: `${data.limit ? Math.round((100 * data.remaining) / data.limit) : 0}%` }} />
      </div>
      <p className="acc-note">
        Every model call counts; a small coding run uses about 5–30.
        {data.limit < 1000 ? (
          <>
            {' '}
            <a href={CREDITS_URL} target="_blank" rel="noreferrer">
              Add $10 of credits ↗
            </a>{' '}
            for 1,000 a day.
          </>
        ) : null}
      </p>
    </div>
  );
}
