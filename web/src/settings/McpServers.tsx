import { useState } from 'react';
import { api } from '../api';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import { Textarea } from '../components/arc/textarea/textarea';
import { Loading } from '../components/Loading';
import type { Poll } from '../hooks';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import './settings.css';

export interface McpServerView {
  name: string;
  kind: 'stdio' | 'http';
  target: string;
  envKeys: string[];
  headerKeys: string[];
}
export const MCP_PATH = '/api/codemode/mcp';

/** `KEY=value` lines as an object (blank lines and lines without `=` are skipped). */
export function parsePairs(text: string, sep = '='): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep);
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** What the form sends: a URL becomes an HTTP server (the pairs are headers), anything else a command line (the pairs are env). */
export function serverBody(target: string, pairs: string): Record<string, unknown> {
  const t = target.trim();
  if (/^https?:\/\//i.test(t)) {
    const headers = parsePairs(pairs, ':');
    return { url: t, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  const [command = '', ...args] = t.split(/\s+/);
  const env = parsePairs(pairs);
  return { command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) };
}

/**
 * Settings → Tools: MCP servers for Code Mode. Each becomes an `mcp.<name>` connector agents find and call from run_code,
 * instead of loading every tool definition. Env and header values are sent once and never shown again.
 */
export function McpServers(p: { poll: Poll<{ servers: McpServerView[] }> }) {
  const notify = useNotify();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [pairs, setPairs] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error, refresh } = p.poll;
  const add = async () => {
    setBusy(true);
    try {
      await api('PUT', `${MCP_PATH}/${encodeURIComponent(name.trim())}`, serverBody(target, pairs));
      setName('');
      setTarget('');
      setPairs('');
      await refresh();
      notify.ok('MCP server added', `Agents reach it as mcp.${name.trim()} in Code Mode`);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (s: McpServerView) => {
    try {
      await api('DELETE', `${MCP_PATH}/${encodeURIComponent(s.name)}`);
      await refresh();
    } catch (e) {
      notify.fail(e);
    }
  };
  return (
    <div className="mcp-panel">
      <p>Each server becomes a Code Mode connector (<code>mcp.&lt;name&gt;</code>): agents find its tools with <code>codemode.search</code> instead of loading them all.</p>
      <Loading loading={!data && !error} lines={2} label="Loading MCP servers">
        {error && !data ? (
          <InlineError compact message={error} onRetry={() => void refresh()} />
        ) : data?.servers.length ? (
          <ul className="acc-list">
            {data.servers.map((s) => (
              <li key={s.name} className="acc-row">
                <div className="acc-head">
                  <b>mcp.{s.name}</b>
                  <span className="acc-note">{s.kind === 'http' ? 'HTTP' : 'stdio'}</span>
                </div>
                <code className="mcp-target">{s.target}</code>
                {s.envKeys.length || s.headerKeys.length ? <p className="acc-note">{[...s.envKeys, ...s.headerKeys].join(', ')} set (values hidden)</p> : null}
                <div className="acc-actions">
                  <ConfirmButton label="Remove" prompt={`Remove mcp.${s.name}? Agents lose its tools from the next run.`} confirmLabel="Remove" onConfirm={() => remove(s)} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="acc-note">No MCP servers yet.</p>
        )}
      </Loading>
      <div className="mcp-form">
        <Input label="Name" value={name} placeholder="files" spellCheck={false} onChange={(e) => setName(e.target.value)} />
        <Input label="Command or URL" value={target} placeholder="npx -y @modelcontextprotocol/server-filesystem ." spellCheck={false} onChange={(e) => setTarget(e.target.value)} />
        <Textarea label="Env (KEY=value) or headers (Name: value), one per line" rows={2} value={pairs} spellCheck={false} onChange={(e) => setPairs(e.target.value)} />
        <Button variant="secondary" size="sm" disabled={busy || !name.trim() || !target.trim()} onClick={() => void add()}>
          Add server
        </Button>
      </div>
    </div>
  );
}
