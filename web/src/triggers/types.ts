import type { WorkspaceRow } from '../home/workspaces';
import type { Tone } from '../ui/studio/StatusChip';

export interface Delivery { at: string; trigger?: string; source: 'webhook' | 'poll' | 'test'; repo: string; pr?: number; outcome: 'started' | 'ignored' | 'skipped' | 'error'; reason?: string; runId?: string }
export type Status = 'paused' | 'error' | 'idle' | 'active';
export interface Trigger {
  id: string; repo: string; workflow: string; workspace?: string; agent?: string; model?: string; events?: string[]; labels?: string[];
  comment?: boolean; drafts?: boolean; forks?: boolean; enabled?: boolean; status: Status; last: Delivery | null; warnings?: string[];
}
export type Workspace = WorkspaceRow;
export interface Setup { payloadPath: string; hasSecret: boolean; secretHint: string | null; secretSource: 'env' | 'file' | null; eventsToSelect: string[]; contentType: string }
export interface Form { id: string; repo: string; workflow: string; workspace: string; agent: string; model: string; events: string; labels: string; comment: boolean; drafts: boolean; forks: boolean }
export interface TestResult { matches: boolean; why: string; fired: boolean; runId?: string; pr: { repo: string; number: number; title: string; url: string }; note?: string }

export const EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'labeled'];
export const DEFAULT_EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review'];
export const blank = (): Form => ({ id: '', repo: '', workflow: 'full-review', workspace: '', agent: '', model: '', events: '', labels: '', comment: false, drafts: false, forks: false });
export const fromTrigger = (t: Trigger): Form => ({ id: t.id, repo: t.repo, workflow: t.workflow, workspace: t.workspace ?? '', agent: t.agent ?? '', model: t.model ?? '', events: (t.events ?? []).join(', '), labels: (t.labels ?? []).join(', '), comment: !!t.comment, drafts: !!t.drafts, forks: !!t.forks });
export const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
export const statusTip: Record<Status, string> = { paused: 'paused: PRs are ignored until you enable it', error: 'the last delivery failed', idle: 'waiting for a pull request', active: 'started a run in the last 24 hours' };
export const OUTCOME: Record<Delivery['outcome'], { tone: Tone; label: string }> = {
  started: { tone: 'done', label: 'run started' },
  ignored: { tone: 'neutral', label: 'ignored' },
  skipped: { tone: 'neutral', label: 'skipped' },
  error: { tone: 'failed', label: 'error' },
};
export const who = (t: Trigger) => (t.agent ? `${t.agent}${t.model ? ' · ' + t.model : ''}` : t.model ? `default · ${t.model}` : 'crew defaults');
