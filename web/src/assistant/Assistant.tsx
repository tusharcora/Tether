import { useRef } from 'react';
import type { Route, Screen } from '../hooks';
import { Chat } from './Chat';
import { contextLine, contextOf } from './context';
import { Launcher } from './Launcher';
import { Panel } from './Panel';
import type { Assistant as Chatting } from './useAssistant';
import type { useAssistantShell } from './useAssistantShell';
import './assistant.css';

export interface AssistantProps {
  /** Where the panel is (closed, floating, docked): App owns it, so the chat screens can pop a chat out into it. */
  shell: ReturnType<typeof useAssistantShell>;
  /** The active chat, shared with the full-screen chat. */
  chat: Chatting;
  /** The current project, if any. */
  project?: { id: string; name: string };
  /** The screen under the panel and what is selected on it. */
  route: Route & { tab: Screen };
  phone: boolean;
  /** On a full-screen chat the launcher and the panel step aside. */
  hidden?: boolean;
  onNewChat: () => void;
  /** Where a citation or a started run goes. */
  onGo: (r: Route) => void;
}

/**
 * Tether, the assistant (spec §4): the launcher on every screen, opening a floating panel or a panel docked beside the
 * screen. Rendered inside the shell grid: docked, it is the grid's third column; floating, it is fixed over the screen.
 */
export function Assistant(p: AssistantProps) {
  const { shell, chat } = p;
  const launcherRef = useRef<HTMLButtonElement>(null);
  if (p.hidden) return null;
  const close = () => {
    shell.close();
    launcherRef.current?.focus();
  };
  const panel =
    shell.mode === 'closed' ? null : (
      <Panel mode={shell.mode} context={contextLine(p.project?.name, p.route.tab)} canDock={!p.phone} onDock={shell.dock} onNewChat={p.onNewChat} onClose={close}>
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
