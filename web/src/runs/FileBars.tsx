import { fileStats } from './fileStats';

/** One row per changed file: name, +/− counts and a bar split into added (green) and removed (red). With `onOpen` a name opens the file in Code. */
export function FileBars(props: { diff: string; onOpen?: (file: string) => void; openTitle?: string }) {
  const stats = fileStats(props.diff);
  if (!stats.length) return null;
  const max = Math.max(...stats.map((s) => s.add + s.del), 1);
  return (
    <ul className="file-bars" aria-label="Changed files">
      {stats.map((s) => (
        <li key={s.file}>
          {props.onOpen ? (
            <button type="button" className="file-name file-open" title={props.openTitle ?? 'Open in Code'} onClick={() => props.onOpen!(s.file)}>
              {s.file}
            </button>
          ) : (
            <span className="file-name">{s.file}</span>
          )}
          <span className="file-count">{`+${s.add} −${s.del}`}</span>
          <span className="file-bar" aria-hidden="true">
            <span className="file-add" style={{ width: `${(s.add / max) * 100}%` }} />
            <span className="file-del" style={{ width: `${(s.del / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
