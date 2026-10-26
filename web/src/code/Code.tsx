import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api';
import { Button } from '../components/arc/button/button';
import { Dialog, DialogContent } from '../components/arc/dialog/dialog';
import { Drawer, DrawerContent } from '../components/arc/drawer/drawer';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Loading } from '../components/Loading';
import type { WorkspaceRow } from '../home/workspaces';
import { useUnloadWarning } from '../hooks';
import { cn } from '../ui/cn';
import { LeaveDialog } from '../ui/LeaveDialog';
import { useNotify } from '../ui/notify';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { Kbd } from '../ui/studio/Kbd';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { PHONE, useMediaQuery } from '../ui/studio/useMediaQuery';
import { codeApi, type CodeFile, type RunLock, type RunTouch, type TextHit } from './codeApi';
import { Editor } from './Editor';
import { FileTree } from './FileTree';
import { LANGS } from './langs';
import { RunsLens } from './RunsLens';
import { SearchResults } from './SearchResults';
import { ancestors, dirsFromPaths, visibleRows } from './treeModel';
import { useCodeTree } from './useCodeTree';
import './code.css';

export interface CodeProps {
  project: WorkspaceRow;
  /** The file in the route (`#/code/<path>:<line>`). */
  path?: string;
  line?: number;
  /** Puts the open file in the route (a history entry), or none. */
  onPath: (path: string | undefined, line?: number) => void;
  onOpenRun: (runId: string) => void;
  /** Told whenever some open file gains or loses unsaved edits (and false on unmount). */
  onDirtyChange?: (dirty: boolean) => void;
}

/** An open file. `edit` is the editor's text once it differs from what was read; `seq` counts reloads from disk (a new editor document). */
interface Tab {
  path: string;
  file?: CodeFile;
  error?: string;
  edit?: string;
  seq: number;
}

const LOCK_MS = 5000;
const SEARCH_MS = 250;
const nameOf = (path: string) => path.split('/').pop()!;
const isDirty = (t?: Tab) => !!t?.file && t.edit !== undefined && t.edit !== t.file.text;
const lineCount = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/**
 * The Code screen: the project's tree (or search results), the open files in CodeMirror (View by default, Edit to change,
 * ⌘S to save), and the runs that changed the open file. Tree and runs become drawers on a phone.
 */
