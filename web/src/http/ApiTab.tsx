import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateIntent } from '../ui/useCreateIntent';
import type { Bundle, Skipped } from '../../../src/wsexport';
import { api } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { EmptyState } from '../components/kept/empty-state/empty-state';
import { Select } from '../components/beui/kit/fields';
import { Textarea } from '../components/kept/textarea/textarea';
import { usePoll, useUnloadWarning } from '../hooks';
import { useNotify } from '../ui/notify';
import { httpApi, newRequest, type HistoryRow, type HttpRequestFile, type HttpTree, type SendOutput, type VarInfo } from './client';
import { EnvDialog } from './EnvDialog';
import { ImportDialog } from './ImportDialog';
import { RequestEditor } from './RequestEditor';
import { ResponseView } from './ResponseView';
import { SecretsDialog } from './SecretsDialog';
import { SendToAgent } from './SendToAgent';
import { Tree } from './Tree';
import { WorkspaceDialog } from './WorkspaceDialog';
import { storedWorkspace as readWs, storeWorkspace } from '../home/workspaces';
import './api.css';

/** A stored (redacted) exchange, shaped like a send's output so the response view and the agent panel can show it. */
const fromHistory = (h: HistoryRow): SendOutput => ({ historyId: h.id, request: h.data.request, result: h.data.response, checks: h.data.checks ?? [] });
const countRequests = (t?: HttpTree) => {
  let n = 0;
  const walk = (c: HttpTree['root']) => ((n += c.requests.length), c.collections.forEach(walk));
  if (t) walk(t.root);
  return n;
};

type DialogName = null | 'import' | 'secrets' | 'env' | 'workspace';

export interface ApiTabProps {
  onStarted: (runId: string) => void;
  onUseAsGate: (g: { run: string; env?: string }) => void;
  /** Told whenever the open request gains or loses unsaved edits (and false on unmount), so the shell can ask before leaving the tab. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The current project (the sidebar's). The shell has already asked about unsaved edits before it changes this. */
  workspace?: string;
  /** Told when the workspace is changed here, so the sidebar follows. */
  onWorkspace?: (id: string) => void;
  /** A saved request to open (a pinned request, `#/api/<id>`). */
  request?: string;
  /** Told which saved request is open (for pinning), or undefined. */
  onOpenRequest?: (r: { id: string; label: string } | undefined) => void;
  /** The Create menu asked for a new request (a counter). */
  create?: number;
}

