import './api.css';
import { useState } from 'react';
import { Button } from '../components/beui/kit/Button';
import { UploadDropzone } from '../components/bencho/UploadDropzone';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { Input } from '../components/beui/kit/fields';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Textarea } from '../components/kept/textarea/textarea';
import { useNotify } from '../ui/notify';
import { httpApi, type ImportBody, type ImportPreview } from './client';

/** The server's short skip reasons, said in full. Anything else is shown as sent. */
const REASONS: Record<string, string> = { exists: 'already exists, not overwritten' };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Paste or pick a cURL command, an OpenAPI document or a Postman collection; preview; then write. */
/** Per file: a large Postman collection or OpenAPI document still fits. */
const IMPORT_MAX_BYTES = 5_000_000;

export function ImportDialog(p: { ws?: string; open: boolean; onOpenChange: (o: boolean) => void; onImported: (ids: string[]) => void }) {
  const notify = useNotify();
  const [kind, setKind] = useState<ImportBody['kind']>('curl');
  const [text, setText] = useState('');
  const [into, setInto] = useState('');
  const [pv, setPv] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const body = (): ImportBody => ({ kind, text, ...(into.trim() ? { into: into.trim() } : {}) });
  const preview = async () => {
    setBusy(true);
    try {
      setPv(await httpApi.importPreview(p.ws, body()));
    } catch (e) {
      setPv({ create: [], collections: [], skip: [], warnings: [], error: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await httpApi.importApply(p.ws, body());
      notify.ok(`Imported ${r.created.length} request${r.created.length === 1 ? '' : 's'}`);
      p.onImported(r.created);
      setPv(undefined);
      setText('');
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setText(await f.text());
      setPv(undefined);
    } catch (e) {
      notify.fail(e);
    }
  };
  const n = pv?.create.length ?? 0;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {p.open ? (
        <DialogContent className="api-dialog" title="Import requests" description="Nothing is written until you confirm. Credentials are never written into files.">
          <div className="dialog-body">
            <SegmentedControl
              label="Format"
              options={[
                { value: 'curl', label: 'cURL' },
                { value: 'openapi', label: 'OpenAPI' },
                { value: 'postman', label: 'Postman' },
              ]}
              value={kind}
              onValueChange={(v) => (setKind(v as ImportBody['kind']), setPv(undefined))}
            />
            <Textarea
              label="Paste a cURL command, an OpenAPI document (JSON or YAML) or a Postman v2.1 collection"
              rows={8}
              className="mono"
              value={text}
              spellCheck={false}
              onChange={(e) => (setText(e.target.value), setPv(undefined))}
            />
            <UploadDropzone maxFiles={1} maxBytes={IMPORT_MAX_BYTES} accept=".json,.yaml,.yml,.txt,.sh" label="Or drop a Postman, OpenAPI or cURL file here" onFiles={(files) => void pickFile(files[0])} />
            <Input label="Into collection (optional)" placeholder="shop/orders" value={into} spellCheck={false} onChange={(e) => (setInto(e.target.value), setPv(undefined))} />
            {pv?.error ? (
              <p className="resp-error" role="alert">
                {pv.error}
              </p>
            ) : null}
            {pv && !pv.error ? (
              <div className="import-preview">
                <h4>Will create</h4>
                {n ? (
                  <ul>
                    {pv.create.map((c) => (
                      <li key={c.id}>
                        <span className="mono">{c.id}</span> <span className="hint mono">{`${c.file.method} ${c.file.url}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">Nothing to create.</p>
                )}
                {pv.skip.length ? (
                  <>
                    <h4>Skipped</h4>
                    <ul>
                      {pv.skip.map((s, i) => (
                        <li key={i}>
                          <span className="mono">{s.name}</span> <span className="hint">{REASONS[s.reason] ?? s.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {pv.warnings.length ? (
                  <>
                    <h4>To do after importing</h4>
                    <ul>
                      {pv.warnings.map((w, i) => (
                        <li key={i} className="hint warn">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="row end">
              <Button variant="secondary" onClick={preview} loading={busy && !pv} disabled={!text.trim() || busy}>
                Preview
              </Button>
              {pv && !pv.error && n ? (
                <Button variant="primary" onClick={apply} loading={busy}>
                  {`Import ${n} request${n === 1 ? '' : 's'}`}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
