import './shell.css';

/** Up to two initials of a person's name or login. */
export const initialsOf = (name: string): string =>
  (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('') || '?'
  ).toUpperCase();

/**
 * The sidebar's last row: an initials avatar, the person's name, and the primary account's chip — "GitHub" with a green dot
 * when connected, "Connect" otherwise. It opens Settings → Accounts.
 */
export function AccountRow(p: { name: string; /** The connected provider's name (GitHub), if any. */ provider?: string; onOpen: () => void }) {
  return (
    <button type="button" className="sl-side-account" aria-label={`${p.name}: ${p.provider ? `${p.provider} connected` : 'no account connected'}. Open Accounts`} onClick={p.onOpen}>
      <span className="sl-side-avatar" aria-hidden="true">
        {initialsOf(p.name)}
      </span>
      <span className="sl-side-label">{p.name}</span>
      <span className="sl-side-chip">
        {p.provider ? <span className="sl-side-chip-dot" aria-hidden="true" /> : null}
        {p.provider ?? 'Connect'}
      </span>
    </button>
  );
}
