import { useRef, useState } from 'react';
import { ArtifactViewer } from '../artifacts/ArtifactViewer';
import { CenterMorphModalContent } from '../components/beui/motion/center-morph-modal';
import { Dialog } from '../components/beui/kit/overlays';
import type { Route, Screen } from '../hooks';
import type { ArtifactRef, ChatSummary } from './api';
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
  // the mini chat is too narrow for a side panel: an artifact opens over the screen
  const [artifact, setArtifact] = useState<ArtifactRef>();
  if (p.hidden) return null;
  const close = () => {
    shell.close();
    launcherRef.current?.focus();
  };
  const panel =
    shell.mode === 'closed' ? null : (
      <Panel
        mode={shell.mode}
        switcher={<ChatSwitcher title={chat.title ?? 'New chat'} chats={p.chats} current={chat.chatId} onPick={p.onPick} onAll={p.onAllChats} />}
        context={contextLine(p.route)}
        canDock={!p.phone}
        onDock={shell.dock}
        onNewChat={() => p.onPick(undefined)}
        onFullScreen={p.onFullScreen}
        onClose={close}
      >
        <Chat chat={chat} project={p.project?.name} context={contextOf(p.route)} onGo={p.onGo} idle={<RunningNow onGo={p.onGo} />} onArtifact={setArtifact} onNewChat={() => p.onPick(undefined)} />
      </Panel>
    );
  const closeArtifact = () => setArtifact(undefined);
  return (
    <>
      {panel}
      <Dialog open={!!artifact} onOpenChange={(o) => !o && closeArtifact()}>
        {artifact ? (
          <CenterMorphModalContent ariaLabel={artifact.title} showCloseButton={false} className="h-[min(820px,88vh)] w-[min(1100px,94vw)] max-w-none overflow-hidden rounded-xl">
            <ArtifactViewer ws={p.project?.id} id={artifact.id} version={artifact.version} project={p.project?.name} onClose={closeArtifact} />
          </CenterMorphModalContent>
        ) : null}
      </Dialog>
      {shell.docked ? null : <Launcher ref={launcherRef} open={shell.mode === 'float'} unseen={shell.unseen} onClick={() => (shell.mode === 'float' ? close() : shell.open())} />}
    </>
  );
}
