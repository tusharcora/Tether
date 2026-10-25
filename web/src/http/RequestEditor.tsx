import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/arc/button/button';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/arc/tabs/tabs';
import { Textarea } from '../components/arc/textarea/textarea';
import { ChecksEditor } from './ChecksEditor';
import { METHODS, VAR_IN_TEXT, type Body, type HttpRequestFile, type Method, type VarInfo, type VarSource } from './client';
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

function VarChip({ name, info }: { name: string; info: VarInfo | null | undefined }) {
  const id = useId();
  const state = !info ? 'missing' : info.source.from === 'secret' ? 'secret' : 'ok';
  const text = !info ? 'not defined' : info.source.from === 'secret' ? `secret · ${info.source.key}` : `${info.value ?? ''} · ${sourceLabel(info.source)}`;
  return (
    <span className="var-chip" data-state={state} tabIndex={0} aria-describedby={id} onClick={(e) => e.stopPropagation()}>
      <span className="var-name">{name}</span>
      <span role="tooltip" id={id} className="var-pop">
        {text}
      </span>
    </span>
  );
}

function UrlBar({ url, info, onChange }: { url: string; info: (name: string) => VarInfo | null | undefined; onChange: (u: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return <input className="url-input mono" role="textbox" aria-label="URL" autoFocus value={url} spellCheck={false} onChange={(e) => onChange(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />;
  return (
    <div className="url-view mono" role="textbox" aria-label="URL" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => (e.key === 'Enter' || e.key.length === 1) && !e.metaKey && !e.ctrlKey && setEditing(true)}>
      {urlTokens(url).map((t, i) => ('var' in t ? <VarChip key={i} name={t.var} info={info(t.var)} /> : <span key={i}>{t.text}</span>))}
    </div>
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

  const count = (n: number) => (n ? ` ${n}` : '');
  const varRows = Object.entries(file.vars).map(([key, value]) => ({ key, value, on: true }));
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
      <Tabs value={tab} onValueChange={setTab} className="req-tabs">
        <TabsList aria-label="Request parts">
          <TabsTrigger value="params">Params{count(file.query.length)}</TabsTrigger>
          <TabsTrigger value="headers">Headers{count(file.headers.length)}</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="checks">Checks{count(file.checks.length)}</TabsTrigger>
          <TabsTrigger value="vars">Vars{count(varRows.length)}</TabsTrigger>
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
          <KvTable noun="variable" toggles={false} rows={varRows} onChange={(rows) => set({ vars: Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])) })} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
