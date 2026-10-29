import { Check, ChevronDown, FileText, Play, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SearchField } from '../components/beui/kit/fields';
import { useMenu } from '../ui/studio/useMenu';
import type { ChatSummary } from './api';

/** Chats the switcher lists under its search (the rest are in All chats). */
const SHOWN = 8;

/**
 * The mini chat's title, a button that opens the chat switcher (mockup board 5): find a chat, + New chat, the recent chats
 * with the open one ticked, All chats →. A click outside or Escape closes it (focus back on the title).
 */
export function ChatSwitcher(p: { title: string; chats: ChatSummary[]; current?: string; onPick: (id: string | undefined) => void; onAll: () => void; onStarter: (s: 'run' | 'file') => void }) {
  const menu = useMenu();
  const [find, setFind] = useState('');
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!menu.open) return;
    setFind('');
    findRef.current?.focus();
  }, [menu.open]);
  const q = find.trim().toLowerCase();
  const shown = p.chats.filter((c) => c.title.toLowerCase().includes(q)).slice(0, SHOWN);
  const pick = (id: string | undefined) => {
    menu.close();
    p.onPick(id);
  };
  return (
    <span className="tether-switch">
      <button ref={menu.triggerRef} type="button" className="tether-switch-btn" aria-label={`Switch chat (${p.title})`} aria-haspopup="dialog" aria-expanded={menu.open} onClick={menu.toggle}>
        <span className="tether-switch-title">{p.title}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menu.open ? (
        // Escape closes the switcher only, not the mini chat under it
        <div ref={menu.menuRef} className="tether-switch-pop" role="dialog" aria-label="Switch chat" onKeyDown={(e) => (e.key === 'Escape' && e.stopPropagation(), menu.onMenuKey(e))}>
          <SearchField ref={findRef} label="Find a chat" placeholder="Find a chat" value={find} onValueChange={setFind} />
          <button type="button" className="tether-switch-item" onClick={() => pick(undefined)}>
            <Plus size={14} aria-hidden="true" />
            New chat
          </button>
          {/* the New chat menu's other two choices, as rows: a menu opened from this popup would close it */}
          <button type="button" className="tether-switch-item" onClick={() => (menu.close(), p.onStarter('run'))}>
            <Play size={14} aria-hidden="true" />
            About a run
          </button>
          <button type="button" className="tether-switch-item" onClick={() => (menu.close(), p.onStarter('file'))}>
            <FileText size={14} aria-hidden="true" />
            About a file
          </button>
          {shown.map((c) => (
            <button key={c.id} type="button" className="tether-switch-item" aria-current={c.id === p.current || undefined} onClick={() => pick(c.id)}>
              <span className="tether-switch-title">{c.title}</span>
              {c.id === p.current ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
          {q && !shown.length ? <p className="tether-switch-empty">No chat matches.</p> : null}
          <button type="button" className="tether-switch-item tether-switch-all" onClick={() => (menu.close(), p.onAll())}>
            All chats <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
    </span>
  );
}
