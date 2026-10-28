import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CopyButton } from '../../components/beui/kit/CopyButton';
import { SegmentedControl } from '../../components/beui/kit/controls';
import { Switch } from '../../components/beui/kit/fields';
import type { Poll } from '../../hooks';
import { Accounts } from '../../settings/Accounts';
import type { AccountsView } from '../../settings/accountsApi';
import { Connectors, type ConnectorView } from '../../settings/Connectors';
import { McpServers, type McpServerView } from '../../settings/McpServers';
import { ThemeToggle } from '../../components/beui/motion/theme-toggle';
import { resolveTheme, THEME_LABEL, type ThemeChoice } from '../../theme';
import { ToolsStrip, type Tools } from '../../welcome/ToolsStrip';
import { CONNECTION_LABEL, type Connection } from './connection';
import { Glyph } from './Glyph';
import { Disclosure } from './Section';
import { StatusBadge, type Tone } from './StatusBadge';
import { FloatBar, ToolScreen } from './ToolFrame';
import { isTyping } from './useGoKeys';
import './shell.css';
import './settings-page.css';

const TONE: Record<Connection, Tone> = { connecting: 'neutral', connected: 'done', reconnecting: 'needs', offline: 'failed' };
const CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];
/** Still in the page, not hidden (`checkVisibility` where the browser has it) and not inside a layer that is leaving (beui marks it inert). */
const focusable = (el: HTMLElement) => el.isConnected && !el.closest('[inert]') && el.checkVisibility?.() !== false;
/** Another dialog (opened from a card), a menu or an open select owns Esc while it is up; one that is closing (inert) does not. */
const POPUP = '[role="dialog"], [role="menu"], [role="listbox"]:not([aria-hidden="true"])';

const Card = (p: { id: string; title: string; children: ReactNode }) => (
  <section className="st-card" id={`set-${p.id}`} aria-labelledby={`set-${p.id}-h`}>
    <h2 id={`set-${p.id}-h`}>{p.title}</h2>
    {p.children}
  </section>
);

export interface SettingsPageProps {
  onClose: () => void;
  choice: ThemeChoice;
  onChoice: (c: ThemeChoice) => void;
  vault?: string;
  home?: string;
  connection: Connection;
  /** The agent tools found on the server's PATH (shown when given). */
  tools?: Poll<Tools>;
  /** Connected accounts (shown when given). */
  accounts?: Poll<AccountsView>;
  /** Code Mode's MCP servers (shown when given). */
  mcp?: Poll<{ servers: McpServerView[] }>;
  /** Code Mode's connectors (shown when given). */
  connectors?: Poll<{ connectors: ConnectorView[] }>;
  /** A section to scroll to (the sidebar's account row opens Accounts). */
  section?: string;
  /** Tether.app's notifications switch (shown when given). */
  notifications?: { on: boolean; onChange: (on: boolean) => void };
  /** Where focus goes on close when the opener is gone. */
  returnFocus?: () => HTMLElement | null | undefined;
}

/**
 * Settings as a page (spec §11, §15.2): it covers the content area while the screen it opened over stays mounted
 * underneath (App keeps it), so unsaved work survives. It is a (non-modal) dialog: the screen underneath ignores its keys
 * while it is up (docks' Esc, the Builder's "/"). A section list on the left marks the card picked or scrolled to; long
 * help folds away. Esc or × closes it and puts focus back on its opener.
 */
