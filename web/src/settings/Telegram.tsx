import { useRef, useState } from 'react';
import { ago, api } from '../api';
import { Button } from '../components/beui/kit/Button';
import { CopyButton } from '../components/beui/kit/CopyButton';
import { Input } from '../components/beui/kit/fields';
import { usePoll } from '../hooks';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { StatusBadge } from '../ui/studio/StatusBadge';
import type { ProviderView } from './accountsApi';

/** GET /api/telegram: the bot, polling, the owner's Telegram name, and voice notes (spec 2026-10-30 §6.6). Never the token. */
export interface TelegramView {
  connected: boolean;
  bot?: { username: string; readsAll: boolean };
  polling: boolean;
  error?: string;
  owner?: { name: string };
  voice: {
    model: { phase: 'checking' | 'missing' | 'ready' } | { phase: 'downloading'; done: number; total: number } | { phase: 'failed'; error: string };
    size: number;
    decoder: string | null;
    engine: boolean;
    why: string | null;
  };
}
export const TELEGRAM_PATH = '/api/telegram';
export const TELEGRAM_MS = 2000;
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

/**
 * Settings → Accounts → Telegram: the @BotFather token pasted once (it goes to the Keychain), then the bot and whether it is
 * listening, the one-time `/iam` code that tells Tether which Telegram user is you, the speech model for voice notes
 * (downloaded only when asked), and Disconnect.
 */
export function TelegramAccount({ p, onChanged }: { p: ProviderView; onChanged: () => Promise<void> }) {
  const notify = useNotify();
  // uncontrolled, so the token is never mirrored into the DOM's value attribute
  const input = useRef<HTMLInputElement>(null);
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [iam, setIam] = useState<{ code: string; bot?: string }>();
  const a = p.account;
  const tg = usePoll<TelegramView>(a ? TELEGRAM_PATH : null, TELEGRAM_MS);
  const v = tg.data;

  const connect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('POST', '/api/accounts/telegram', { token: input.current?.value ?? '' });
      notify.ok('Telegram connected', 'Make a Telegram team: New team → Telegram group');
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = () => api('DELETE', '/api/accounts/telegram').then(onChanged, notify.fail);
  const showIam = () => api<{ code: string; bot?: string }>('POST', '/api/telegram/iam').then(setIam, notify.fail);
  const download = () => api('POST', '/api/telegram/voice').then(() => tg.refresh(), notify.fail);

  if (!a)
    return (
      <>
        <div className="acc-head">
          <b>Telegram</b>
          <StatusBadge tone="neutral" label="not connected" />
        </div>
        <div className="acc-body">
          <p className="acc-note">Teams that live in a Telegram group, and a phone remote for Tether. Make a bot with @BotFather (/newbot) and paste its token once; it goes to your Keychain. Tether listens while it runs, on this Mac: no server, no public URL.</p>
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            Open @BotFather ↗
          </a>
          <form
            className="acc-client"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <Input ref={input} label="Bot token" type="password" autoComplete="off" spellCheck={false} placeholder="123456789:AA…" error={error} onChange={(e) => (setFilled(!!e.target.value.trim()), setError(undefined))} />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !filled}>
              Connect
            </Button>
          </form>
        </div>
      </>
    );

  return (
    <>
      <div className="acc-head">
        <b>Telegram</b>
        {v?.error ? <StatusBadge tone="failed" label="not listening" /> : v?.polling ? <StatusBadge tone="done" label="listening" /> : <StatusBadge tone="live" label="connecting" />}
      </div>
      <div className="acc-body">
        <p className="acc-note">{`@${v?.bot?.username ?? a.login} · the token stays in your Keychain · connected ${ago(a.connectedAt)}`}</p>
        {v?.error ? (
          <p className="acc-note" role="alert">
            {v.error}
          </p>
        ) : null}
        {v?.bot && !v.bot.readsAll ? <p className="acc-note">In each group, make the bot an admin: it needs that to pin the live status and to see every message (or turn privacy off in @BotFather with /setprivacy).</p> : null}
        <div className="acc-option" aria-label="You on Telegram">
          {v?.owner ? (
            <p>
              You are <b>{v.owner.name}</b> on Telegram: you approve and start runs in every Telegram team.
            </p>
          ) : iam ? (
            <>
              <p>{`Send this to @${iam.bot ?? a.login} in a private chat, within 10 minutes:`}</p>
              <div className="acc-code-row">
                <code className="acc-code">{`/iam ${iam.code}`}</code>
                <CopyButton value={`/iam ${iam.code}`} label="Copy" />
              </div>
            </>
          ) : (
            <>
              <p className="acc-note">Tell Tether which Telegram user is you, so your approvals count in groups.</p>
              <Button variant="secondary" size="sm" onClick={() => void showIam()}>
                Link my Telegram
              </Button>
            </>
          )}
        </div>
        {v ? <VoiceNotes v={v.voice} onDownload={() => void download()} /> : null}
        <div className="acc-actions">
          <ConfirmButton label="Disconnect" prompt="Stop listening and remove the bot token from the Keychain? Telegram teams keep their group and work again once you connect." confirmLabel="Disconnect" onConfirm={disconnect} />
        </div>
      </div>
    </>
  );
}

/** Voice notes: transcribed with SenseVoice on this Mac once its model is downloaded (on request, with progress). */
function VoiceNotes({ v, onDownload }: { v: TelegramView['voice']; onDownload: () => void }) {
  const m = v.model;
  if (!v.engine) return <p className="acc-note">Voice notes: this build of Tether has no speech engine.</p>;
  if (m.phase === 'downloading')
    return (
      <div className="fm-counter" role="status" aria-label="Speech model download">
        <span className="fm-counter-line">
          <b>Downloading the speech model</b>
          <span className="fm-count">{`${mb(m.done)} of ${mb(m.total)}`}</span>
        </span>
        <span className="fm-meter">
          <span style={{ width: `${Math.min(100, (m.done / Math.max(1, m.total)) * 100).toFixed(1)}%` }} />
        </span>
      </div>
    );
  if (m.phase === 'ready') return <p className="acc-note">{v.why ? `Voice notes: ${v.why}.` : 'Voice notes: transcribed on this Mac with SenseVoice; the audio never leaves it.'}</p>;
  return (
    <div className="acc-option">
      <p className="acc-note">Voice notes in Telegram are transcribed on this Mac with SenseVoice (free, offline). The model downloads once.</p>
      {m.phase === 'failed' ? <InlineError compact message={m.error} onRetry={onDownload} /> : null}
      <Button variant="secondary" size="sm" disabled={m.phase === 'checking'} onClick={onDownload}>
        {`Voice notes: download model (~${mb(v.size)})`}
      </Button>
    </div>
  );
}
