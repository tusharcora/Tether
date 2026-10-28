import { Eye, Plug, RefreshCw, Settings, Share2, FlaskConical, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ConnectorView } from '../../../src/codemode/connectorsTypes.js';
import { ago, api } from '../api';
import { ActionNode, type NodeTone } from '../components/bencho/ActionNode';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { Poll } from '../hooks';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { StatusChip, type Tone } from '../ui/studio/StatusChip';
import { PHONE, useMediaQuery } from '../ui/studio/useMediaQuery';
import '../runs/runflow.css';
import './settings.css';

export type { ConnectorView };
export const CONNECTORS_PATH = '/api/codemode/connectors';

/** Green connected, amber needs you, gray off: the colour never stands alone (the label rides with it). */
export const STATUS: Record<ConnectorView['status'], { tone: NodeTone; chip: Tone; label: string }> = {
  connected: { tone: 'done', chip: 'done', label: 'Connected' },
  needs: { tone: 'needs', chip: 'needs', label: 'Needs you' },
  off: { tone: 'idle', chip: 'neutral', label: 'Off' },
};

const W = 300;
const H = 70;
/** Between the ring's nodes and the panel under it, so a node's fan never lands on the panel. */
const PANEL_GAP = 72;

/** Node spots on an ellipse round the centre, the first straight up. */
export function ring(n: number, rx: number, ry: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
    return { x: Math.round(Math.cos(a) * rx), y: Math.round(Math.sin(a) * ry) };
  });
}

function useActions() {
  const notify = useNotify();
  const test = async (name: string) => {
    try {
      const r = await api<{ ok: boolean; detail: string }>('POST', `${CONNECTORS_PATH}/${encodeURIComponent(name)}/test`, {});
      (r.ok ? notify.ok : notify.info)(`${name}: ${r.detail}`);
    } catch (e) {
      notify.fail(e);
    }
  };
  /** GitHub is reconnected in Accounts, an MCP server by connecting again (a test does it). */
  const reconnect = (c: ConnectorView) => (c.name === 'github' ? (location.hash = '#/settings/accounts') : void test(c.name));
  return { test, reconnect };
}

/** The map: Tether in the centre, each connector round it, its fan (Test, Reconnect, Permissions, Settings), and the selected one's panel below. */
export function ConnectorMap(p: { connectors: ConnectorView[]; onAdd: () => void }) {
  const [sel, setSel] = useState<string>();
  const { test, reconnect } = useActions();
  const list = p.connectors;
  const slots = ring(list.length + 1, 380, 220);
  const rx = 380 + W / 2 + 16;
  const ry = 220 + H / 2 + 56;
  const chosen = list.find((c) => c.name === sel);
  const spots = [...list.map((c, i) => ({ c, ...slots[i]! })), { c: undefined, ...slots[list.length]! }];
  return (
    <div className="cm">
      <div className="cm-map" style={{ width: rx * 2, height: ry * 2 }}>
        <svg className="cm-edges" width={rx * 2} height={ry * 2} aria-hidden="true">
          {spots.map((s, i) => (
            <line key={i} x1={rx} y1={ry} x2={rx + s.x} y2={ry + s.y} className={cmEdge(s.c)} />
          ))}
        </svg>
        <div className="cm-node" style={{ left: rx - W / 2, top: ry - H / 2, width: W }}>
          <ActionNode compact label="Tether actions" mark={<Plug aria-hidden="true" />} title="Tether" line="Code Mode · run_code" tone="live" toneLabel="Code Mode on" actions={[]} />
        </div>
        {spots.map((s) =>
          s.c ? (
            <div key={s.c.name} className="cm-node" style={{ left: rx + s.x - W / 2, top: ry + s.y - H / 2, width: W }}>
              <ActionNode
                compact
                tabbable={sel === s.c.name}
                className={s.c.status === 'off' ? 'cm-off' : undefined}
                label={`${s.c.name} actions`}
                mark={<Share2 aria-hidden="true" />}
                title={<button type="button" className="rf-open" aria-label={`${s.c.name}, ${STATUS[s.c.status].label}. Show details`} onClick={() => setSel(s.c!.name)}>{s.c.name}</button>}
                line={s.c.summary}
                tone={STATUS[s.c.status].tone}
                toneLabel={STATUS[s.c.status].label}
                actions={[
                  { id: 'test', label: 'Test', icon: <FlaskConical />, onSelect: () => void test(s.c!.name) },
                  { id: 'reconnect', label: 'Reconnect', icon: <RefreshCw />, onSelect: () => reconnect(s.c!), disabled: s.c.name !== 'github' && !s.c.name.startsWith('mcp.') },
                  { id: 'perm', label: 'Permissions', icon: <Eye />, onSelect: () => setSel(s.c!.name) },
                  { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: () => (location.hash = s.c!.name === 'github' ? '#/settings/accounts' : '#/settings/mcp'), disabled: s.c.name !== 'github' && !s.c.name.startsWith('mcp.') },
                ]}
              />
            </div>
          ) : (
            <div key="add" className="cm-node" style={{ left: rx + s.x - W / 2, top: ry + s.y - H / 2, width: W }}>
              <ActionNode compact className="cm-off cm-add" label="Add connector" mark={<Plus aria-hidden="true" />} title={<button type="button" className="rf-open" onClick={p.onAdd}>Add connector</button>} line="An MCP server" tone="idle" toneLabel="Not added" actions={[]} />
            </div>
          ),
        )}
      </div>
      <Panel c={chosen} />
    </div>
  );
}
const cmEdge = (c?: ConnectorView) => (c && c.status !== 'off' ? (c.status === 'needs' ? 'cm-edge needs' : 'cm-edge') : 'cm-edge off');

