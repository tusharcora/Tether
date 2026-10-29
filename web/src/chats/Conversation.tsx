import { ChevronDown, Ellipsis } from 'lucide-react';
import { useRef, useState } from 'react';
import { Chat } from '../assistant/Chat';
import { TITLE_MAX, type AssistantContext } from '../assistant/api';
import type { Assistant } from '../assistant/useAssistant';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { MenuButton } from '../ui/studio/ToolFrame';
import './chats.css';

/**
 * A chat full screen (mockup board 2): the title (its menu renames or deletes), the project, Pop out to the mini chat and
 * the same menu under ⋯; the thread in a centred 760 px column with the composer pinned under it.
 */
export function Conversation(p: { chat: Assistant; project?: { id: string; name: string }; context: AssistantContext; onGo: (r: Route) => void; onPopOut: () => void; onRenamed: () => void; onDelete: () => Promise<void> }) {
  const notify = useNotify();
  const [renaming, setRenaming] = useState<string>();
  /** Escape leaves the title as it was (the field's blur would save it). */
  const cancelled = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const title = p.chat.title ?? 'New chat';
  const items = [
    { label: 'Rename', onSelect: () => ((cancelled.current = false), setRenaming(title)), disabled: !p.chat.chatId },
    { label: 'Delete', onSelect: () => setConfirm(true), disabled: !p.chat.chatId, danger: true },
  ];
  const rename = (t: string) => {
    cancelled.current = true;
    setRenaming(undefined);
    if (t.trim() && t.trim() !== title) void p.chat.rename(t.trim()).then(p.onRenamed, notify.fail);
  };
  return (
    <div className="chat-screen">
      <header className="chat-head">
        {renaming !== undefined ? (
          <form className="chat-rename" onSubmit={(e) => (e.preventDefault(), rename(renaming))}>
            <input aria-label="Chat title" value={renaming} maxLength={TITLE_MAX} autoFocus onChange={(e) => setRenaming(e.target.value)} onBlur={() => !cancelled.current && rename(renaming)} onKeyDown={(e) => e.key === 'Escape' && ((cancelled.current = true), setRenaming(undefined))} />
          </form>
        ) : (
          <MenuButton
            title={title}
            className="chat-title"
            label={
              <>
                <span className="truncate">{title}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </>
            }
            items={items}
          />
        )}
        {p.project ? <span className="chat-chip">{p.project.name}</span> : null}
        <span className="chat-head-gap" />
        <Button variant="secondary" size="sm" onClick={p.onPopOut}>
          Pop out <span aria-hidden="true">↘</span>
        </Button>
        <MenuButton title="Chat actions" variant="secondary" align="end" label={<Ellipsis size={15} aria-hidden="true" />} items={items} />
      </header>
      <Chat chat={p.chat} project={p.project?.name} context={p.context} onGo={p.onGo} wide placeholder="Reply to Tether…" />
      <Dialog open={confirm} onOpenChange={setConfirm}>
        {confirm ? (
          <DialogContent title="Delete this chat?" description={`"${title}" and its messages are deleted. Runs it started are kept.`}>
            <div className="row end">
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void p.onDelete().then(() => setConfirm(false), notify.fail)}>
                Delete
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
