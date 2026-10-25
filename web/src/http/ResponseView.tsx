import './api.css';
import { useMemo, useState } from 'react';
import { describeActual, describeCheck } from '../../../src/http/describe';
import { JsonViewer } from '../components/arc/json-viewer/json-viewer';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Loading } from '../components/Loading';
import type { SendOutput } from './client';

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/** 2xx ok; 3xx and 4xx warn; 5xx, 1xx and status 0 (network error) bad. */
export const statusTone = (s: number): 'ok' | 'warn' | 'bad' => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 500 ? 'warn' : 'bad');

/** Past this many characters the JSON tree opens only its root: a 5 MB body would otherwise unfold thousands of rows. */
const FOLD_PAST = 1024 * 1024;

const VIEWS = [
  { value: 'body', label: 'Body' },
  { value: 'raw', label: 'Raw' },
  { value: 'headers', label: 'Headers' },
];

/** A check mark drawn with one stroke (CSS animates the stroke; still under reduced motion). */
const Tick = ({ ok }: { ok: boolean }) => (
  <svg className="tick" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d={ok ? 'M3 8.5 6.5 12 13 4.5' : 'M4 4l8 8M12 4l-8 8'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
  </svg>
);

/** The body as a JSON tree when it parses to an object or array, else as text. The data arrives redacted: shown as-is. */
function Body({ body, parsed }: { body: string; parsed: { v: object } | null }) {
  if (!body) return <p className="hint">Empty body.</p>;
  return parsed ? (
    <JsonViewer data={parsed.v} rootName="$" label="Response body" maxHeight="100%" defaultExpandDepth={body.length > FOLD_PAST ? 1 : 2} />
  ) : (
    <pre className="raw mono">{body}</pre>
  );
}

const parseObject = (body: string): { v: object } | null => {
  try {
    const v: unknown = JSON.parse(body);
    return v !== null && typeof v === 'object' ? { v } : null;
  } catch {
    return null;
  }
};

export interface ResponseViewProps {
  /** The last send's redacted output. */
  output?: SendOutput;
  /** True while a send is on its way: the ascii skeleton holds the response's place. */
  sending: boolean;
  /** The send was refused before it left (e.g. `unknown variables: base`). */
  error?: string;
}

export function ResponseView(p: ResponseViewProps) {
  const [view, setView] = useState('body');
  const o = p.output;
  const r = o?.result;
  // Parsed once per body, so switching views back to Body does not parse a large response again.
  const parsed = useMemo(() => (r?.body ? parseObject(r.body) : null), [r?.body]);
  const total = r ? Math.max(1, r.timing.ttfb + r.timing.download) : 1;
  const passed = o ? o.checks.filter((c) => c.ok).length : 0;
  return (
    <section className="resp" aria-label="Response">
      <Loading loading={p.sending} rows={10} label="Sending" className="resp-load">
        {p.error ? (
          <p className="resp-error" role="alert">
            {p.error}
          </p>
        ) : !o || !r ? (
          <p className="hint resp-empty">Send a request to see its response. ⌘↵ sends.</p>
        ) : (
          <>
            <div className="resp-head">
              <span className="pill" data-tone={r.error ? 'bad' : statusTone(r.status)}>
                {r.error ? r.error.kind : `${r.status} ${r.statusText}`.trim()}
              </span>
              <span className="mono">{`${r.ms} ms`}</span>
              <span className="mono">{fmtBytes(r.size)}</span>
              {r.truncated ? (
                <span className="pill" data-tone="warn">
                  truncated at 5 MB
                </span>
              ) : null}
              {r.redirects.length ? <span className="hint">{`${r.redirects.length} redirect${r.redirects.length > 1 ? 's' : ''}`}</span> : null}
              <span className="spacer" />
              <SegmentedControl label="Response view" options={VIEWS} value={view} onValueChange={setView} />
            </div>
            {r.error ? <p className="resp-error">{r.error.message}</p> : null}
            {!r.error ? (
              <div className="timing" aria-label="Timing">
                <div className="timing-track">
                  <span className="timing-bar ttfb" style={{ width: `${Math.round((r.timing.ttfb / total) * 100)}%` }} />
                  <span className="timing-bar dl" style={{ width: `${Math.round((r.timing.download / total) * 100)}%` }} />
                </div>
                <span className="hint mono">{`TTFB ${r.timing.ttfb} ms`}</span>
                <span className="hint mono">{`download ${r.timing.download} ms`}</span>
              </div>
            ) : null}
            {o.checks.length ? (
              <div className="checks-out">
                <p className="hint">{`${passed} of ${o.checks.length} checks passed`}</p>
                <ul>
                  {o.checks.map((c, i) => (
                    <li key={i} data-ok={String(c.ok)}>
                      <Tick ok={c.ok} />
                      <span className="mono">{describeCheck(c.check)}</span>
                      {!c.ok ? <span className="hint mono">{`actual ${describeActual(c.actual)}`}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="resp-body">
              {view === 'body' ? <Body body={r.body} parsed={parsed} /> : null}
              {view === 'raw' ? <pre className="raw mono">{r.body}</pre> : null}
              {view === 'headers' ? (
                <table className="hdrs mono">
                  <tbody>
                    {r.headers.map(([k, v], i) => (
                      <tr key={i}>
                        <th scope="row">{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </>
        )}
      </Loading>
    </section>
  );
}
