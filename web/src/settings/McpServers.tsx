import { useEffect, useState } from 'react';
import { api } from '../api';
import { McpServerPanel, type McpServerStatus } from '../components/assistant-ui/elements/mcp-server-panel';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import { Textarea } from '../components/kept/textarea/textarea';
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
/** A server Tether offers to add with one click (the browser presets). */
export interface McpPreset {
  name: string;
  label: string;
  command: string;
  args: string[];
}
export const MCP_PATH = '/api/codemode/mcp';

/**
 * Each server's state from a real connection: connecting while its test runs, then connected with its tool names, or
 * failed. Tested when the list shows and whenever its names change.
 */
function useServerTests(names: string[]): Record<string, { status: McpServerStatus; tools: string[] }> {
  const [tests, setTests] = useState<Record<string, { status: McpServerStatus; tools: string[] }>>({});
  const key = names.join('\0');
  useEffect(() => {
    let live = true;
    setTests(Object.fromEntries(names.map((n) => [n, { status: 'connecting', tools: [] }])));
    for (const n of names)
      api<{ ok: boolean; tools?: string[] }>('POST', `/api/codemode/connectors/${encodeURIComponent(`mcp.${n}`)}/test`, {}).then(
        (r) => live && setTests((t) => ({ ...t, [n]: { status: r.ok ? 'connected' : 'failed', tools: r.tools ?? [] } })),
        () => live && setTests((t) => ({ ...t, [n]: { status: 'failed', tools: [] } })),
      );
    return () => void (live = false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return tests;
}

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
export function McpServers(p: { poll: Poll<{ servers: McpServerView[]; presets?: McpPreset[] }> }) {
  const notify = useNotify();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [pairs, setPairs] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error, refresh } = p.poll;
  const tests = useServerTests((data?.servers ?? []).map((s) => s.name));
  const [expanded, setExpanded] = useState<string>();
  const presets = (data?.presets ?? []).filter((x) => !data?.servers.some((s) => s.name === x.name));
  const add = async (as: string, body: Record<string, unknown>, clear: boolean) => {
    setBusy(true);
    try {
      await api('PUT', `${MCP_PATH}/${encodeURIComponent(as)}`, body);
      if (clear) {
        setName('');
        setTarget('');
        setPairs('');
      }
      await refresh();
      notify.ok('MCP server added', `Agents reach it as mcp.${as} in Code Mode`);
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
          <>
            <McpServerPanel
              servers={data.servers.map((s) => ({ id: s.name, name: `mcp.${s.name}`, transport: s.kind === 'http' ? 'HTTP' : 'stdio', ...(tests[s.name] ?? { status: 'connecting', tools: [] }) }))}
              expandedId={expanded}
              onToggle={(id) => setExpanded((e) => (e === id ? undefined : id))}
            />
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
          </>
        ) : (
          <p className="acc-note">No MCP servers yet.</p>
        )}
      </Loading>
      {presets.length ? (
        <div className="mcp-presets">
          <span className="acc-note">Browser presets (off until you add one):</span>
          {presets.map((x) => (
            <Button key={x.name} variant="secondary" size="sm" disabled={busy} title={[x.command, ...x.args].join(' ')} onClick={() => void add(x.name, { command: x.command, args: x.args }, false)}>
              Add {x.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="mcp-form">
        <Input label="Name" value={name} placeholder="files" spellCheck={false} onChange={(e) => setName(e.target.value)} />
        <Input label="Command or URL" value={target} placeholder="npx -y @modelcontextprotocol/server-filesystem ." spellCheck={false} onChange={(e) => setTarget(e.target.value)} />
        <Textarea label="Env (KEY=value) or headers (Name: value), one per line" rows={2} value={pairs} spellCheck={false} onChange={(e) => setPairs(e.target.value)} />
        <Button variant="secondary" size="sm" disabled={busy || !name.trim() || !target.trim()} onClick={() => void add(name.trim(), serverBody(target, pairs), true)}>
          Add server
        </Button>
      </div>
    </div>
  );
}
