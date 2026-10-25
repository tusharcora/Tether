import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button } from '../components/arc/button/button';
import { CopyButton } from '../components/arc/copy-button/copy-button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { Panel } from '../ui/studio/Panel';
import type { Setup } from './types';

/** How to point a GitHub webhook at this machine, and the shared secret (shown once when generated). */
export function WebhookSetup() {
  const notify = useNotify();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [err, setErr] = useState('');
  const [secret, setSecret] = useState('');
  async function load() {
    try {
      setSetup(await api<Setup>('GET', '/api/triggers/setup'));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function regenerate() {
    try {
      const r = await api<{ secret: string }>('POST', '/api/triggers/setup/secret');
      setSecret(r.secret);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }
  const copied = () => notify.ok('copied');
  const payloadUrl = `https://<your tunnel>${setup?.payloadPath ?? '/api/webhooks/github'}`;
  return (
    <Panel title="Webhook setup" className="tg-setup">
      <p className="sl-summary">
        GitHub → repo → Settings → Webhooks → Add webhook. This server only listens on this machine, so expose just the webhook path with a tunnel (<code>cloudflared tunnel --url http://127.0.0.1:4177</code>, ngrok or tailscale
        funnel). No tunnel? <code>aorch pr watch</code> polls instead.
      </p>
      {err ? <InlineError message={err} onRetry={() => void load()} /> : null}
      <dl className="tg-dl">
        <dt>Payload URL</dt>
        <dd>
          <code className="tg-code">{payloadUrl}</code>
          <CopyButton value={payloadUrl} label="Copy" variant="outline" onCopied={copied} />
        </dd>
        <dt>Content type</dt>
        <dd>
          <code>{setup?.contentType ?? 'application/json'}</code>
        </dd>
        <dt>Events</dt>
        <dd>
          Let me select individual events → <b>{(setup?.eventsToSelect ?? ['Pull requests']).join(', ')}</b>
        </dd>
        <dt>Secret</dt>
        <dd>
          {secret ? (
            <>
              <code className="tg-code tg-secret">{secret}</code>
              <CopyButton value={secret} label="Copy" variant="outline" onCopied={copied} />
              <span className="sl-note">Copy this into GitHub now. It will not be shown again.</span>
            </>
          ) : setup?.hasSecret ? (
            <>
              <code className="tg-code">{setup.secretHint ? `••••••••${setup.secretHint}` : '••••••••'}</code>
              <span className="sl-meta">{setup.secretSource === 'env' ? 'from AORCH_WEBHOOK_SECRET' : 'stored; shown only when generated'}</span>
            </>
          ) : (
            <span className="sl-meta">none yet</span>
          )}
        </dd>
      </dl>
      <div className="tg-actions">
        {setup?.secretSource !== 'env' ? (
          setup?.hasSecret ? (
            <ConfirmButton variant="secondary" label="Regenerate secret" prompt="Existing webhooks stop working until you paste the new secret." confirmLabel="Regenerate" onConfirm={regenerate} />
          ) : (
            <Button variant="secondary" onClick={() => void regenerate()}>
              Generate secret
            </Button>
          )
        ) : null}
        {secret ? (
          <Button variant="ghost" onClick={() => setSecret('')}>
            Hide
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
