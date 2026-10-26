import { useRef } from 'react';
import { CopyButton } from '../../components/arc/copy-button/copy-button';
import { Drawer, DrawerContent } from '../../components/arc/drawer/drawer';
import SegmentedControl from '../../components/arc/segmented-control/segmented-control';
import { Switch } from '../../components/arc/switch/switch';
import type { Poll } from '../../hooks';
import { THEME_LABEL, type ThemeChoice } from '../../theme';
import { ToolsStrip, type Tools } from '../../welcome/ToolsStrip';
import { CONNECTION_LABEL, type Connection } from './connection';
import { Glyph } from './Glyph';
import { StatusChip, type Tone } from './StatusChip';
import './shell.css';

const TONE: Record<Connection, Tone> = { connecting: 'neutral', connected: 'done', reconnecting: 'needs', offline: 'failed' };
const CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];
/** Still in the page and not hidden (`checkVisibility` where the browser has it). */
const focusable = (el: HTMLElement) => el.isConnected && el.checkVisibility?.() !== false;

/** Settings, opened over the current screen (which stays mounted): theme, vault, why loopback, connection, about. */
export function SettingsDrawer(p: { open: boolean; onClose: () => void; choice: ThemeChoice; onChoice: (c: ThemeChoice) => void; vault?: string; home?: string; connection: Connection; /** The agent tools found on the server's PATH (shown when given). */ tools?: Poll<Tools>; /** Tether.app's notifications switch (shown when given). */ notifications?: { on: boolean; onChange: (on: boolean) => void }; returnFocus?: () => HTMLElement | null | undefined }) {
  // Radix only hands focus back to a DialogTrigger; Settings opens from the rail, the bottom bar, a key or a link, so the drawer remembers its opener.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Drawer open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DrawerContent
        side="right"
        title="Settings"
        description="This dashboard and the Tether server on this machine."
        className="sl-settings"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          const el = opener.current;
          opener.current = null;
          // A More menu item or the ⌘K field is gone by now: fall back to the control that stays (More, or the rail's Settings).
          const to = el && focusable(el) ? el : p.returnFocus?.();
          if (to && focusable(to)) {
            e.preventDefault();
            to.focus();
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
        {p.notifications ? (
          <section className="sl-settings-group" aria-labelledby="set-notify">
            <h3 id="set-notify">Notifications</h3>
            <Switch label="Tell me when a run needs me or finishes" checked={p.notifications.on} onCheckedChange={(c) => p.notifications!.onChange(c === true)} />
          </section>
        ) : null}
        {p.tools ? (
          <section className="sl-settings-group" aria-labelledby="set-tools">
            <h3 id="set-tools">Agent tools</h3>
            <ToolsStrip poll={p.tools} />
          </section>
        ) : null}
        <section className="sl-settings-group" aria-labelledby="set-about">
          <h3 id="set-about">About</h3>
          <div className="sl-settings-about">
            <Glyph size={28} />
            <p>
              <b>Tether</b> · agents work freely, tethered to your plan and to you.
            </p>
          </div>
          <p>
            The command is <code>tether</code>; <code>aorch</code> still works. Runs, crew and settings stay in <code>{p.home ?? '~/.aorch'}</code>.
          </p>
        </section>
      </DrawerContent>
    </Drawer>
  );
}
