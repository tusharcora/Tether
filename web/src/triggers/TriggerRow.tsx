import { ago } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Switch } from '../components/beui/kit/fields';
import { cn } from '../ui/cn';
import { ConfirmButton } from '../ui/ConfirmButton';
import { StatusChip } from '../ui/studio/StatusChip';
import { DEFAULT_EVENTS, OUTCOME, statusTip, who, type Trigger } from './types';
import './triggers.css';

/** One trigger as a board row: what it listens to, what it starts, its last delivery, and its controls. */
export function TriggerRow(p: { t: Trigger; onToggle: () => void; onTest: () => void; onLog: () => void; onEdit: () => void; onDelete: () => void | Promise<unknown> }) {
  const t = p.t;
  const filters = [t.labels?.length ? `Only with labels: ${t.labels.join(', ')}` : '', t.drafts ? 'includes drafts' : '', t.forks ? 'includes forks' : ''].filter(Boolean);
  const meta = [`workspace ${t.workspace ?? 'none'}`, who(t), ...filters].join(' · ');
  return (
    <li className={cn('tg-row', { paused: t.enabled === false })}>
      <span className="tg-dot" data-status={t.status} role="img" aria-label={t.status} title={statusTip[t.status]} />
      <div className="tg-main">
        <div className="tg-line">
          <span className="tg-id">{t.id}</span>
          <span className="tg-status">{t.status}</span>
          {(t.events ?? DEFAULT_EVENTS).map((e) => (
            <span key={e} className="tg-chip">
              {e}
            </span>
          ))}
        </div>
        <div className="tg-target">
          {t.repo} → <code>{t.workflow}</code>
          {t.comment ? (
            <span className="tg-chip" title="posts the result on the PR">
              comments
            </span>
          ) : null}
        </div>
        <div className="tg-meta">{meta}</div>
      </div>
      <div className="tg-last">
        {t.last ? (
          <>
            <StatusChip tone={OUTCOME[t.last.outcome].tone} label={OUTCOME[t.last.outcome].label} />
            <span className="sl-age">
              {t.last.pr ? `#${t.last.pr} · ` : ''}
              {ago(Date.parse(t.last.at))}
            </span>
          </>
        ) : (
          <span className="sl-age">no deliveries</span>
        )}
      </div>
      <Switch aria-label={`${t.enabled === false ? 'Enable' : 'Pause'} ${t.id}`} checked={t.enabled !== false} onCheckedChange={p.onToggle} />
      <div className="tg-actions">
        <Button variant="ghost" size="sm" onClick={p.onTest}>
          Test
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onLog}>
          Log
        </Button>
        <Button variant="secondary" size="sm" onClick={p.onEdit}>
          Edit
        </Button>
        <ConfirmButton label="Delete" prompt={`Delete ${t.id}?`} confirmLabel="Yes, delete" onConfirm={p.onDelete} />
      </div>
    </li>
  );
}
