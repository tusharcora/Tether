const MAX_LINES = 3000;

const cls = (l: string) =>
  l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'dh' : l.startsWith('@@') ? 'dk' : l.startsWith('+') ? 'da' : l.startsWith('-') ? 'dd' : '';

/** A unified diff, line-classed for colour; the viewer stops after 3000 lines. */
export function Diff(props: { text: string }) {
  const all = props.text.split('\n');
  return (
    <pre className="diff">
      {all.slice(0, MAX_LINES).map((l, i) => (
        <span key={i} className={cls(l)}>
          {l + '\n'}
        </span>
      ))}
      {all.length > MAX_LINES ? <span className="dk">… diff truncated in the viewer; use git to see all of it …</span> : null}
    </pre>
  );
}
