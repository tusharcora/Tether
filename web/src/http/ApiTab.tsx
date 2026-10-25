import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/arc/button/button';
import { Dialog, DialogContent } from '../components/arc/dialog/dialog';
import { EmptyState } from '../components/arc/empty-state/empty-state';
import { Select } from '../components/arc/select/select';
import { Textarea } from '../components/arc/textarea/textarea';
import { usePoll } from '../hooks';
import { useNotify } from '../ui/notify';
import { httpApi, newRequest, type HistoryRow, type HttpRequestFile, type HttpTree, type SendOutput, type VarInfo } from './client';
import { EnvDialog } from './EnvDialog';
import { ImportDialog } from './ImportDialog';
import { RequestEditor } from './RequestEditor';
import { ResponseView } from './ResponseView';
import { SecretsDialog } from './SecretsDialog';
import { SendToAgent } from './SendToAgent';
import { Tree } from './Tree';
import './api.css';

const WS_KEY = 'aorch.api.ws';
const readWs = () => {
  try {
    return localStorage.getItem(WS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
/** A stored (redacted) exchange, shaped like a send's output so the response view and the agent panel can show it. */
const fromHistory = (h: HistoryRow): SendOutput => ({ historyId: h.id, request: h.data.request, result: h.data.response, checks: h.data.checks ?? [] });
const countRequests = (t?: HttpTree) => {
  let n = 0;
  const walk = (c: HttpTree['root']) => ((n += c.requests.length), c.collections.forEach(walk));
  if (t) walk(t.root);
  return n;
};

type DialogName = null | 'import' | 'secrets' | 'env';

export function ApiTab(props: { onStarted: (runId: string) => void; onUseAsGate: (g: { run: string; env?: string }) => void }) {
  const notify = useNotify();
  const [ws, setWsState] = useState<string | undefined>(readWs);
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

  const loadHistory = useCallback(
    () =>
      httpApi.history(ws, undefined, 20).then(
        (h) => (setHistory(h), setHistoryError(undefined)),
        (e: Error) => setHistoryError(e.message),
      ),
    [ws],
  );
  const refresh = useCallback(async () => {
    try {
      setTree(await httpApi.tree(ws));
      setTreeError(undefined);
    } catch (e) {
      setTree(undefined);
      setTreeError((e as Error).message);
    }
    void loadHistory();
  }, [ws, loadHistory]);
  useEffect(() => void refresh(), [refresh]);

  /** Run `fn` now, or after the person agrees to drop their unsaved edits. */
  const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
  const reset = () => {
    setOutput(undefined);
    setShownHistory(undefined);
    setSendError(undefined);
    setInvalid(undefined);
  };
  const setWs = (id: string) =>
    guard(() => {
      reset();
      setOpenId(undefined);
      setFile(undefined);
      setSaved('');
      setVars({});
      setWsState(id);
      try {
        localStorage.setItem(WS_KEY, id);
      } catch {
        /* storage unavailable */
      }
    });
  const open = (id: string) =>
    guard(() => {
      void (async () => {
        try {
          const r = await httpApi.request(ws, id);
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
          notify.fail(e);
        }
      })();
    });
  const fresh = () =>
    guard(() => {
      reset();
      setOpenId(undefined);
      setFile(newRequest());
      setSaved('');
      setVars({});
    });
  const save = async () => {
    if (!file || !dirty) return;
    try {
      if (openId) await httpApi.save(ws, openId, file);
      else setOpenId((await httpApi.create(ws, '', file)).id);
      setSaved(JSON.stringify(file));
      notify.ok('Saved');
      void refresh();
    } catch (e) {
      notify.fail(e);
    }
  };
  const send = async () => {
    if (!file) return;
    setSending(true);
    setSendError(undefined);
    setShownHistory(undefined);
    try {
      setOutput(await httpApi.send(ws, !dirty && openId ? { id: openId } : { draft: file, ...(openId ? { id: openId } : {}) }));
    } catch (e) {
      setOutput(undefined);
      setSendError((e as Error).message);
    } finally {
      setSending(false);
      void loadHistory();
    }
  };
  const setEnv = async (name: string | null) => {
    try {
      await httpApi.setEnv(ws, name);
      setTree((t) => (t ? { ...t, activeEnv: name } : t));
      // the saved request's vars resolve against the new environment (the draft's own vars still win in the editor)
      if (openId && file) setVars((await httpApi.request(ws, openId)).vars);
    } catch (e) {
      notify.fail(e);
    }
  };
  const showHistory = (h: HistoryRow) => {
    if (!h.data?.response) return notify.fail(new Error(`history entry ${h.id} has no stored exchange`));
    setOutput(fromHistory(h));
    setSendError(undefined);
    setShownHistory(h.id);
  };

  const wsBar = (
    <div className="api-ws">
      {workspaces.data?.length ? (
        <Select label="Workspace" options={workspaces.data.map((w) => ({ value: w.id, label: w.name }))} value={ws ?? tree?.workspace ?? workspaces.data.find((w) => w.isDefault)?.id ?? workspaces.data[0]!.id} onValueChange={setWs} />
      ) : null}
    </div>
  );

  if (treeError === 'no workspace')
    return (
      <div className="studio api-tab api-empty">
        <EmptyState title="No workspace yet" description="Saved requests live next to the code, in the project's .aorch/http folder. Register the project folder first: run `aorch workspace init` in it, then come back here." />
      </div>
    );

  const total = countRequests(tree);
  return (
    <div className="studio api-tab">
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
      <EnvDialog ws={ws} open={dialog === 'env'} name={envName} onOpenChange={(o) => setDialog(o ? 'env' : null)} onSaved={() => (setDialog(null), void refresh())} />
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        {pending ? (
          <DialogContent className="studio api-dialog" title="Discard unsaved changes?" description="This request has edits that are not saved.">
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
