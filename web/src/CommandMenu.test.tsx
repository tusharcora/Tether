import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { CommandMenu } from './CommandMenu';
import { makeRow, routeApi } from './test/fixtures';

const handlers = () => ({ onOpenChange: vi.fn(), onGo: vi.fn(), onSettings: vi.fn(), onTheme: vi.fn() });
const open = () => {
  const p = handlers();
  render(<CommandMenu open {...p} />);
  return p;
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/runs': [makeRow({ id: 'r3', task: 'Ship the thing' })], 'GET /api/pipelines': [{ name: 'full-review' }] });
});

describe('CommandMenu', () => {
  it('lists Go to entries for every screen in sidebar order', () => {
    open();
    for (const s of ['Home', 'Runs', 'Code', 'Builder', 'Crew', 'API', 'Graph', 'Triggers']) expect(screen.getByText(`Go to ${s}`)).toBeTruthy();
    expect(screen.getAllByText('Go to').length).toBeGreaterThan(0);
    const labels = screen.getAllByText(/^Go to \w+$/).map((e) => e.textContent);
    expect(labels).toEqual(['Go to Home', 'Go to Runs', 'Go to Code', 'Go to Builder', 'Go to Crew', 'Go to API', 'Go to Graph', 'Go to Triggers']);
  });
  it('goes to a screen', () => {
    const p = open();
    fireEvent.click(screen.getByText('Go to Home'));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'home' });
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });
  it('lands focus on the screen, not the body, when it closes with no opener left', async () => {
    const main = document.createElement('main');
    main.className = 'shell-main';
    main.tabIndex = -1;
    document.body.append(main);
    const p = handlers();
    const { rerender } = render(<CommandMenu open {...p} />);
    fireEvent.click(screen.getByText('Go to Home'));
    rerender(<CommandMenu open={false} {...p} />);
    await waitFor(() => expect(document.activeElement).toBe(main));
    main.remove();
  });
  it('opens Settings', () => {
    const p = open();
    fireEvent.click(screen.getByText('Open Settings'));
    expect(p.onSettings).toHaveBeenCalled();
    expect(p.onGo).not.toHaveBeenCalled();
  });
  it.each([['Theme: Light', 'light'], ['Theme: Dark', 'dark'], ['Theme: Match system', 'system']])('picks %s', (label, choice) => {
    const p = open();
    fireEvent.click(screen.getByText(label));
    expect(p.onTheme).toHaveBeenCalledWith(choice);
  });
  it('keeps recent runs and workflows', async () => {
    const p = open();
    fireEvent.click(await screen.findByText('Ship the thing'));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r3' });
    fireEvent.click(await screen.findByText('Open in Builder'));
    expect(p.onGo).toHaveBeenLastCalledWith({ tab: 'builder', id: 'full-review' });
  });
  it('finds files of the current project by name, from two characters, and opens them in Code', async () => {
    routeApi({ 'GET /api/runs': [], 'GET /api/pipelines': [], 'GET /api/code/search?ws=shop&q=lmt&mode=name': { hits: [{ path: 'src/http/limit.ts' }] } });
    const p = handlers();
    render(<CommandMenu open {...p} ws="shop" />);
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'l' } });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText('Files')).toBeNull();
    fireEvent.change(field, { target: { value: 'lmt' } });
    fireEvent.click(await screen.findByText('src/http/limit.ts'));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'code', id: 'src/http/limit.ts' });
  });
  it('fetches nothing while closed', () => {
    render(<CommandMenu open={false} {...handlers()} />);
    expect(screen.queryByText('Go to Crew')).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });
});
