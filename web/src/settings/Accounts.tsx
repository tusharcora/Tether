import { useEffect, useState } from 'react';
import { ago, api } from '../api';
import { Button } from '../components/arc/button/button';
import { CopyButton } from '../components/arc/copy-button/copy-button';
import { Input } from '../components/arc/input/input';
import { Loading } from '../components/Loading';
import type { Poll } from '../hooks';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { StatusChip } from '../ui/studio/StatusChip';
import type { AccountsView, DeviceState, ProviderView } from './accountsApi';
import './settings.css';

/** How often the panel asks the server how the device flow is going (the server itself polls GitHub). */
export const DEVICE_POLL_MS = 2000;

/** Settings → Accounts: each provider with who is connected, how, its scopes, and Connect / Disconnect. */
export function Accounts(p: { poll: Poll<AccountsView> }) {
  const { data, error, refresh } = p.poll;
  return (
    <Loading loading={!data && !error} lines={3} label="Loading accounts">
      {error && !data ? (
        <InlineError message={error} onRetry={() => void refresh()} />
      ) : (
        <ul className="acc-list">
          {(data?.providers ?? []).map((pv) => (
            <li key={pv.id} className="acc-row">
              {pv.id === 'github' ? <GithubAccount p={pv} onChanged={refresh} /> : <ComingProvider p={pv} />}
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}

function ComingProvider({ p }: { p: ProviderView }) {
  return (
    <>
      <div className="acc-head">
        <b>{p.name}</b>
        <StatusChip tone="neutral" label="coming" />
      </div>
      <p className="sl-meta">{p.note ?? 'Not available yet.'}</p>
    </>
  );
}

function GithubAccount({ p, onChanged }: { p: ProviderView; onChanged: () => Promise<void> }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<DeviceState>({ state: 'idle' });
  const [clientId, setClientId] = useState('');
  const a = p.account;

  // while the code waits for approval, follow the server's poll of GitHub
  useEffect(() => {
    if (flow.state !== 'pending') return;
    const t = setInterval(() => {
      api<DeviceState>('GET', '/api/accounts/github/device').then((s) => {
        setFlow(s);
        if (s.state === 'connected') {
          notify.ok('GitHub connected', `@${s.account.login}`);
          void onChanged();
        }
      }, notify.fail);
    }, DEVICE_POLL_MS);
    return () => clearInterval(t);
  }, [flow.state, notify, onChanged]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const adopt = () => act(async () => notify.ok('GitHub connected', `@${(await api<{ account: { login: string } }>('POST', '/api/accounts/github/cli')).account.login} via the GitHub CLI`));
  const signIn = () =>
    act(async () => {
      const s = await api<{ userCode: string; verificationUri: string; expiresIn: number }>('POST', '/api/accounts/github/device');
      setFlow({ state: 'pending', userCode: s.userCode, verificationUri: s.verificationUri, expiresAt: Date.now() + s.expiresIn * 1000 });
      window.open(s.verificationUri, '_blank', 'noopener');
    });
  const saveClient = () => act(() => api('PUT', '/api/accounts/github/client', { clientId: clientId.trim() }));
  const disconnect = () => act(async () => (await api('DELETE', '/api/accounts/github'), setFlow({ state: 'idle' })));

  return (
    <>
      <div className="acc-head">
        <b>GitHub</b>
        {a ? <StatusChip tone="done" label="connected" /> : <StatusChip tone="neutral" label="not connected" />}
      </div>
      {a ? (
        <div className="acc-body">
          <p>
            Connected as <b>@{a.login}</b> {a.via === 'gh' ? 'via the GitHub CLI' : 'by signing in here'} · {ago(a.connectedAt)}
          </p>
          {a.scopes.length ? (
            <p className="acc-scopes" aria-label="Scopes">
              {a.scopes.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </p>
          ) : null}
          <p className="sl-meta">PR triggers, cloning and comments use this account{a.via === 'device' ? ' (its token stays in the Keychain)' : ''}.</p>
          <div className="acc-actions">
            <ConfirmButton label="Disconnect" prompt={a.via === 'gh' ? 'Stop using the GitHub CLI login? gh itself stays signed in.' : 'Forget this sign-in and remove its token from the Keychain?'} confirmLabel="Disconnect" onConfirm={disconnect} disabled={busy} />
          </div>
        </div>
      ) : (
        <div className="acc-body">
          {p.cli ? (
            <div className="acc-option">
              <p>
                Signed in via GitHub CLI as <b>@{p.cli.login}</b>
              </p>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void adopt()}>
                Use this
              </Button>
            </div>
          ) : (
            <p className="sl-meta">
              The GitHub CLI is not signed in on this Mac (<code>gh auth login</code> would do it).
            </p>
          )}
          {flow.state === 'pending' ? (
            <div className="acc-device" role="status" aria-live="polite">
              <p>Enter this code on GitHub:</p>
              <div className="acc-code-row">
                <code className="acc-code">{flow.userCode}</code>
                <CopyButton value={flow.userCode} label="Copy code" />
              </div>
              <a href={flow.verificationUri} target="_blank" rel="noreferrer">
                Open {flow.verificationUri.replace(/^https:\/\//, '')}
              </a>
              <StatusChip tone="needs" label="waiting for you to approve" />
            </div>
          ) : p.device?.ready ? (
            <div className="acc-option">
              <p>Or sign in with GitHub: you approve a one-time code in your browser.</p>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void signIn()}>
                Sign in with GitHub
              </Button>
            </div>
          ) : p.device ? (
            <div className="acc-option acc-setup">
              <p className="sl-meta">{p.device.setup}</p>
              <div className="acc-client">
                <Input label="OAuth App client id" value={clientId} spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
                <Button variant="secondary" size="sm" disabled={busy || !clientId.trim()} onClick={() => void saveClient()}>
                  Save
                </Button>
              </div>
            </div>
          ) : null}
          {flow.state === 'expired' ? <InlineError compact message="The code expired before it was approved." onRetry={() => void signIn()} /> : null}
          {flow.state === 'denied' ? <InlineError compact message="GitHub access was denied." onRetry={() => void signIn()} /> : null}
          {flow.state === 'error' ? <InlineError compact message={flow.error} onRetry={() => void signIn()} /> : null}
        </div>
      )}
    </>
  );
}
