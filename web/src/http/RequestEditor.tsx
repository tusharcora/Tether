import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../components/beui/kit/Button';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/beui/kit/controls';
import { Textarea } from '../components/kept/textarea/textarea';
import { ChecksEditor } from './ChecksEditor';
import { METHODS, VAR_IN_TEXT, type Body, type HttpRequestFile, type KV, type Method, type VarInfo, type VarSource } from './client';
import { KvTable } from './KvTable';
import './api.css';

export function urlTokens(url: string): ({ text: string } | { var: string })[] {
  const out: ({ text: string } | { var: string })[] = [];
  let at = 0;
  for (const m of url.matchAll(VAR_IN_TEXT)) {
    if (m.index! > at) out.push({ text: url.slice(at, m.index) });
    out.push({ var: m[1]! });
    at = m.index! + m[0].length;
  }
  if (at < url.length) out.push({ text: url.slice(at) });
  return out;
}

const sourceLabel = (s: VarSource) => (s.from === 'request' ? 'this request' : s.from === 'collection' ? `collection ${s.path || '(root)'}` : s.from === 'env' ? `env ${s.env}` : 'secret');

const varText = (info: VarInfo | null | undefined) => (!info ? 'not defined' : info.source.from === 'secret' ? `secret · ${info.source.key}` : `${info.value ?? ''} · ${sourceLabel(info.source)}`);
const varState = (info: VarInfo | null | undefined) => (!info ? 'missing' : info.source.from === 'secret' ? 'secret' : 'ok');

/** The URL as text and {{var}} chips. The chips' popovers live outside the scrolling URL box (it would clip them), as
 *  siblings under .urlbar placed below their chip; one opens on hover or keyboard focus. */
