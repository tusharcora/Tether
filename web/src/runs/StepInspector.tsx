import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { RunView, StoredEvent } from '../api';
import { useReducedMotionPref } from '../components/Loading';
import { crewFor, useCrew } from '../crewStore';
import type { RunAct } from '../Runs';
import { Kbd } from '../ui/studio/Kbd';
import { stepOrder } from './graphModel';
import { neighbour } from './inspectorModel';
import { RunDetails } from './RunDetails';
import type { InspectorTarget } from './RunPage';
import { StepView } from './StepView';
import './inspector.css';

const SLIDE = { type: 'spring', stiffness: 380, damping: 36 } as const;

/** Keys typed into a field stay there: ← → move the caret and Esc only leaves the field. */
const typing = (t: EventTarget | null): t is HTMLElement => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
/** Tabs and radio groups keep their own arrow keys. */
const ownsArrows = (t: EventTarget | null) => typing(t) || (t instanceof HTMLElement && !!t.closest('[role="tablist"],[role="radiogroup"]'));

/**
 * The inspector (approved mockup docs/design/StepInspector.html): a 440 px panel that slides over the run. Step mode moves
 * between steps (buttons, dots, ← →) and slides the content that way; run mode shows the branch's changes and every event.
 * Esc, × or the scrim close it.
 */
export function StepInspector(p: { run: RunView; events: StoredEvent[]; target: InspectorTarget; onTarget: (t: InspectorTarget) => void; onClose: () => void; onAct: RunAct; onOpenFile?: (file: string) => void }) {
  const r = p.run;
  const { crew } = useCrew();
  const reduce = useReducedMotionPref();
  const order = stepOrder(r.pipeline.nodes, r.pipeline.edges);
  const step = p.target.mode === 'step' ? p.target.node : undefined;
  const at = step ? order.indexOf(step) : -1;
  const [dir, setDir] = useState<1 | -1>(1);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);

  const go = (to: string | undefined, d: 1 | -1) => {
    if (!to) return;
    setDir(d);
    p.onTarget({ mode: 'step', node: to });
  };
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.key === 'Escape') {
      if (typing(e.target)) e.target.blur();
      else p.onClose();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && step && !ownsArrows(e.target)) {
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      go(neighbour(order, step, d), d);
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const nameOf = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n ? (crew[crewFor(n, crew)]?.name ?? id) : id;
  };
  const slide = reduce ? undefined : { enter: (d: number) => ({ x: d * 24, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: -d * 24, opacity: 0 }) };

  return (
    <>
      <div className="insp-scrim" onClick={p.onClose} aria-hidden="true" />
      <motion.aside
        ref={panel}
        tabIndex={-1}
        className="insp"
        aria-label={step ? 'Step inspector' : 'Run details'}
        initial={reduce ? false : { x: '100%' }}
        animate={{ x: 0 }}
        exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { x: '100%' }}
        transition={SLIDE}
      >
        <header className="insp-head">
          {step ? (
            <>
              <button type="button" className="insp-nav" aria-label="Previous step" disabled={at <= 0} onClick={() => go(neighbour(order, step, -1), -1)}>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <button type="button" className="insp-nav" aria-label="Next step" disabled={at < 0 || at >= order.length - 1} onClick={() => go(neighbour(order, step, 1), 1)}>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
              <span className="insp-dots">
                {order.map((id, i) => (
                  <button key={id} type="button" className="insp-dot" aria-label={`Step ${i + 1}: ${nameOf(id)}`} aria-current={id === step ? 'step' : undefined} onClick={() => go(id, i < at ? -1 : 1)} />
                ))}
              </span>
              {at >= 0 ? <span className="insp-count">{`${at + 1} of ${order.length}`}</span> : null}
              <span className="insp-keys" aria-hidden="true">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
                <Kbd>esc</Kbd>
              </span>
            </>
          ) : (
            <span className="insp-title">
              <b>Run details</b>
              <span className="sl-meta">{`${r.branch}${r.notes.length ? ` · ${r.notes.length} vault notes` : ''}`}</span>
            </span>
          )}
          <button type="button" className="insp-close" aria-label="Close inspector" onClick={p.onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="insp-stage">
          {step ? (
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div key={step} className="insp-page" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.22, ease: [0.2, 0.9, 0.25, 1] }}>
                <StepView run={r} events={p.events} node={step} onAct={p.onAct} onOpenFile={p.onOpenFile} />
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="insp-page">
              <RunDetails run={r} events={p.events} tab={p.target.mode === 'run' ? p.target.tab : 'changes'} onTab={(tab) => p.onTarget({ mode: 'run', tab })} onOpenFile={p.onOpenFile} />
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}
