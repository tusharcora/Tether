import { useEffect, useRef, useState } from 'react';
import { ago, api } from '../api';
import { Button } from '../components/beui/kit/Button';
import { CopyButton } from '../components/beui/kit/CopyButton';
import { Input } from '../components/beui/kit/fields';
import { Loading } from '../components/Loading';
import type { Poll } from '../hooks';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { StatusBadge } from '../ui/studio/StatusBadge';
import { KEYS_URL } from '../../../src/nvidia';
import { FREE_DEFAULT } from '../../../src/openrouter';
import { shortModel, type AccountsView, type DeviceState, type ProviderView } from './accountsApi';
import { FreeCounter, useOpenRouterConnect } from './FreeModels';
import { TelegramAccount } from './Telegram';
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
              {pv.id === 'github' ? <GithubAccount p={pv} onChanged={refresh} /> : pv.id === 'openrouter' ? <OpenRouterAccount p={pv} onChanged={refresh} /> : pv.id === 'nvidia' ? <NvidiaAccount p={pv} onChanged={refresh} /> : pv.id === 'telegram' ? <TelegramAccount p={pv} onChanged={refresh} /> : <ComingProvider p={pv} />}
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
        <StatusBadge tone="neutral" label="coming" />
      </div>
      <p className="acc-note">{p.note ?? 'Not available yet.'}</p>
    </>
  );
}

/** OpenRouter: Connect (one browser approval), then the free requests left, the free defaults, and Disconnect (spec §7.1, §7.3, §7.6). */
function OpenRouterAccount({ p, onChanged }: { p: ProviderView; onChanged: () => Promise<void> }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const { flow, connect } = useOpenRouterConnect(onChanged);
  const a = p.account;
  const d = p.defaults;
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
  const freeCrew = () => act(async () => notify.ok('Free models for the crew', `${(await api<{ bound: string[] }>('POST', '/api/accounts/openrouter/crew')).bound.length} bots now run on free models`));
  const disconnect = () => act(() => api('DELETE', '/api/accounts/openrouter'));

  return (
    <>
      <div className="acc-head">
        <b>OpenRouter</b>
        {a ? <StatusBadge tone="done" label="connected" /> : <StatusBadge tone="neutral" label="not connected" />}
      </div>
      {a ? (
        <div className="acc-body">
          <p className="acc-note">Free models for the crew and ⌘J. The key stays in your Keychain · connected {ago(a.connectedAt)}</p>
          <FreeCounter />
          {d?.crew || d?.assistant ? (
            <div className="fm-defaults" aria-label="Free defaults">
              <span className="sl-meta">Free defaults</span>
              {d.crew ? <code>crew · {shortModel(d.crew)}</code> : null}
              {d.assistant ? <code>⌘J · {shortModel(d.assistant)}</code> : null}
            </div>
          ) : (
            <div className="acc-option">
              <p className="acc-note">Your crew runs on the agents you set up. Bots you linked on purpose keep theirs.</p>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void freeCrew()}>
                Use free models for the crew
              </Button>
            </div>
          )}
          {d?.fallback ? <p className="acc-note">{shortModel(FREE_DEFAULT)} is no longer on OpenRouter, so new free defaults use the first free model that can edit files.</p> : null}
          <div className="acc-actions">
            <ConfirmButton label="Disconnect" prompt="Remove the OpenRouter key from the Keychain? Bots on OpenRouter stay linked and show not connected." confirmLabel="Disconnect" onConfirm={disconnect} disabled={busy} />
          </div>
        </div>
      ) : (
        <div className="acc-body">
          <p className="acc-note">Run Tether on free models: approve once in your browser, no key to copy. 50 free requests a day.</p>
          {flow.state === 'pending' ? (
            <div className="acc-device" role="status" aria-live="polite">
              <a href={flow.url} target="_blank" rel="noreferrer">
                Open the OpenRouter approval page
              </a>
              <StatusBadge tone="needs" label="waiting for you to approve" />
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void connect()}>
              Connect OpenRouter
            </Button>
          )}
          {flow.state === 'error' ? <InlineError compact message={flow.error} onRetry={() => void connect()} /> : null}
        </div>
      )}
    </>
  );
}

/** NVIDIA: a key made on build.nvidia.com, pasted once and checked by the server; then Disconnect. No counter: its limit is per minute. */
function NvidiaAccount({ p, onChanged }: { p: ProviderView; onChanged: () => Promise<void> }) {
  const notify = useNotify();
  // uncontrolled, so the key is never mirrored into the DOM's value attribute
  const input = useRef<HTMLInputElement>(null);
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const a = p.account;
  const connect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('POST', '/api/accounts/nvidia', { key: input.current?.value ?? '' });
      notify.ok('NVIDIA connected', 'Its free models are in the model pickers');
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = () => api('DELETE', '/api/accounts/nvidia').then(onChanged, notify.fail);

  return (
    <>
      <div className="acc-head">
        <b>NVIDIA</b>
        {a ? <StatusBadge tone="done" label="connected" /> : <StatusBadge tone="neutral" label="not connected" />}
      </div>
      {a ? (
        <div className="acc-body">
          <p className="acc-note">Free NVIDIA-hosted models for the crew and ⌘J, about 40 requests a minute. The key stays in your Keychain · connected {ago(a.connectedAt)}</p>
          <div className="acc-actions">
            <ConfirmButton label="Disconnect" prompt="Remove the NVIDIA key from the Keychain? Bots on NVIDIA stay linked and show not connected." confirmLabel="Disconnect" onConfirm={disconnect} />
          </div>
        </div>
      ) : (
        <div className="acc-body">
          <p className="acc-note">Free NVIDIA-hosted models, about 40 requests a minute, meant for trying things out. Make a key on build.nvidia.com and paste it once; it goes to your Keychain.</p>
          <a href={KEYS_URL} target="_blank" rel="noreferrer">
            Get a key ↗
          </a>
          <form
            className="acc-client"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <Input ref={input} label="NVIDIA API key" type="password" autoComplete="off" spellCheck={false} placeholder="nvapi-…" error={error} onChange={(e) => (setFilled(!!e.target.value.trim()), setError(undefined))} />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !filled}>
              Connect
            </Button>
          </form>
        </div>
      )}
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
        {a ? <StatusBadge tone="done" label="connected" /> : <StatusBadge tone="neutral" label="not connected" />}
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
          <p className="acc-note">PR triggers, cloning and comments use this account{a.via === 'device' ? ' (its token stays in the Keychain)' : ''}.</p>
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
            <p className="acc-note">
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
              <StatusBadge tone="needs" label="waiting for you to approve" />
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
              <p className="acc-note">{p.device.setup}</p>
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
