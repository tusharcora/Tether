import { FolderOpen } from 'lucide-react';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll } from '../hooks';
import { PathForm } from '../projects/PathForm';
import { Glyph } from '../ui/studio/Glyph';
import { TOOLS_PATH, ToolsStrip, type Tools } from './ToolsStrip';
import './welcome.css';

const initials = (name: string) => name.replace(/[^a-z0-9]+/gi, ' ').trim().split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '·';

/**
 * First launch (no projects yet): open a folder, pick a recent project, see which agent tools this machine has. A browser
 * cannot hand over a folder's path, so it types one; Tether.app adds the drop zone and the folder picker.
 */
export function Welcome(p: { recent: WorkspaceRow[]; onAdd: (path: string) => Promise<unknown>; onPick: (id: string) => void; onSkip: () => void }) {
  const tools = usePoll<Tools>(TOOLS_PATH, 60_000);
  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="welcome-head">
          <Glyph size={44} />
          <div>
            <h1>Open a project</h1>
            <p>Pick a folder on this machine. Tether runs your crew on it and shows you its code.</p>
          </div>
        </div>
        <section className="welcome-open" aria-label="Open a folder">
          <FolderOpen size={26} strokeWidth={1.6} aria-hidden="true" />
          <p>Type the full path of a project folder.</p>
          <PathForm autoFocus onOpen={p.onAdd} />
        </section>
        {p.recent.length ? (
          <section aria-labelledby="welcome-recent">
            <h2 id="welcome-recent">Recent</h2>
            {p.recent.map((w) => (
              <button key={w.id} type="button" className="welcome-recent" onClick={() => p.onPick(w.id)}>
                <span className="welcome-mono" aria-hidden="true">
                  {initials(w.name)}
                </span>
                <span>
                  <b>{w.name}</b>
                  <span className="welcome-path">{w.path}</span>
                </span>
              </button>
            ))}
          </section>
        ) : null}
        <section className="welcome-tools" aria-labelledby="welcome-tools">
          <h2 id="welcome-tools">Agent tools on this machine</h2>
          <ToolsStrip poll={tools} />
          <p>Found on the server's PATH. Missing one? Install it, then restart Tether.</p>
        </section>
        <button type="button" className="welcome-skip" onClick={p.onSkip}>
          Continue without a project
        </button>
      </div>
    </main>
  );
}
