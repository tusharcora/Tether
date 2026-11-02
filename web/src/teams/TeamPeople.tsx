import { useEffect, useState } from 'react';
import { Button } from '../components/beui/kit/Button';
import { CopyButton } from '../components/beui/kit/CopyButton';
import { Switch } from '../components/beui/kit/fields';
import { Face } from '../Face';
import type { Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { isApprover, teamsApi, type Team, type TeamView } from './teamsApi';

const today = (at?: number) => !!at && new Date(at).toDateString() === new Date().toDateString();
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * People and permissions (board 7): everyone in the group can chat and @mention agents; only people can approve; starting
 * runs is off until it is switched on. The owner's switches are fixed on; agents approve nothing and start runs only
 * through a person.
 */
export function TeamPeople({ team: t, members, onChanged }: { team: Team; members: TeamView['members']; onChanged: () => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string>();
  const act = (id: string, p: Promise<unknown>) => {
    setBusy(id);
    p.then(onChanged, notify.fail).finally(() => setBusy(undefined));
  };
  return (
    <div className="tp" aria-label="People and permissions">
      <p className="tm-muted">Everyone here can chat and @mention agents. Only people can approve. Starting runs is off unless you turn it on.</p>
      <div className="tp-row tp-cols" aria-hidden="true">
        <span>Member</span>
        <span>Approver</span>
        <span>Can start runs</span>
        <span />
      </div>
      <ul className="tp-list">
        {t.people.map((p) => {
          const owner = p.id === 'owner';
          return (
            <li key={p.id} className="tp-row">
              <span className="tp-who">
                <span className="tm-avatar small" aria-hidden="true">
                  {owner ? 'Y' : initials(p.name)}
                </span>
                <span>
                  <b>{owner ? 'You' : p.name}</b> {owner ? <span className="tr-chip">owner</span> : <span className="tm-muted">{[p.username ? `@${p.username}` : '', p.via === 'telegram' ? 'Telegram' : '', today(p.joinedAt) ? 'joined today' : ''].filter(Boolean).join(' · ')}</span>}
                </span>
              </span>
              <Switch aria-label={`${owner ? 'You' : p.name} can approve`} checked={owner || isApprover(t, p.id)} disabled={owner || busy === p.id} onCheckedChange={(on) => act(p.id, teamsApi.person(t.id, p.id, { approver: on }))} />
              <Switch aria-label={`${owner ? 'You' : p.name} can start runs`} checked={owner || !!p.canStartRuns} disabled={owner || busy === p.id} onCheckedChange={(on) => act(p.id, teamsApi.person(t.id, p.id, { canStartRuns: on }))} />
              {owner ? (
                <span />
              ) : (
                <Button variant="ghost" size="icon" aria-label={`Remove ${p.name}`} disabled={busy === p.id} onClick={() => act(p.id, teamsApi.removePerson(t.id, p.id))}>
                  ×
                </Button>
              )}
            </li>
          );
        })}
        {members.map((m) => (
          <li key={m.id} className="tp-row agent">
            <span className="tp-who">
              <Face id={m.id} size={24} />
              <span>
                <b>{m.name}</b> <span className="tm-muted">{`agent${m.specialty ? ` · ${m.specialty}` : ''}`}</span>
              </span>
            </span>
            <span className="tp-na">people only</span>
            <span className="tp-na">via a person</span>
            <span />
          </li>
        ))}
      </ul>
      <p className="tm-muted">When someone without “Can start runs” asks for work, Tether replies with a proposal card that an allowed person starts. Approvals also land in your Inbox.</p>
    </div>
  );
}

/** A Telegram team with no group yet: the one-time `/pair` code, until the group sends it (the room's poll sees the link). */
export function PairPanel({ id, onGo }: { id: string; onGo: (r: Route) => void }) {
  const [c, setC] = useState<{ code: string; bot?: string } | { error: string }>();
  const [n, setN] = useState(0);
  useEffect(() => void teamsApi.pair(id).then(setC, (e: Error) => setC({ error: e.message })), [id, n]);
  return (
    <div className="tm-pair" role="status" aria-label="Link a Telegram group">
      <b>Link a Telegram group</b>
      {!c ? (
        <span className="tm-muted">Making a pairing code…</span>
      ) : 'error' in c ? (
        <>
          <span className="tm-muted">{c.error}</span>
          <Button variant="secondary" size="sm" onClick={() => onGo({ tab: 'settings' })}>
            Open Settings
          </Button>
        </>
      ) : (
        <>
          <span className="tm-muted">{`1. Add ${c.bot ? `@${c.bot}` : 'your bot'} to the group and make it an admin (to pin the live status). 2. Send this in the group:`}</span>
          <span className="acc-code-row">
            <code className="acc-code">{`/pair ${c.code}`}</code>
            <CopyButton value={`/pair ${c.code}`} label="Copy" />
          </span>
          <span className="tm-muted">
            Waiting for /pair… The code works once, for 10 minutes.{' '}
            <button type="button" className="tm-link" onClick={() => setN(n + 1)}>
              New code
            </button>
          </span>
        </>
      )}
    </div>
  );
}
