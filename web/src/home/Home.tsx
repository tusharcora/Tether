import type { Route } from '../hooks';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import './home.css';

/** Home: what needs you, what is running, and where to start the next run. Sections are added in the Home phase. */
export function Home(_props: { onGo: (r: Route) => void }) {
  return (
    <div className="home">
      <ScreenHeader meta="aorch · this machine" title="Home" summary="What needs you, what is running, and a place to start the next run." />
      <div className="home-grid" />
    </div>
  );
}
