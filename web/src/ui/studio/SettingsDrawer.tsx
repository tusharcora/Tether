import { useRef } from 'react';
import { CopyButton } from '../../components/arc/copy-button/copy-button';
import { Drawer, DrawerContent } from '../../components/arc/drawer/drawer';
import SegmentedControl from '../../components/arc/segmented-control/segmented-control';
import { THEME_LABEL, type ThemeChoice } from '../../theme';
import { CONNECTION_LABEL, type Connection } from './connection';
import { StatusChip, type Tone } from './StatusChip';
import './shell.css';

const TONE: Record<Connection, Tone> = { connected: 'done', reconnecting: 'needs', offline: 'failed' };
const CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];

/** Settings, opened over the current screen (which stays mounted): theme, vault, why loopback, connection. */
export function SettingsDrawer(p: { open: boolean; onClose: () => void; choice: ThemeChoice; onChoice: (c: ThemeChoice) => void; vault?: string; connection: Connection }) {
  // Radix only hands focus back to a DialogTrigger; Settings opens from the rail, the bottom bar, a key or a link, so the drawer remembers its opener.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Drawer open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DrawerContent
        side="right"
        title="Settings"
        description="This dashboard and the aorch server on this machine."
        className="sl-settings"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          const el = opener.current;
          opener.current = null;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <section className="sl-settings-group" aria-labelledby="set-theme">
          <h3 id="set-theme">Theme</h3>
          <SegmentedControl label="Theme" options={CHOICES.map((c) => ({ value: c, label: THEME_LABEL[c] }))} value={p.choice} onValueChange={(v) => p.onChoice(v as ThemeChoice)} />
        </section>
        <section className="sl-settings-group" aria-labelledby="set-vault">
          <h3 id="set-vault">Vault</h3>
          {p.vault ? (
            <div className="sl-settings-path">
              <code>{p.vault}</code>
              <CopyButton value={p.vault} label="Copy path" />
            </div>
          ) : (
            <p className="sl-meta">Not known until the server answers.</p>
          )}
        </section>
        <section className="sl-settings-group" aria-labelledby="set-loopback">
          <h3 id="set-loopback">Loopback only</h3>
          <p>The API starts agents and writes files, so it only listens on this machine.</p>
        </section>
        <section className="sl-settings-group" aria-labelledby="set-conn">
          <h3 id="set-conn">Connection</h3>
          <StatusChip tone={TONE[p.connection]} label={CONNECTION_LABEL[p.connection]} pulse={p.connection === 'reconnecting'} />
        </section>
      </DrawerContent>
    </Drawer>
  );
}
