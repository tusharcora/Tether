import { useRef } from 'react';
import type { Route, Screen } from '../hooks';
import type { ChatSummary } from './api';
import { RunningNow } from '../home/AgentsRunning';
import { Chat } from './Chat';
import { ChatSwitcher } from './ChatSwitcher';
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
  /** The project's chats, newest first, for the switcher. */
  chats: ChatSummary[];
  /** Make a chat the active one (none: a new chat). */
  onPick: (id: string | undefined) => void;
  /** The active chat full screen. */
  onFullScreen: () => void;
  onAllChats: () => void;
  /** New chat about a run or a file (the New chat screen with that starter). */
  onStarter: (s: 'run' | 'file') => void;
  /** Where a citation or a started run goes. */
  onGo: (r: Route) => void;
}

/**
 * Tether, the assistant (spec §4): the launcher on every screen, opening the mini chat (floating) or a panel docked beside
 * the screen, both on the active chat. Rendered inside the shell grid: docked, it is the grid's third column; floating,
 * it is fixed over the screen.
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
      <Panel
        mode={shell.mode}
        switcher={<ChatSwitcher title={chat.title ?? 'New chat'} chats={p.chats} current={chat.chatId} onPick={p.onPick} onAll={p.onAllChats} onStarter={p.onStarter} />}
        context={contextLine(p.route)}
        canDock={!p.phone}
        onDock={shell.dock}
        onNewChat={() => p.onPick(undefined)}
        onStarter={p.onStarter}
        onFullScreen={p.onFullScreen}
        onClose={close}
      >
        <Chat chat={chat} project={p.project?.name} context={contextOf(p.route)} onGo={p.onGo} idle={<RunningNow onGo={p.onGo} />} />
      </Panel>
    );
  return (
    <>
      {panel}
      {shell.docked ? null : <Launcher ref={launcherRef} open={shell.mode === 'float'} unseen={shell.unseen} onClick={() => (shell.mode === 'float' ? close() : shell.open())} />}
    </>
  );
}
