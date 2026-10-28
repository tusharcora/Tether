import { GitPullRequest } from 'lucide-react';
import { ago } from '../api';
import { Switch } from '../components/beui/kit/fields';
import { cn } from '../ui/cn';
import { StatusBadge } from '../ui/studio/StatusBadge';
import { DEFAULT_EVENTS, OUTCOME, statusTip, who, type Trigger } from './types';
import './triggers.css';

/**
 * One trigger as a card (mockup .trig): where it listens, a flow line of what arrives → what it runs → what follows, its
 * on/off switch and when it last fired. A click opens it in the dock.
 */
export function TriggerCard(p: { t: Trigger; selected: boolean; onOpen: () => void; onToggle: () => void }) {
  const t = p.t;
  const filters = [t.labels?.length ? `Only with labels: ${t.labels.join(', ')}` : '', t.drafts ? 'includes drafts' : '', t.forks ? 'includes forks' : ''].filter(Boolean);
  const meta = [`workspace ${t.workspace ?? 'none'}`, who(t), ...filters].join(' · ');
  return (
    <li className={cn('tg-card', { paused: t.enabled === false, on: p.selected })}>
      <button type="button" className="tg-card-main" aria-label={`Open ${t.id}`} aria-pressed={p.selected} onClick={p.onOpen}>
        <span className="tg-ic" aria-hidden="true">
          <GitPullRequest size={18} />
        </span>
        <span className="tg-card-text">
          <span className="tg-line">
            <b className="tg-id">{t.id}</b>
            <span className="tg-dot" data-status={t.status} role="img" aria-label={t.status} title={statusTip[t.status]} />
            <span className="tg-status">{t.status}</span>
          </span>
          <span className="tg-src">{t.repo === '*' ? 'GitHub · any mapped repo' : `GitHub · ${t.repo}`}</span>
          <span className="tg-flow">
            <span className="tg-chip">{(t.events ?? DEFAULT_EVENTS).join(', ')}</span>
            <span aria-hidden="true">→</span>
            <span className="tg-chip">{`runs ${t.workflow}`}</span>
            {t.comment ? (
              <>
                <span aria-hidden="true">→</span>
                <span className="tg-chip">comments on the PR</span>
              </>
            ) : null}
          </span>
          <span className="tg-meta">{meta}</span>
        </span>
      </button>
      <span className="tg-side">
        <Switch aria-label={`${t.enabled === false ? 'Enable' : 'Pause'} ${t.id}`} checked={t.enabled !== false} onCheckedChange={p.onToggle} />
        {t.last ? (
          <span className="tg-last">
            <StatusBadge tone={OUTCOME[t.last.outcome].tone} label={OUTCOME[t.last.outcome].label} />
            <span className="sl-age">
              {t.last.pr ? `#${t.last.pr} · ` : ''}
              {ago(Date.parse(t.last.at))}
            </span>
          </span>
        ) : (
          <span className="sl-age">no deliveries</span>
        )}
      </span>
    </li>
  );
}
