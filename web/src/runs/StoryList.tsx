import type { ReactNode } from 'react';
import type { RunView } from '../api';
import { Face, moodFor } from '../Face';
import type { RunAct } from '../Runs';
import { TeamPanel } from '../Team';
import { cn } from '../ui/cn';
import type { StoryRow } from './storyModel';

const MARK: Record<StoryRow['state'], string> = { done: '✓', failed: '✕', waiting: '·', working: '', queued: '', skipped: '–' };
const WORD: Record<StoryRow['state'], string> = { done: 'done', failed: 'failed', waiting: 'waiting on you', working: 'working', queued: 'not started', skipped: 'skipped' };

/**
 * What happened (board 4): one row per step as a sentence, with its face, one muted line and a state mark. Picking a row
 * fills the middle. A team run's questions or plan for you are a row that opens in place.
 */
export function StoryList({ run: r, rows, selected, onSelect, onAct, menu }: { run: RunView; rows: StoryRow[]; selected?: string; onSelect: (row: StoryRow) => void; onAct: RunAct; /** A row's ⋯ (rewind, fork), when it has one. */ menu?: (row: StoryRow) => ReactNode }) {
  const steps = rows.filter((x) => x.node).length;
  return (
    <nav className="rp-story" aria-label="What happened">
      <div className="rp-story-head">
        <b>What happened</b>
        <span>{`${steps} step${steps === 1 ? '' : 's'}`}</span>
      </div>
      {rows.map((row) =>
        row.id === 'questions' ? (
          <div key={row.id} className="rp-st you open" role="group" aria-label={row.sentence}>
            <span className="rp-st-top">
              <span className="rp-you" aria-hidden="true">?</span>
              <span className="rp-st-t">
                {row.sentence}
                <small className="warn">{row.line}</small>
              </span>
            </span>
            <TeamPanel run={r} send={(path, body) => onAct(path, body)} />
          </div>
        ) : (
          <div key={row.id} className="rp-st-row">
            <button type="button" className={cn('rp-st', row.you && 'you', `s-${row.state}`)} aria-current={selected === row.id ? 'step' : undefined} aria-label={`${row.sentence}, ${WORD[row.state]}`} onClick={() => onSelect(row)}>
              {row.bot ? <Face id={row.bot === 'tether' ? 'orchestrator' : row.bot} size={24} mood={moodFor(row.state === 'working' ? 'running' : row.state === 'failed' ? 'error' : row.state === 'done' ? 'done' : 'queued')} animate={row.state === 'working' ? 'always' : undefined} /> : <span className="rp-you" aria-hidden="true">·</span>}
              <span className="rp-st-t">
                {row.sentence}
                {row.line ? <small className={cn(row.state === 'waiting' && 'warn', row.state === 'failed' && 'bad')}>{row.line}</small> : null}
              </span>
              {MARK[row.state] ? (
                <span className={cn('rp-mark', `s-${row.state}`)} aria-hidden="true">
                  {MARK[row.state]}
                </span>
              ) : null}
            </button>
            {menu?.(row)}
          </div>
        ),
      )}
    </nav>
  );
}