export function SettingsPage(p: SettingsPageProps) {
  const page = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Settings opens from the rail, the bottom bar, a key or a link: it remembers its opener to hand focus back
  const opener = useRef(document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  const sections = [
    ...(p.accounts ? [{ id: 'accounts', title: 'Accounts' }] : []),
    ...(p.tools || p.mcp || p.connectors ? [{ id: 'agents', title: 'Agents & tools' }] : []),
    { id: 'appearance', title: 'Appearance' },
    { id: 'storage', title: 'Storage' },
    { id: 'server', title: 'Server' },
    { id: 'about', title: 'About' },
  ];
  const [current, setCurrent] = useState(p.section ?? sections[0]!.id);
  useEffect(() => page.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (!p.section) return;
    setCurrent(p.section);
    const t = setTimeout(() => document.getElementById(`set-${p.section}`)?.scrollIntoView({ block: 'start' }));
    return () => clearTimeout(t);
  }, [p.section]);

  const close = () => {
    const el = opener.current;
    const to = el && focusable(el) ? el : p.returnFocus?.();
    p.onClose();
    if (to) setTimeout(() => focusable(to) && to.focus());
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const other = [...document.querySelectorAll(POPUP)].some((d) => d !== page.current && !d.closest('[inert]'));
    if (e.key !== 'Escape' || e.defaultPrevented || other) return;
    // handled here: the screen underneath must not take this Esc too (its dock listens on the window)
    e.preventDefault();
    if (isTyping(e.target)) (e.target as HTMLElement).blur();
    else close();
  };
  const pick = (id: string) => {
    setCurrent(id);
    document.getElementById(`set-${id}`)?.scrollIntoView({ block: 'start' });
  };
  /** The card nearest the top of the page is the current one (mockup .snav). */
  const onScroll = () => {
    const top = scroller.current?.scrollTop ?? 0;
    let cur = sections[0]!.id;
    for (const s of sections) {
      const el = document.getElementById(`set-${s.id}`);
      if (el && el.offsetTop - top < 120) cur = s.id;
    }
    setCurrent(cur);
  };

  return (
    <div ref={page} className="st-page" role="dialog" aria-label="Settings" tabIndex={-1} onKeyDown={onKey}>
      <ToolScreen className="st-screen">
        <div ref={scroller} className="st-scroll" onScroll={onScroll}>
          {p.accounts ? (
            <Card id="accounts" title="Accounts">
              <Accounts poll={p.accounts} />
              <Disclosure label="How connecting works">
                <p className="st-help">Connect accounts to this Tether. Tokens stay on this Mac (in the Keychain) and never reach this page.</p>
              </Disclosure>
            </Card>
          ) : null}
          {p.tools || p.mcp || p.connectors ? (
            <Card id="agents" title="Agents & tools">
              {p.tools ? (
                <section className="sl-settings-group" aria-labelledby="set-tools">
                  <h3 id="set-tools">Agent tools</h3>
                  <ToolsStrip poll={p.tools} />
                </section>
              ) : null}
              {p.connectors ? (
                <section className="sl-settings-group" aria-labelledby="set-connectors">
                  <h3 id="set-connectors">Connectors</h3>
                  <Connectors poll={p.connectors} />
                </section>
              ) : null}
              {p.mcp ? (
                <section className="sl-settings-group" aria-labelledby="set-mcp">
                  <h3 id="set-mcp">MCP servers</h3>
                  <McpServers poll={p.mcp} />
                </section>
              ) : null}
            </Card>
          ) : null}
          <Card id="appearance" title="Appearance">
            <section className="sl-settings-group" aria-labelledby="set-theme">
              <h3 id="set-theme">Theme</h3>
              <div className="sl-settings-theme">
                <SegmentedControl label="Theme" options={CHOICES.map((c) => ({ value: c, label: THEME_LABEL[c] }))} value={p.choice} onValueChange={(v) => p.onChoice(v as ThemeChoice)} />
                {/* beui's toggle repaints the page from a circle (View Transition API); it flips the theme in force and pins that choice */}
                <ThemeToggle variant="circle" start="center" theme={resolveTheme(p.choice)} onThemeChange={(t) => p.onChoice(t)} className="size-9 flex-none rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-muted" iconClassName="size-4" />
              </div>
            </section>
            {p.notifications ? (
              <section className="sl-settings-group" aria-labelledby="set-notify">
                <h3 id="set-notify">Notifications</h3>
                <Switch label="Tell me when a run needs me or finishes" checked={p.notifications.on} onCheckedChange={(c) => p.notifications!.onChange(c === true)} />
              </section>
            ) : null}
          </Card>
          <Card id="storage" title="Storage">
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
          </Card>
          <Card id="server" title="Server">
            <section className="sl-settings-group" aria-labelledby="set-conn">
              <h3 id="set-conn">Connection</h3>
              <StatusBadge tone={TONE[p.connection]} label={CONNECTION_LABEL[p.connection]} pulse={p.connection === 'reconnecting'} />
            </section>
            <Disclosure label="Why loopback only">
              <p className="st-help">The API starts agents and writes files, so it only listens on this machine.</p>
            </Disclosure>
          </Card>
          <Card id="about" title="About">
            <div className="sl-settings-about">
              <Glyph size={28} />
              <p>
                <b>Tether</b> · agents work freely, tethered to your plan and to you.
              </p>
            </div>
            <p className="st-help">
              The command is <code>tether</code>; <code>aorch</code> still works. Runs, crew and settings stay in <code>{p.home ?? '~/.aorch'}</code>.
            </p>
          </Card>
        </div>
        <nav className="st-nav" aria-label="Settings sections">
          {sections.map((s) => (
            <button key={s.id} type="button" aria-current={current === s.id || undefined} onClick={() => pick(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <FloatBar at="left">
          <h1 className="st-title">Settings</h1>
          <span className="st-fact">this Mac</span>
          <button type="button" className="tf-x" aria-label="Close settings" onClick={close}>
            <X size={16} aria-hidden="true" />
          </button>
        </FloatBar>
      </ToolScreen>
    </div>
  );
}
