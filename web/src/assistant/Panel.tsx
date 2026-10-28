import { PanelRight, PictureInPicture2, SquarePen, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { TetherFace } from '../components/faces/TetherFace';

/**
 * The assistant's panel: floating (384×560, springing from the launcher's corner) or docked (420 px beside the screen).
 * The header holds Tether's face, its name and what it knows ("knows <project> · sees the <page> page"), New chat, dock or
 * pop out (not on a phone), and close.
 */
export function Panel(p: { mode: 'float' | 'docked'; context: string; canDock: boolean; onDock: (on: boolean) => void; onNewChat: () => void; onClose: () => void; children: ReactNode }) {
  const reduce = useReducedMotion();
  const float = p.mode === 'float';
  const enter = reduce ? { opacity: 0 } : float ? { opacity: 0, scale: 0.94, y: 10 } : { opacity: 0, x: 20 };
  return (
    <motion.section
      key={p.mode}
      className={`tether-panel ${p.mode}`}
      aria-label="Tether assistant"
      initial={enter}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      transition={{ duration: float ? 0.28 : 0.26, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="tether-head">
        <TetherFace size={24} within=".tether-panel" />
        <div className="tether-head-text">
          <div className="tether-head-title">Tether</div>
          <div className="tether-head-ctx">{p.context}</div>
        </div>
        <button type="button" className="tether-icon-btn" aria-label="New chat" title="New chat" onClick={p.onNewChat}>
          <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {p.canDock ? (
          float ? (
            <button type="button" className="tether-icon-btn" aria-label="Dock to the side" title="Dock to the side" onClick={() => p.onDock(true)}>
              <PanelRight size={16} strokeWidth={1.7} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="tether-icon-btn" aria-label="Pop out" title="Pop out" onClick={() => p.onDock(false)}>
              <PictureInPicture2 size={16} strokeWidth={1.7} aria-hidden="true" />
            </button>
          )
        ) : null}
        <button type="button" className="tether-icon-btn" aria-label="Close Tether" title="Close" onClick={p.onClose}>
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      <div className="tether-body">{p.children}</div>
    </motion.section>
  );
}
