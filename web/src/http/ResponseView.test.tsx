import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SendOutput } from './client';
import { fmtBytes, ResponseView, statusTone } from './ResponseView';

const out = (o: Partial<SendOutput['result']> = {}, checks: SendOutput['checks'] = []): SendOutput => ({
  historyId: 1,
  request: { method: 'GET', url: 'http://h/api/runs', headers: [] },
  result: { status: 200, statusText: 'OK', url: 'http://h/api/runs', headers: [['content-type', 'application/json'], ['x-rate', '10']], body: '{"items":[{"id":7}]}', size: 2048, truncated: false, ms: 120, timing: { ttfb: 90, download: 30 }, redirects: [], ...o },
  checks,
});

describe('ResponseView', () => {
  it('formats sizes and picks a tone per status', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    // 2xx ok; 3xx warn; 4xx, 5xx and status 0 (network error) bad.
    expect([statusTone(204), statusTone(302), statusTone(404), statusTone(500), statusTone(0)]).toEqual(['ok', 'warn', 'bad', 'bad', 'bad']);
  });

  it('shows the status pill, time, size and a JSON tree', () => {
    const { container } = render(<ResponseView output={out()} sending={false} />);
    const pill = screen.getByText('200 OK');
    expect(pill.getAttribute('data-tone')).toBe('ok');
    expect(screen.getByText('120 ms')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByRole('tree')).toBeTruthy();
    const bars = container.querySelectorAll<HTMLElement>('.timing-bar');
    expect([...bars].map((b) => b.style.width)).toEqual(['75%', '25%']);
    expect(screen.getByText('TTFB 90 ms')).toBeTruthy();
  });

  it('colours a redirect amber and client and server errors red', () => {
    const { rerender } = render(<ResponseView output={out({ status: 304, statusText: 'Not Modified' })} sending={false} />);
    expect(screen.getByText('304 Not Modified').getAttribute('data-tone')).toBe('warn');
    rerender(<ResponseView output={out({ status: 404, statusText: 'Not Found' })} sending={false} />);
    expect(screen.getByText('404 Not Found').getAttribute('data-tone')).toBe('bad');
    rerender(<ResponseView output={out({ status: 503, statusText: 'Service Unavailable' })} sending={false} />);
    expect(screen.getByText('503 Service Unavailable').getAttribute('data-tone')).toBe('bad');
  });

  it('switches to raw and headers views', () => {
    render(<ResponseView output={out()} sending={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('{"items":[{"id":7}]}')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Headers' }));
    expect(screen.getByText('x-rate')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('switches views from the keyboard', () => {
    render(<ResponseView output={out()} sending={false} />);
    const body = screen.getByRole('button', { name: 'Body' });
    expect(body.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(body, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Raw' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('folds the JSON tree with labelled buttons and offers copy path', () => {
    render(<ResponseView output={out()} sending={false} />);
    const items = screen.getAllByRole('treeitem');
    expect(items[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: /copy path/i }).length).toBeGreaterThan(0);
  });

  it('opens only the root of a large JSON body so a 5 MB response does not unfold thousands of rows', () => {
    const big = JSON.stringify({ items: Array.from({ length: 40000 }, (_, i) => ({ id: i, name: `item ${i}` })) });
    expect(big.length).toBeGreaterThan(1024 * 1024);
    render(<ResponseView output={out({ body: big, size: big.length })} sending={false} />);
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(2);
    expect(items[1]!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a non-JSON body is shown as text, and truncation is said', () => {
    render(<ResponseView output={out({ body: '<html>hi</html>', headers: [['content-type', 'text/html']], truncated: true })} sending={false} />);
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByText('<html>hi</html>')).toBeTruthy();
    expect(screen.getByText('truncated at 5 MB')).toBeTruthy();
  });

  it('a network error is a red pill with its kind', () => {
    render(<ResponseView output={out({ status: 0, statusText: '', body: '', error: { kind: 'refused', message: 'connect ECONNREFUSED 127.0.0.1:9' } })} sending={false} />);
    const pill = screen.getByText('refused');
    expect(pill.getAttribute('data-tone')).toBe('bad');
    expect(screen.getByText('connect ECONNREFUSED 127.0.0.1:9')).toBeTruthy();
  });

  it('lists check results with pass and fail marks', () => {
    render(<ResponseView output={out({}, [{ check: { kind: 'status', op: 'eq', value: 200 }, ok: true, actual: 200 }, { check: { kind: 'time', op: 'lt', value: 100 }, ok: false, actual: 120 }])} sending={false} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-ok'))).toEqual(['true', 'false']);
    expect(rows[0]!.textContent).toContain('status eq 200');
    expect(rows[1]!.textContent).toContain('time < 100 ms');
    expect(rows[1]!.textContent).toContain('actual 120');
    expect(screen.getByText('1 of 2 checks passed')).toBeTruthy();
  });

  it('shows the ascii skeleton while sending and the request error when the send was refused', () => {
    const { rerender } = render(<ResponseView sending output={undefined} />);
    expect(screen.getByRole('status', { name: 'Sending' })).toBeTruthy();
    rerender(<ResponseView sending={false} error="unknown variables: base" />);
    expect(screen.getByRole('alert').textContent).toBe('unknown variables: base');
    rerender(<ResponseView sending={false} />);
    expect(screen.getByText(/Send a request to see its response/)).toBeTruthy();
  });
});

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;
const read = (p: string) => readFileSync(new URL(p, here), 'utf8');

describe('response styles', () => {
  const css = read('./api.css');
  const section = css.slice(css.indexOf('/* Response'));

  it('colours pills from the role tokens only and keeps purple, gradients and glows out', () => {
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('.resp .pill[data-tone="ok"] { background: var(--okBg); color: var(--ok); }');
    expect(section).toContain('.resp .pill[data-tone="warn"] { background: var(--warnBg); color: var(--warn); }');
    expect(section).toContain('.resp .pill[data-tone="bad"] { background: var(--badBg); color: var(--bad); }');
    expect(section).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(section).not.toMatch(/purple|violet|gradient\(|box-shadow/i);
  });

  it("flattens the JSON viewer's gradient row actions to token backgrounds inside the API tab", () => {
    // Arc's module paints .actions with linear-gradient (resting and on row hover); these rules outrank both.
    expect(section).toContain('.api-tab .resp-body [role="treeitem"] [class*="actions"] { background: var(--s1); }');
    expect(section).toContain('.api-tab .resp-body [role="treeitem"]:hover [class*="actions"] { background: var(--s2); }');
    expect(section).toContain('.api-tab .resp-body [role="treeitem"]:not([data-active]):hover { --row-hover: var(--s2); }');
    expect(section).not.toMatch(/linear-gradient/);
  });

  it('moves on the Studio Live curve and durations', () => {
    const motion = [...section.matchAll(/(?:transition|animation):[^;]+/g)].map((m) => m[0]);
    expect(motion.length).toBeGreaterThan(0);
    for (const m of motion) expect(m).toMatch(/var\(--t-(fast|med|slow)\) var\(--ease\)/);
  });
});
