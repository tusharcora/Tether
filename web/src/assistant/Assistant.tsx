import { useRef } from 'react';
import type { Route, Screen } from '../hooks';
import { useNotify } from '../ui/notify';
import { Chat } from './Chat';
import { contextLine, contextOf } from './context';
import { Launcher } from './Launcher';
import { Panel } from './Panel';
import { useAssistant } from './useAssistant';
import { useAssistantShell } from './useAssistantShell';
import './assistant.css';

export interface AssistantProps {
  /** The current project (its chat), if any. */
  project?: { id: string; name: string };
  /** The screen under the panel and what is selected on it. */
  route: Route & { tab: Screen };
  /** Items that need the person (the launcher's badge). */
  needs: number;
  phone: boolean;
  /** Where a citation or a started run goes. */
  onGo: (r: Route) => void;
}

/**
 * Tether, the assistant (spec §4): the launcher on every screen, opening a floating panel or a panel docked beside the
 * screen. Rendered inside the shell grid: docked, it is the grid's third column; floating, it is fixed over the screen.
 */
export function Assistant(p: AssistantProps) {
  const notify = useNotify();
  const shell = useAssistantShell({ needs: p.needs, phone: p.phone });
  const chat = useAssistant(p.project?.id, shell.mode !== 'closed');
  const launcherRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    shell.close();
    launcherRef.current?.focus();
  };
  const panel =
    shell.mode === 'closed' ? null : (
      <Panel
        mode={shell.mode}
        context={contextLine(p.project?.name, p.route.tab)}
        canDock={!p.phone}
        onDock={shell.dock}
        onNewChat={() => void chat.newChat().catch(notify.fail)}
        onClose={close}
      >
        <Chat chat={chat} project={p.project?.name} context={contextOf(p.route)} onGo={p.onGo} />
      </Panel>
    );
  return (
    <>
      {panel}
      {shell.docked ? null : <Launcher ref={launcherRef} open={shell.mode === 'float'} unseen={shell.unseen} onClick={() => (shell.mode === 'float' ? close() : shell.open())} />}
    </>
  );
}