export function ApiTab(props: ApiTabProps) {
  const notify = useNotify();
  const [ws, setWsState] = useState<string | undefined>(() => props.workspace ?? readWs());
  const workspaces = usePoll<{ id: string; name: string; isDefault: boolean }[]>('/api/workspaces', 30_000);
  const [tree, setTree] = useState<HttpTree>();
  const [treeError, setTreeError] = useState<string>();
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string>();
  const [file, setFile] = useState<HttpRequestFile>();
  const [saved, setSaved] = useState('');
  const [vars, setVars] = useState<Record<string, VarInfo | null>>({});
  const [invalid, setInvalid] = useState<{ id: string; error: string; raw?: string }>();
  const [output, setOutput] = useState<SendOutput>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string>();
  /** The history entry in the response view, when it was opened from the latency strip rather than just sent. */
  const [shownHistory, setShownHistory] = useState<number>();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [envName, setEnvName] = useState<string>();
  const [pending, setPending] = useState<null | (() => void)>(null);
  const dirty = !!file && JSON.stringify(file) !== saved;

  // Async results apply only to the view they started for. `view` moves on whenever the open request or the workspace
  // changes; a send, open, save or env reload that finishes after that is dropped. Tree and history loads keep their own count.
  const view = useRef(0);
  const treeSeq = useRef(0);
  const histSeq = useRef(0);
  const envSeq = useRef(0);
  const sendSeq = useRef(0);
  /** The workspace on screen now: a history load for any other one is dropped. */
  const wsNow = useRef(ws);
  wsNow.current = ws;

  const onDirty = useRef(props.onDirtyChange);
  onDirty.current = props.onDirtyChange;
  useEffect(() => onDirty.current?.(dirty), [dirty]);
  useEffect(() => () => onDirty.current?.(false), []);
  useUnloadWarning(dirty);

  const loadHistory = useCallback(() => {
    if (ws !== wsNow.current) return Promise.resolve(); // a closure from an earlier workspace: never cancel the current load
    const t = ++histSeq.current;
    const live = () => t === histSeq.current && ws === wsNow.current;
    return httpApi.history(ws, undefined, 20).then(
      (h) => live() && (setHistory(h), setHistoryError(undefined)),
      (e: Error) => live() && setHistoryError(e.message),
    );
  }, [ws]);
  const refresh = useCallback(async () => {
    const t = ++treeSeq.current;
    try {
      const next = await httpApi.tree(ws);
      if (t !== treeSeq.current) return;
      setTree(next);
      setTreeError(undefined);
    } catch (e) {
      if (t !== treeSeq.current) return;
      setTree(undefined);
      setTreeError((e as Error).message);
    }
    void loadHistory();
  }, [ws, loadHistory]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (props.workspace && props.workspace !== wsNow.current) switchWs(props.workspace);
    // switchWs is rebuilt every render; only a new workspace from the shell matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspace]);

  /** Run `fn` now, or after the person agrees to drop their unsaved edits. */
  const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
  /** A new view: whatever is still in flight for the old one is dropped when it lands. */
  const reset = () => {
    view.current++;
    setSending(false);
    setOutput(undefined);
    setShownHistory(undefined);
    setSendError(undefined);
    setInvalid(undefined);
  };
  /** Show another workspace, dropping the open request (callers have asked about unsaved edits). */
  const switchWs = (id: string) => {
    reset();
    setOpenId(undefined);
    setFile(undefined);
    setSaved('');
    setVars({});
    setWsState(id);
    storeWorkspace(id);
  };
  const setWs = (id: string) =>
    guard(() => {
      switchWs(id);
      props.onWorkspace?.(id);
    });
  const open = (id: string) =>
    guard(() => {
      const t = ++view.current;
      void (async () => {
        try {
          const r = await httpApi.request(ws, id);
          if (t !== view.current) return; // another request was opened (or New pressed) meanwhile
          reset();
          setOpenId(id);
          if (r.file) {
            setFile(r.file);
            setSaved(JSON.stringify(r.file));
            setVars(r.vars);
          } else {
            setFile(undefined);
            setInvalid({ id, error: r.error ?? 'invalid request file', raw: r.raw });
          }
        } catch (e) {
          if (t === view.current) notify.fail(e);
        }
      })();
    });
  // a pinned request (or #/api/<id>) opens once its workspace is the one on screen
  useEffect(() => {
    if (props.request && props.request !== openId && (!props.workspace || props.workspace === ws)) open(props.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request, ws]);
  const onOpenRequest = useRef(props.onOpenRequest);
  onOpenRequest.current = props.onOpenRequest;
  const openLabel = openId && file ? file.name || openId : undefined;
  useEffect(() => onOpenRequest.current?.(openId && openLabel ? { id: openId, label: openLabel } : undefined), [openId, openLabel]);
  useEffect(() => () => onOpenRequest.current?.(undefined), []);
  const fresh = () =>
    guard(() => {
      reset();
      setOpenId(undefined);
      setFile(newRequest());
      setSaved('');
      setVars({});
    });
  useCreateIntent(props.create, tree !== undefined, fresh);
  const save = async () => {
    if (!file || !dirty) return;
    const t = view.current;
    try {
      if (openId) await httpApi.save(ws, openId, file);
      else {
        const { id } = await httpApi.create(ws, '', file);
        if (t === view.current) setOpenId(id);
      }
      if (t === view.current) setSaved(JSON.stringify(file));
      notify.ok('Saved');
      void refresh();
    } catch (e) {
      notify.fail(e);
    }
  };
  const send = async () => {
    if (!file) return;
    const v = view.current;
    const n = ++sendSeq.current;
    const isLive = () => v === view.current && n === sendSeq.current;
    setSending(true);
    setSendError(undefined);
    setShownHistory(undefined);
    try {
      const o = await httpApi.send(ws, !dirty && openId ? { id: openId } : { draft: file, ...(openId ? { id: openId } : {}) });
      if (isLive()) setOutput(o);
    } catch (e) {
      if (!isLive()) return;
      setOutput(undefined);
      setSendError((e as Error).message);
    } finally {
      if (isLive()) setSending(false);
      // a send for a view (and workspace) no longer on screen must not reload, and so take over, the new one's history
      if (v === view.current) void loadHistory();
    }
  };
  const setEnv = async (name: string | null) => {
    const t = view.current;
    const e = ++envSeq.current;
    const live = () => t === view.current && e === envSeq.current;
    try {
      await httpApi.setEnv(ws, name);
      if (!live()) return;
      setTree((x) => (x ? { ...x, activeEnv: name } : x));
      // the saved request's vars resolve against the new environment (the draft's own vars still win in the editor)
      if (openId && file) {
        const r = await httpApi.request(ws, openId);
        if (live()) setVars(r.vars);
      }
    } catch (err) {
      if (e === envSeq.current) notify.fail(err);
    }
  };
  /** Download the workspace as <name>.aorch.json (never with secrets: the server leaves them out), and say what could not travel. */
  const exportWs = async () => {
    const id = ws ?? tree?.workspace;
    if (!id) return;
    try {
      const r = await api<{ fileName: string; bundle: Bundle; skipped: Skipped[] }>('GET', `/api/workspaces/${encodeURIComponent(id)}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.bundle, null, 2) + '\n'], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.fileName;
      a.click();
      // released later: a browser may start the download after click() returns
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify.ok(`Exported ${r.fileName}`, r.skipped.length ? `Left out ${r.skipped.map((k) => `${k.path} (${k.reason})`).join(', ')}` : undefined);
    } catch (e) {
      notify.fail(e);
    }
  };
  const showHistory = (h: HistoryRow) => {
    if (!h.data?.response) return notify.fail(new Error(`history entry ${h.id} has no stored exchange`));
    sendSeq.current++; // a send still on its way no longer replaces what is shown
    setSending(false);
    setOutput(fromHistory(h));
    setSendError(undefined);
    setShownHistory(h.id);
  };

  const wsBar = (
    <div className="api-ws">
      {workspaces.data?.length ? (
        <Select label="Workspace" options={workspaces.data.map((w) => ({ value: w.id, label: w.name }))} value={ws ?? tree?.workspace ?? workspaces.data.find((w) => w.isDefault)?.id ?? workspaces.data[0]!.id} onValueChange={setWs} />
      ) : null}
      <div className="row">
        <Button size="sm" variant="ghost" onClick={exportWs} disabled={!tree}>
          Export
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDialog('workspace')}>
          Import workspace
        </Button>
      </div>
    </div>
  );

  if (treeError === 'no workspace')
    return (
      <div className="api-tab api-empty">
        <EmptyState title="No workspace yet" description="Saved requests live next to the code, in the project's .aorch/http folder. Register the project folder first: run `tether workspace init` in it, then come back here." />
      </div>
    );

  const total = countRequests(tree);
  return (
    <div className="api-tab">
      <aside className="api-left" aria-label="Collections">
        {wsBar}
        <Tree tree={tree} selected={openId} filter={filter} onFilter={setFilter} onOpen={open} onNew={fresh} onImport={() => setDialog('import')} onSecrets={() => setDialog('secrets')} onEnv={setEnv} onEditEnv={(n) => (setEnvName(n), setDialog('env'))} history={history} historyError={historyError} shownHistory={shownHistory} onHistory={showHistory} />
        {treeError ? (
          <p className="resp-error tree-error" role="alert">
            {treeError}
          </p>
        ) : null}
      </aside>
      <main className="api-center">
        {invalid ? (
          <section className="req-editor">
            <p className="resp-error" role="alert">{`${invalid.id}: ${invalid.error}`}</p>
            <Textarea label="File contents (read-only)" readOnly rows={14} className="mono" value={invalid.raw ?? ''} />
          </section>
        ) : file ? (
          <RequestEditor key={openId ?? 'new'} file={file} vars={vars} dirty={dirty} sending={sending} onChange={setFile} onSend={send} onSave={save} />
        ) : tree && !total ? (
          <EmptyState
            title="No saved requests"
            description="Import a cURL command, an OpenAPI document or a Postman collection, or start a new request."
            action={
              <div className="row">
                <Button variant="primary" onClick={() => setDialog('import')}>
                  Import
                </Button>
                <Button variant="secondary" onClick={fresh}>
                  New request
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState title="Pick a request" description="Open a saved request on the left, or start a new one." />
        )}
        {file || output ? (
          <>
            {shownHistory !== undefined && output ? (
              <p className="hint from-history">{`From history · ${output.request.method} ${output.request.url}`}</p>
            ) : null}
            <ResponseView output={output} sending={sending} error={sendError} />
          </>
        ) : null}
      </main>
      <SendToAgent ws={ws} output={output} requestId={openId && !dirty ? openId : undefined} env={tree?.activeEnv} onStarted={props.onStarted} onUseAsGate={props.onUseAsGate} />

      <ImportDialog ws={ws} open={dialog === 'import'} onOpenChange={(o) => setDialog(o ? 'import' : null)} onImported={() => (setDialog(null), void refresh())} />
      <SecretsDialog ws={ws} open={dialog === 'secrets'} onOpenChange={(o) => setDialog(o ? 'secrets' : null)} />
      <WorkspaceDialog open={dialog === 'workspace'} onOpenChange={(o) => setDialog(o ? 'workspace' : null)} onImported={(id) => (setDialog(null), workspaces.refresh(), setWs(id))} />
      <EnvDialog ws={ws} open={dialog === 'env'} name={envName} onOpenChange={(o) => setDialog(o ? 'env' : null)} onSaved={() => (setDialog(null), void refresh())} />
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        {pending ? (
          <DialogContent className="api-dialog" title="Discard unsaved changes?" description="This request has edits that are not saved.">
            <div className="row end">
              <Button variant="secondary" onClick={() => setPending(null)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const fn = pending;
                  setPending(null);
                  setSaved(JSON.stringify(file)); // the edits are dropped on purpose
                  fn();
                }}
              >
                Discard
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
