import { useState, type FormEvent } from 'react';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import './projects.css';

/** Open folder… in a browser, which cannot pick a folder's path: type it. The server registers it (nothing is written into it). */
export function PathForm(p: { onOpen: (path: string) => Promise<unknown>; autoFocus?: boolean }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = path.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await p.onOpen(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="sl-path-form" onSubmit={(e) => void submit(e)}>
      <Input label="Folder path" placeholder="/Users/you/code/project" value={path} spellCheck={false} autoComplete="off" autoFocus={p.autoFocus} error={error} onChange={(e) => setPath(e.target.value)} />
      <Button type="submit" variant="primary" disabled={!path.trim()} loading={busy}>
        Open folder
      </Button>
    </form>
  );
}