export function Code(p: CodeProps) {
  const ws = p.project.id;
  const notify = useNotify();
  const phone = useMediaQuery(PHONE);
  const tree = useCodeTree(ws);
  const git = tree.info?.git;
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [cur, setCur] = useState<string>();
  const curRef = useRef(cur);
  curRef.current = cur;
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState<{ line: number; seq: number }>();
  const [lock, setLock] = useState<RunLock>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [closing, setClosing] = useState<string>();
  const [q, setQ] = useState('');
  const [searchSeq, setSearchSeq] = useState(0);
  const [search, setSearch] = useState<{ q: string; result?: { hits: TextHit[]; truncated: boolean }; error?: string }>();
  const [runs, setRuns] = useState<{ path: string; data?: RunTouch[]; error?: string }>();
  const [run, setRun] = useState<string>();
  const [drawer, setDrawer] = useState<'files' | 'runs'>();
  const searchRef = useRef<HTMLInputElement>(null);

  const tab = tabs.find((t) => t.path === cur);
  const file = tab?.file;
  const readOnly = !!file?.readOnly;
  const anyDirty = tabs.some(isDirty);
  const patchTab = (path: string, f: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.path === path ? f(t) : t)));

  const fetchFile = useCallback(
    async (path: string, reload = false) => {
      try {
        const f = await codeApi.file(ws, path);
        setLock(f.lock);
        setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, file: f, error: undefined, ...(reload ? { edit: undefined, seq: t.seq + 1 } : {}) } : t)));
      } catch (e) {
        setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, error: (e as Error).message } : t)));
      }
    },
    [ws],
  );
  /** Show a file (opening a tab for it), optionally at a line, and put it in the route unless the route asked for it. */
  const openAt = (path: string, line?: number, sync = true) => {
    if (!tabs.some((t) => t.path === path)) {
      setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, { path, seq: 0 }]));
      void fetchFile(path);
    }
    if (path !== curRef.current) {
      setEditing(false);
      setRun(undefined);
    }
    setCur(path);
    setFlash((f) => (line ? { line, seq: (f?.seq ?? 0) + 1 } : undefined));
    setDrawer(undefined);
    tree.reveal(path).catch(() => {});
    if (sync) p.onPath(path, line);
  };
  useEffect(() => {
    if (p.path && p.path !== curRef.current) openAt(p.path, p.line, false);
    // a new file in the route (a deep link, Back/Forward) is opened; openAt is rebuilt every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.path, p.line]);

  const closeNow = (path: string) => {
    const i = tabs.findIndex((t) => t.path === path);
    const rest = tabs.filter((t) => t.path !== path);
    setTabs(rest);
    if (path !== cur) return;
    const next = rest[Math.min(i, rest.length - 1)]?.path;
    setCur(next);
    setEditing(false);
    setRun(undefined);
    p.onPath(next);
  };
  const close = (path: string) => (isDirty(tabs.find((t) => t.path === path)) ? setClosing(path) : closeNow(path));

  const fetchLock = async () => {
    if (!curRef.current) return;
    try {
      setLock((await codeApi.file(ws, curRef.current)).lock);
    } catch {
      /* the next poll tries again */
    }
  };
  useEffect(() => {
    if (!lock) return;
    const t = setInterval(() => void fetchLock(), LOCK_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock]);

  const canSave = !!file && isDirty(tab) && !readOnly && !lock && !saving;
  const save = async (overwrite = false) => {
    if (!tab || !file || !isDirty(tab) || readOnly || lock || saving) return;
    const text = tab.edit!;
    setSaving(true);
    try {
      const r = await codeApi.save(ws, tab.path, text, overwrite ? undefined : file.mtimeMs);
      patchTab(tab.path, (t) => ({ ...t, file: { ...t.file!, text, mtimeMs: r.mtimeMs, size: r.size }, ...(t.edit === text ? { edit: undefined } : {}) }));
      setConflict(false);
      notify.ok(`Saved ${nameOf(tab.path)}`);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 409) setConflict(true);
      else if (status === 423) void fetchLock();
      else notify.fail(e);
    } finally {
      setSaving(false);
    }
  };
  const keys = useRef({ save });
  keys.current = { save };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's' && !e.shiftKey) {
        e.preventDefault();
        void keys.current.save();
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDirty = useRef(p.onDirtyChange);
  onDirty.current = p.onDirtyChange;
  useEffect(() => onDirty.current?.(anyDirty), [anyDirty]);
  useEffect(() => () => onDirty.current?.(false), []);
  useUnloadWarning(anyDirty);

  useEffect(() => {
    const text = q.trim();
    if (!text) return setSearch(undefined);
    let live = true;
    const t = setTimeout(() => {
      setSearch({ q: text });
      codeApi.searchText(ws, text).then(
        (result) => live && setSearch({ q: text, result }),
        (e: Error) => live && setSearch({ q: text, error: e.message }),
      );
    }, SEARCH_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, ws, searchSeq]);

  const loadRuns = useCallback(
    async (path: string) => {
      setRuns({ path });
      try {
        const data = await codeApi.runsFor(ws, path);
        setRuns((r) => (r?.path === path ? { path, data } : r));
      } catch (e) {
        setRuns((r) => (r?.path === path ? { path, error: (e as Error).message } : r));
      }
    },
    [ws],
  );
  useEffect(() => {
    if (cur && git) void loadRuns(cur);
    else setRuns(undefined);
  }, [cur, git, loadRuns]);
  const marks = runs?.data?.find((r) => r.runId === run)?.hunks;

  // "Changed by runs" is a whole tree built from the changed paths, open unless a folder is closed by hand; nothing loads
  const changedSet = useMemo(() => new Set(tree.changed), [tree.changed]);
  const changedDirs = useMemo(() => dirsFromPaths(tree.changed), [tree.changed]);
  const [closedChanged, setClosedChanged] = useState<ReadonlySet<string>>(() => new Set());
  const byChanged = filter === 'changed';
  const expanded = byChanged ? new Set(tree.changed.flatMap(ancestors).filter((d) => !closedChanged.has(d))) : tree.expanded;
  const rows = visibleRows(byChanged ? changedDirs : tree.dirs, expanded);
  const onExpand = (dir: string) => (byChanged ? setClosedChanged((s) => new Set([...s].filter((d) => d !== dir))) : void tree.expand(dir).catch(notify.fail));
  const onCollapse = (dir: string) => (byChanged ? setClosedChanged((s) => new Set(s).add(dir)) : tree.collapse(dir));

  const meta = [p.project.path, git && tree.info?.files !== undefined ? `${tree.info.files} files` : '', git ? `${tree.changed.length} changed by runs` : ''].filter(Boolean).join(' · ');
  const root = tree.dirs[''];

  const treePanel = (
    <div className="code-tree">
      {git ? (
        <div className="code-filter">
          <SegmentedControl label="Show" options={[{ value: 'all', label: 'All files' }, { value: 'changed', label: 'Changed by runs' }]} value={filter} onValueChange={(v) => setFilter(v as 'all' | 'changed')} />
        </div>
      ) : null}
      {git === false ? <p className="code-note">Not a git repository: git badges and changes by runs are hidden.</p> : null}
      <div className="code-pane">
        {search ? (
          <SearchResults q={search.q} result={search.result} error={search.error} onRetry={() => setSearchSeq((n) => n + 1)} onOpen={(path, line) => openAt(path, line)} />
        ) : tree.rootError ? (
          <InlineError message={tree.rootError} onRetry={() => void tree.reload()} />
        ) : (
          <Loading loading={!root} lines={8} label="Loading files">
            {root && !root.length ? (
              <p className="code-note">This folder is empty.</p>
            ) : filter === 'changed' && !tree.changed.length ? (
              <p className="code-note">No run changed a file here in the last 30 days.</p>
            ) : (
              <FileTree rows={rows} expanded={expanded} current={cur} changed={changedSet} onExpand={onExpand} onCollapse={onCollapse} onOpen={(path) => openAt(path)} />
            )}
          </Loading>
        )}
      </div>
    </div>
  );

  const lensPanel = <RunsLens idle={!cur} runs={runs?.data} error={runs?.error} onRetry={() => cur && void loadRuns(cur)} selected={run} onSelect={setRun} onOpenRun={p.onOpenRun} />;

  const body = !tab ? null : tab.error ? (
    <div className="code-pad">
      <InlineError message={tab.error} onRetry={() => void fetchFile(tab.path)} />
    </div>
  ) : !file ? (
    <Loading loading lines={12} label="Loading the file" className="code-pad" />
  ) : file.tooLarge ? (
    <EmptyState title="Too large to open here" description={`${nameOf(tab.path)} is ${mb(file.size)}; the Code screen opens text files up to 2 MB.`} />
  ) : file.binary ? (
    <EmptyState title="Not a text file" description={`${nameOf(tab.path)} holds binary data, so it is not shown.`} />
  ) : (
    <Editor docKey={`${tab.path}#${tab.seq}`} text={file.text} lang={file.lang} readOnly={!editing || readOnly} label={`Code of ${tab.path}`} onChange={(text) => patchTab(tab.path, (t) => ({ ...t, edit: text }))} marks={marks} flash={flash} />
  );

  const editorPanel = (
    <section className="code-main" aria-label="Editor">
      {tabs.length ? (
        <>
          <div className="code-tabs">
            <div className="code-tablist" role="tablist" aria-label="Open files">
              {tabs.map((t) => (
                <div key={t.path} className={cn('code-tab', { on: t.path === cur })}>
                  <button type="button" role="tab" aria-selected={t.path === cur} title={t.path} onClick={() => openAt(t.path)}>
                    {nameOf(t.path)}
                    {isDirty(t) ? (
                      <span className="code-dirty">
                        <span className="sl-sr">unsaved</span>
                      </span>
                    ) : null}
                  </button>
                  <button type="button" className="code-tab-close" aria-label={`Close ${nameOf(t.path)}`} onClick={() => close(t.path)}>
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <div className="code-tab-actions">
              <Button size="sm" variant="secondary" aria-pressed={editing && !readOnly} disabled={!file || readOnly || !!file.tooLarge || !!file.binary} onClick={() => setEditing(!editing)}>
                {readOnly ? 'Read-only' : editing ? 'Editing' : 'Edit'}
              </Button>
              <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
                Save <Kbd mod>S</Kbd>
              </Button>
            </div>
          </div>
          {lock ? (
            <div className="code-lock" role="status">
              <span className="sl-dot pulse code-lock-dot" aria-hidden="true" />
              <span>
                {lock.bot} is editing files in this folder in run <b>{lock.runId}</b>. Saving is paused until the step finishes.
              </span>
              <Button size="sm" variant="secondary" onClick={() => p.onOpenRun(lock.runId)}>
                Open run
              </Button>
            </div>
          ) : null}
          {file?.secret ? <p className="code-banner">Secrets file: read-only here, skipped by search and never sent to agents.</p> : null}
          {tab && file ? (
            <div className="code-filebar">
              <span>{tab.path}</span>
              <span>{LANGS[file.lang].label}</span>
              {!file.tooLarge && !file.binary ? <span>{lineCount(tab.edit ?? file.text)} lines</span> : null}
              <span className="code-filebar-note">{isDirty(tab) ? 'unsaved changes' : readOnly && !file.secret ? 'read-only' : ''}</span>
            </div>
          ) : null}
          <div className="code-editor-wrap">{body}</div>
        </>
      ) : (
        <EmptyState title="Pick a file" description="Open a file from the tree, or search the code with ⌘⇧F." />
      )}
    </section>
  );

  return (
    <div className="code">
      <ScreenHeader
        meta={meta}
        title="Code"
        actions={
          <>
            {phone ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDrawer('files')}>
                  Files
                </Button>
                {git ? (
                  <Button size="sm" variant="secondary" onClick={() => setDrawer('runs')}>
                    Runs
                  </Button>
                ) : null}
              </>
            ) : null}
            <label className="code-search">
              <Search size={13} aria-hidden="true" />
              <input ref={searchRef} aria-label="Search code" placeholder="Search code" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
              <Kbd mod>⇧F</Kbd>
            </label>
          </>
        }
      />
      <div className={cn('code-grid', { 'no-lens': !git, phone })}>
        {phone ? null : treePanel}
        {editorPanel}
        {!phone && git ? lensPanel : null}
      </div>
      {phone ? (
        <Drawer open={drawer === 'files'} onOpenChange={(o) => setDrawer(o ? 'files' : undefined)}>
          <DrawerContent side="left" title="Files" className="code-drawer">
            {treePanel}
          </DrawerContent>
        </Drawer>
      ) : null}
      {phone && git ? (
        <Drawer open={drawer === 'runs'} onOpenChange={(o) => setDrawer(o ? 'runs' : undefined)}>
          <DrawerContent side="right" title="Changed by runs" className="code-drawer">
            {lensPanel}
          </DrawerContent>
        </Drawer>
      ) : null}
      <Dialog open={conflict} onOpenChange={(o) => !o && setConflict(false)}>
        {conflict && tab ? (
          <DialogContent className="api-dialog" title={`${nameOf(tab.path)} changed on disk`} description="Something else saved this file after you opened it. Reload it (your edits are dropped) or overwrite it with yours.">
            <div className="row end">
              <Button variant="secondary" onClick={() => setConflict(false)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => (setConflict(false), void fetchFile(tab.path, true))}>
                Reload
              </Button>
              <Button variant="danger" onClick={() => void save(true)}>
                Overwrite
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
      <LeaveDialog text={closing ? `${nameOf(closing)} has edits that are not saved.` : undefined} onKeep={() => setClosing(undefined)} onDiscard={() => (closing && closeNow(closing), setClosing(undefined))} />
    </div>
  );
}
