import { usePoll, type Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { StartRun } from './StartRun';
import { WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from './workspaces';
import './home.css';

/** Home: what needs you, what is running, and where to start the next run. Owns the one /api/workspaces poll its sections share. */
export function Home(props: { onGo: (r: Route) => void }) {
  const notify = useNotify();
  const workspaces = usePoll<WorkspaceRow[]>(WORKSPACES_PATH, WORKSPACES_MS);
  return (
    <div className="home">
      <ScreenHeader meta="aorch · this machine" title="Home" summary="What needs you, what is running, and a place to start the next run." />
      <div className="home-grid">
        <StartRun workspaces={workspaces} onGo={props.onGo} onStarted={(id) => notify.ok('Run started', id)} />
      </div>
    </div>
  );
}
