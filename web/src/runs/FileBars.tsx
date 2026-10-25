import { fileStats } from './fileStats';

/** One row per changed file: name, +/− counts and a bar split into added (green) and removed (red). */
export function FileBars(props: { diff: string }) {
  const stats = fileStats(props.diff);
  if (!stats.length) return null;
  const max = Math.max(...stats.map((s) => s.add + s.del), 1);
  return (
    <ul className="file-bars" aria-label="Changed files">
      {stats.map((s) => (
        <li key={s.file}>
          <span className="file-name">{s.file}</span>
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
