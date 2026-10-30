import { useState } from 'react';
import type { RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import type { GoalView } from '../goals/goalsApi';
import type { RunAct } from '../Runs';
import { useNotify } from '../ui/notify';
import { gateSummary } from './ApprovalBar';
import { sendBackNote, sendBackTarget, type useComments } from './comments';
import { decisionLine, decisionOf } from './storyModel';

/**
 * What the run waits on, as one banner (board 4). The last approval before shipping: Merge to main (a PR, merged when its
 * checks pass), Open PR instead, or Send back… (your comments and a reason go back to the step as its rework note). An
 * approval part way through: Approve or Reject, or Send back. A team's run is only approved here: its team opens the PR.
 */
export function DecisionBanner(p: { run: RunView; goal?: GoalView; team?: boolean; comments: ReturnType<typeof useComments>; open?: string; onAct: RunAct; nameOf: (node: string) => string; botName: (node: string) => string }) {
  const notify = useNotify();
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string>();
  const r = p.run;
  const d = decisionOf(r);
  const unsent = p.comments.list.filter((c) => !c.sent);
  if (!d) return null;
  const target = sendBackTarget(r, unsent, p.open);
  const act = async (label: string, path: string, body: unknown, done?: string) => {
    setBusy(label);
    const ok = await p.onAct(path, body);
    setBusy(undefined);
    if (ok && done) notify.ok(done);
    return ok;
  };
  const sendBack = async () => {
    if (!target) return;
    const note = sendBackNote(unsent, reason || 'The person sent this back.');
    if (await act('back', 'sendback', { node: target, note }, `Sent back to ${p.botName(target)}`)) {
      p.comments.markSent(unsent.map((c) => c.id));
      setSending(false);
      setReason('');
    }
  };
  const g = p.goal;
  const check = g?.check ? `Done when: ${g.check.command}${g.lastCheck ? ` ${g.lastCheck.ok ? '✓' : '✕'}${g.lastCheck.summary ? ` ${g.lastCheck.summary}` : ''}` : ''}` : gateSummary(r);
  const sentCount = p.comments.list.filter((c) => c.sent).length;
  const line = [check, unsent.length ? `${unsent.length} comment${unsent.length === 1 ? '' : 's'} of yours not sent yet` : sentCount ? `${sentCount} comment${sentCount === 1 ? '' : 's'} of yours went back` : ''].filter(Boolean).join(' · ');
  return (
    <div className="rp-decide" role="region" aria-label="Decision">
      <span className="rp-you" aria-hidden="true">✓</span>
      <div className="rp-decide-t">
        <b>{d.final ? decisionLine(r, (n) => p.nameOf(n.id)) : `Approve “${d.title}”?`}</b>
        <span>{line}</span>
      </div>
      {d.final ? (
        <>
          <Button size="sm" variant="primary" loading={busy === 'merge'} disabled={!!busy} onClick={() => void act('merge', 'ship', { merge: !p.team }, p.team ? 'Approved: the team opens the PR' : 'Approved: it merges once the PR’s checks pass')}>
            {p.team ? 'Approve & open PR' : 'Merge to main'}
          </Button>
          {p.team ? null : (
            <Button size="sm" variant="secondary" loading={busy === 'pr'} disabled={!!busy} onClick={() => void act('pr', 'ship', { merge: false }, 'Approved: the PR opens when the run finishes')}>
              Open PR instead
            </Button>
          )}
        </>
      ) : (
        <>
          <Button size="sm" variant="primary" loading={busy === 'yes'} disabled={!!busy} onClick={() => void act('yes', 'approve', { node: d.node, approved: true })}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act('no', 'approve', { node: d.node, approved: false })}>
            Reject
          </Button>
        </>
      )}
      {target ? (
        <Button size="sm" variant="ghost" aria-expanded={sending} disabled={!!busy} onClick={() => setSending(!sending)}>
          Send back…
        </Button>
      ) : null}
      {sending && target ? (
        <form className="rp-back" onSubmit={(e) => (e.preventDefault(), void sendBack())}>
          <p className="rp-back-t">{`${unsent.length ? `${unsent.length} comment${unsent.length === 1 ? '' : 's'} and your reason go` : 'Your reason goes'} back to ${p.botName(target)}, who works on it again; the steps after it run again too.`}</p>
          {unsent.length ? (
            <ul className="rp-back-list" aria-label="Your comments">
              {unsent.map((c) => (
                <li key={c.id}>
                  <span className="mono">{c.file}</span> {c.text}
                </li>
              ))}
            </ul>
          ) : null}
          <label htmlFor="rp-why">{unsent.length ? 'Why (optional)' : 'What should change?'}</label>
          <textarea id="rp-why" rows={2} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="rp-back-row">
            <Button type="button" size="sm" variant="ghost" onClick={() => setSending(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="secondary" loading={busy === 'back'} disabled={!unsent.length && !reason.trim()}>
              Send back
            </Button>
          </span>
        </form>
      ) : null}
    </div>
  );
}
