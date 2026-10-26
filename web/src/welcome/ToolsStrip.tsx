import { Loading } from '../components/Loading';
import type { Poll } from '../hooks';
import { cn } from '../ui/cn';
import { InlineError } from '../ui/studio/InlineError';
import './welcome.css';

export interface Tools {
  agents: { id: string; ok: boolean; version?: string }[];
  /** ripgrep, used by code search when present. */
  rg: { ok: boolean; version?: string };
}

export const TOOLS_PATH = '/api/tools';

/** Which agent CLIs and ripgrep the server finds on its PATH: a green dot and the version when found, grey "not found" when not. */
export function ToolsStrip(p: { poll: Poll<Tools> }) {
  const { data, error, refresh } = p.poll;
  if (error && !data) return <InlineError message={error} onRetry={() => void refresh()} />;
  const all = data ? [...data.agents, { id: 'rg', ...data.rg }] : [];
  return (
    <Loading loading={!data} lines={1} label="Looking for agent tools">
      <ul className="tools-strip" aria-label="Agent tools">
        {all.map((t) => (
          <li key={t.id} className="tool-chip" title={!t.ok ? 'Not found on PATH' : t.id === 'rg' ? 'ripgrep, used for code search' : 'Found'}>
            <span className={cn('tool-dot', { ok: t.ok })} aria-hidden="true" />
            {t.id}
            <span className="tool-v">{t.ok ? (t.version ?? 'found') : 'not found'}</span>
          </li>
        ))}
      </ul>
    </Loading>
  );
}