/** One connector's permissions and its recent calls and approvals. */
function Panel({ c }: { c?: ConnectorView }) {
  return (
    <section className="cm-panel" aria-label="Connector details" style={{ marginTop: PANEL_GAP }}>
      {c ? (
        <>
          <h3>
            {c.name} <StatusChip tone={STATUS[c.status].chip} label={STATUS[c.status].label} />
          </h3>
          {c.note ? <p className="sl-note">{c.note}</p> : null}
          <h4>Permissions</h4>
          <ul>
            {c.permissions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <h4>Recent calls and approvals</h4>
          {c.recent.length ? (
            <ul>
              {c.recent.map((r, i) => (
                <li key={i}>
                  <span className="mono">{r.what}</span> <span className="sl-age">{r.kind}{r.state ? ` · ${r.state}` : ''} · {ago(r.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sl-meta">None yet.</p>
          )}
        </>
      ) : (
        <p className="sl-meta">Select a connector to see its permissions and recent calls.</p>
      )}
    </section>
  );
}

/** Settings → Connectors: a list always (it is the fallback below 900 px), and from 900 px an Open map button. */
export function Connectors(p: { poll: Poll<{ connectors: ConnectorView[] }> }) {
  const [open, setOpen] = useState(false);
  const narrow = useMediaQuery(PHONE);
  const { test } = useActions();
  const list = p.poll.data?.connectors;
  if (p.poll.error && !list) return <InlineError message={p.poll.error} onRetry={() => void p.poll.refresh()} />;
  if (!list) return <p className="sl-meta">Loading connectors…</p>;
  return (
    <div className="cn">
      <p>The tools agents reach from run_code. Green is connected, amber needs you, gray is off.</p>
      <ul className="acc-list" aria-label="Connectors">
        {list.map((c) => (
          <li key={c.name} className="acc-row">
            <div className="acc-head">
              <b className="mono">{c.name}</b>
              <StatusChip tone={STATUS[c.status].chip} label={STATUS[c.status].label} />
            </div>
            <p className="sl-meta">{c.note ?? c.summary}</p>
            <Button size="sm" variant="secondary" onClick={() => void test(c.name)}>
              Test
            </Button>
          </li>
        ))}
      </ul>
      {narrow ? null : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Open map
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent title="Connectors map" description="Tether in the middle, each connector round it." className="max-w-[min(1180px,96vw)]">
            <div className="cm-scroll">
              <ConnectorMap connectors={list} onAdd={() => (setOpen(false), document.getElementById('set-mcp')?.scrollIntoView?.())} />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