function UrlBar({ url, info, onChange }: { url: string; info: (name: string) => VarInfo | null | undefined; onChange: (u: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<{ i: number; left: number } | null>(null);
  const base = useId();
  const pops = useRef<HTMLDivElement>(null);
  if (editing)
    return <input className="url-input mono" role="textbox" aria-label="URL" autoFocus value={url} spellCheck={false} onChange={(e) => onChange(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />;
  const tokens = urlTokens(url);
  const show = (i: number, el: HTMLElement) => setOpen({ i, left: el.getBoundingClientRect().left - (pops.current?.getBoundingClientRect().left ?? 0) });
  const hide = (i: number) => setOpen((o) => (o?.i === i ? null : o));
  return (
    <>
      <div className="url-view mono" role="textbox" aria-label="URL" tabIndex={0} onClick={() => setEditing(true)} onScroll={() => setOpen(null)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key.length === 1) && !e.metaKey && !e.ctrlKey && setEditing(true)}>
        {tokens.map((t, i) =>
          'var' in t ? (
            <span key={i} className="var-chip" data-state={varState(info(t.var))} tabIndex={0} aria-describedby={`${base}-${i}`} onClick={(e) => e.stopPropagation()} onMouseEnter={(e) => show(i, e.currentTarget)} onMouseLeave={() => hide(i)} onFocus={(e) => show(i, e.currentTarget)} onBlur={() => hide(i)}>
              <span className="var-name">{t.var}</span>
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          ),
        )}
      </div>
      <div className="var-pops" ref={pops}>
        {tokens.map((t, i) =>
          'var' in t ? (
            <span key={i} role="tooltip" id={`${base}-${i}`} className="var-pop" data-open={open?.i === i ? '' : undefined} style={open?.i === i ? { left: open.left } : undefined}>
              {varText(info(t.var))}
            </span>
          ) : null,
        )}
      </div>
    </>
  );
}

function JsonBody({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <Textarea
        label="JSON body"
        rows={10}
        className="mono"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad ? <p className="hint warn">not valid JSON yet</p> : null}
    </>
  );
}

function BodyEditor({ body, onChange }: { body: Body; onChange: (b: Body) => void }) {
  const kinds = [
    { value: 'none', label: 'None' },
    { value: 'json', label: 'JSON' },
    { value: 'text', label: 'Text' },
    { value: 'form', label: 'Form' },
  ];
  const pick = (k: string) => onChange(k === 'json' ? { kind: 'json', value: {} } : k === 'text' ? { kind: 'text', value: '' } : k === 'form' ? { kind: 'form', fields: [] } : { kind: 'none' });
  return (
    <div className="body-edit">
      <SegmentedControl label="Body type" options={kinds} value={body.kind} onValueChange={(k) => k !== body.kind && pick(k)} />
      {body.kind === 'json' ? <JsonBody value={body.value} onChange={(value) => onChange({ kind: 'json', value })} /> : null}
      {body.kind === 'text' ? (
        <>
          <Textarea label="Text body" rows={8} className="mono" value={body.value} onChange={(e) => onChange({ ...body, value: e.target.value })} />
          <input className="kv-input mono" aria-label="Content type" placeholder="text/plain; charset=utf-8" value={body.contentType ?? ''} onChange={(e) => onChange({ kind: 'text', value: body.value, ...(e.target.value ? { contentType: e.target.value } : {}) })} />
        </>
      ) : null}
      {body.kind === 'form' ? <KvTable noun="field" rows={body.fields} onChange={(fields) => onChange({ kind: 'form', fields })} /> : null}
      {body.kind === 'none' ? <p className="hint">No body is sent.</p> : null}
    </div>
  );
}

const rowsOf = (vars: Record<string, string>): KV[] => Object.entries(vars).map(([key, value]) => ({ key, value, on: true }));
function duplicateNames(rows: KV[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    const k = r.key.trim();
    if (k && seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  return dupes;
}

/** A sliding underline under the active tab, on the Studio Live curve (Arc's own highlight glides on a spring).
 * It slides only once the person switches tabs: the editor remounts per request, and the first placement is not a move. */
function useTabLine(tab: string) {
  const root = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<{ left: number; top: number; width: number } | null>(null);
  const [slides, setSlides] = useState(false);
  const firstTab = useRef(tab);
  useLayoutEffect(() => {
    if (tab !== firstTab.current) setSlides(true);
    const place = () => {
      const r = root.current;
      const t = r?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!r || !t) return;
      const a = r.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      setLine({ left: b.left - a.left, top: b.bottom - a.top - 2, width: b.width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [tab]);
  return { root, line, slides };
}

export interface RequestEditorProps {
  file: HttpRequestFile;
  vars: Record<string, VarInfo | null>;
  dirty: boolean;
  sending: boolean;
  onChange: (f: HttpRequestFile) => void;
  onSend: () => void;
  onSave: () => void;
}

export function RequestEditor(p: RequestEditorProps) {
  const { file } = p;
  const [tab, setTab] = useState('params');
  const tabLine = useTabLine(tab);
  const set = (patch: Partial<HttpRequestFile>) => p.onChange({ ...file, ...patch });
  const info = (name: string): VarInfo | null | undefined => (Object.hasOwn(file.vars, name) ? { source: { from: 'request' }, value: file.vars[name] } : p.vars[name]);

  // ⌘↵ / Ctrl-Enter sends, ⌘S / Ctrl-S saves, wherever focus is while the editor is open
  const keys = useRef(p);
  keys.current = p;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!keys.current.sending) keys.current.onSend();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        keys.current.onSave();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // Vars are edited as rows held here (so they survive tab switches): a row with an empty or duplicate name stays on
  // screen with its value while the person fixes it. The file's vars record is written only from rows with no
  // duplicate names (empty names are left out); a new file.vars from outside resets the rows.
  const [varRows, setVarRows] = useState(() => rowsOf(file.vars));
  const [varsSeen, setVarsSeen] = useState(file.vars);
  if (file.vars !== varsSeen) {
    setVarsSeen(file.vars);
    setVarRows(rowsOf(file.vars));
  }
  const dupes = duplicateNames(varRows);
  const editVars = (rows: KV[]) => {
    setVarRows(rows);
    if (duplicateNames(rows).size) return;
    const vars = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
    setVarsSeen(vars);
    set({ vars });
  };

  const count = (n: number) => (n ? ` ${n}` : '');
  return (
    <section className="req-editor" aria-label="Request">
      <div className="req-head">
        <input className="req-name" aria-label="Request name" value={file.name} onChange={(e) => set({ name: e.target.value })} />
        {p.dirty ? (
          <span className="dirty" title="unsaved changes">
            ● unsaved
          </span>
        ) : null}
        <span className="spacer" />
        <Button variant="secondary" size="sm" onClick={p.onSave} disabled={!p.dirty}>
          Save <kbd>⌘S</kbd>
        </Button>
        <Button variant="primary" size="sm" onClick={p.onSend} loading={p.sending}>
          Send <kbd>⌘↵</kbd>
        </Button>
      </div>
      <div className="urlbar">
        <select className="method-select mono" aria-label="Method" data-method={file.method} value={file.method} onChange={(e) => set({ method: e.target.value as Method })}>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <UrlBar url={file.url} info={info} onChange={(url) => set({ url })} />
      </div>
      <div className="req-tabs-wrap" ref={tabLine.root}>
      <span className="tab-line" aria-hidden="true" data-slides={tabLine.slides ? '' : undefined} style={tabLine.line ? { transform: `translate(${tabLine.line.left}px, ${tabLine.line.top}px)`, width: tabLine.line.width } : { opacity: 0 }} />
      <Tabs value={tab} onValueChange={setTab} className="req-tabs">
        <TabsList aria-label="Request parts">
          <TabsTrigger value="params">Params{count(file.query.length)}</TabsTrigger>
          <TabsTrigger value="headers">Headers{count(file.headers.length)}</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="checks">Checks{count(file.checks.length)}</TabsTrigger>
          <TabsTrigger value="vars">Vars{count(Object.keys(file.vars).length)}</TabsTrigger>
        </TabsList>
        <TabsContent value="params">
          <KvTable noun="parameter" rows={file.query} onChange={(query) => set({ query })} />
        </TabsContent>
        <TabsContent value="headers">
          <KvTable noun="header" rows={file.headers} onChange={(headers) => set({ headers })} />
        </TabsContent>
        <TabsContent value="body">
          <BodyEditor body={file.body} onChange={(body) => set({ body })} />
        </TabsContent>
        <TabsContent value="checks">
          <ChecksEditor checks={file.checks} onChange={(checks) => set({ checks })} />
        </TabsContent>
        <TabsContent value="vars">
          <KvTable noun="variable" toggles={false} rows={varRows} onChange={editVars} invalid={(i) => dupes.has(varRows[i]!.key.trim())} />
          {dupes.size ? (
            <p role="alert" className="hint warn">
              Two variables share a name: {[...dupes].join(', ')}. Rename one; the request keeps its last valid variables until then.
            </p>
          ) : null}
        </TabsContent>
      </Tabs>
      </div>
    </section>
  );
}
