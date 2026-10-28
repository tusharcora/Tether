import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';

/** "How did <bot> do?" with thumbs; a thumb saves at once and opens an optional note (Evolve learns from both). */
export function Rating(p: { botName: string; current?: { rating: 'up' | 'down' }; onRate: (rating: 'up' | 'down', note?: string) => Promise<boolean> }) {
  const [picked, setPicked] = useState<'up' | 'down'>();
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const rating = picked ?? p.current?.rating;
  const rate = async (r: 'up' | 'down') => {
    setPicked(r);
    setSaved(await p.onRate(r));
  };
  const save = async () => {
    if (!picked || !(await p.onRate(picked, note.trim() || undefined))) return;
    setNote('');
    setSaved(true);
  };
  return (
    <div className="insp-rate" title="Evolve learns from this: a note says why">
      <span className="insp-rate-q">
        {`How did ${p.botName} do?`} {saved ? <span className="insp-saved">Saved</span> : null}
      </span>
      <button type="button" className="insp-thumb" aria-label="Good" aria-pressed={rating === 'up'} onClick={() => void rate('up')}>
        <ThumbsUp size={14} aria-hidden="true" />
      </button>
      <button type="button" className="insp-thumb" aria-label="Bad" aria-pressed={rating === 'down'} onClick={() => void rate('down')}>
        <ThumbsDown size={14} aria-hidden="true" />
      </button>
      {picked ? (
        <div className="insp-note">
          <Input label="Why (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="secondary" size="sm" disabled={!note.trim()} onClick={() => void save()}>
            Save note
          </Button>
        </div>
      ) : null}
    </div>
  );
}
