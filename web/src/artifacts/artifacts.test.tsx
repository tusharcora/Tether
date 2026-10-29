import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { splitArtifacts, wordCount } from '../../../src/assistant/artifactBlocks';
import type { ArtifactMeta, ArtifactView, ChatMessage } from '../assistant/api';
import { Assistant } from '../assistant/Assistant';
import { Thread, visibleText } from '../assistant/Thread';
import { Conversation } from '../chats/Conversation';
import { renderApp } from '../test/render';
import { ArtifactViewer } from './ArtifactViewer';
import { Artifacts } from './Artifacts';

const meta: ArtifactMeta = { id: 'landing', title: 'Landing page', kind: 'html', chatId: 'c1', createdAt: 1, updatedAt: 2, versions: [{ n: 1, at: 1, file: 'v1.html', bytes: 10 }, { n: 2, at: 2, file: 'v2.html', bytes: 10 }] };
const doc: ArtifactMeta = { id: 'notes', title: 'Notes', kind: 'markdown', createdAt: 1, updatedAt: 1, versions: [{ n: 1, at: 1, file: 'v1.md', words: 3 }] };
const views: Record<string, ArtifactView> = {
  'landing@2': { meta, version: 2, content: '<h1>v2</h1>', path: '/p/.aorch/artifacts/landing/v2.html' },
  'landing@1': { meta, version: 1, content: '<h1>v1</h1>', path: '/p/.aorch/artifacts/landing/v1.html' },
  'notes@1': { meta: doc, version: 1, content: '# Notes\n\nSome text.', path: '/p/.aorch/artifacts/notes/v1.md' },
};

/** The artifact routes over a fake fetch: list, one version (latest when no `v`), delete. */
function serve() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      calls.push(`${init?.method ?? 'GET'} ${u.pathname}${u.search}`);
      if (u.pathname === '/api/assistant/artifacts') return new Response(JSON.stringify({ artifacts: [meta, doc] }));
      const id = decodeURIComponent(u.pathname.split('/').pop()!);
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
      const v = u.searchParams.get('v') ?? (id === 'landing' ? '2' : '1');
      const body = views[`${id}@${v}`];
      return body ? new Response(JSON.stringify(body)) : new Response(JSON.stringify({ error: 'no such artifact' }), { status: 404 });
    }),
  );
  return calls;
}

const fakeChat = (messages: ChatMessage[], o: Record<string, unknown> = {}) => ({ messages, models: [], loading: false, queue: [], feedback: vi.fn(), regenerate: vi.fn(), send: vi.fn(), turnIntoRun: vi.fn(), ...o }) as never;

describe('the artifact viewer', () => {
  it('previews HTML in an iframe sandboxed to scripts alone, switches versions, shows the code and closes', async () => {
    const calls = serve();
    const onClose = vi.fn();
    renderApp(<ArtifactViewer ws="api" id="landing" project="API" onClose={onClose} />);
    const frame = (await screen.findByTitle('Preview of Landing page')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toBe('<h1>v2</h1>');
    expect(screen.getByText('v2 of 2')).toBeTruthy();
    expect(screen.getByText('HTML · API')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next version' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    await waitFor(() => expect(screen.getByTitle('Preview of Landing page').getAttribute('srcdoc')).toBe('<h1>v1</h1>'));
    expect(calls).toContain('GET /api/assistant/artifacts/landing?ws=api&v=1');
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.getByText('v1.html')).toBeTruthy();
    expect(screen.queryByTitle('Preview of Landing page')).toBeNull();
    // no Tether.app bridge in a browser: no Show in Finder
    expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close artifact' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders a Markdown doc with the assistant’s Markdown, headings included', async () => {
    serve();
    renderApp(<ArtifactViewer id="notes" onClose={() => {}} />);
    expect((await screen.findByRole('heading', { name: 'Notes' })).tagName).toBe('H2');
    expect(screen.getByText('Some text.')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('says when the artifact is gone', async () => {
    serve();
    renderApp(<ArtifactViewer id="gone" onClose={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toContain('no such artifact');
  });
});

describe('artifacts in the thread', () => {
  it('a saved reply shows each artifact as a card that opens it', () => {
    const onArtifact = vi.fn();
    const ref = { id: 'landing', version: 2, title: 'Landing page', kind: 'html' as const };
    renderApp(<Thread chat={fakeChat([{ id: 'y', role: 'you', text: 'make it', at: 1 }, { id: 'a', role: 'tether', text: 'Here it is.', at: 2, artifacts: [ref] }])} onGo={vi.fn()} empty="" project="API" onArtifact={onArtifact} />);
    expect(screen.getByText('HTML · v2 · API')).toBeTruthy();
    const card = screen.getByRole('button', { name: 'Open Landing page, HTML · v2' });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onArtifact).toHaveBeenCalledTimes(2);
    expect(onArtifact).toHaveBeenCalledWith(ref);
  });

  it('while the reply streams, the artifact is a generating card counting words, and its content never shows', () => {
    const text = 'Writing the page.\n<artifact title="Pricing" kind="html">\n<section>three tiers here</section>';
    renderApp(<Thread chat={fakeChat([], { streaming: { text, tools: [], startedAt: Date.now() } })} onGo={vi.fn()} empty="" />);
    expect(screen.getByText('Pricing')).toBeTruthy();
    expect(screen.getByText('Writing')).toBeTruthy();
    expect(screen.getByText(`${wordCount(splitArtifacts(text).artifacts[0]!.content)} words`)).toBeTruthy();
    expect(screen.getByText('Writing the page.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('three tiers');
    expect(visibleText(text)).toBe('Writing the page.');
  });
});

describe('where an artifact opens', () => {
  const chatWith = () => fakeChat([{ id: 'a', role: 'tether', text: 'Here.', at: 2, artifacts: [{ id: 'landing', version: 1, title: 'Landing page', kind: 'html' }] }], { title: 'Pages', chatId: 'c1', rename: vi.fn() });
  it('the full chat opens it in a panel beside the thread, at the version the card names', async () => {
    const calls = serve();
    renderApp(<Conversation chat={chatWith()} project={{ id: 'api', name: 'API' }} context={{ page: 'chats' }} onGo={vi.fn()} onPopOut={vi.fn()} onRenamed={vi.fn()} onDelete={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Open Landing page/ }));
    expect((await screen.findByTitle('Preview of Landing page')).closest('aside.chat-artifact')).toBeTruthy();
    expect(calls).toContain('GET /api/assistant/artifacts/landing?ws=api&v=1');
    fireEvent.click(screen.getByRole('button', { name: 'Close artifact' }));
    expect(document.querySelector('aside.chat-artifact')).toBeNull();
  });
  it('the mini chat opens it over the screen in a dialog', async () => {
    serve();
    const shell = { mode: 'float', docked: false, unseen: 0, open: vi.fn(), close: vi.fn(), dock: vi.fn() } as never;
    renderApp(<Assistant shell={shell} chat={chatWith()} chats={[]} project={{ id: 'api', name: 'API' }} route={{ tab: 'home' }} phone={false} onPick={vi.fn()} onFullScreen={vi.fn()} onAllChats={vi.fn()} onGo={vi.fn()} onStarter={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Open Landing page/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Landing page' });
    expect(await within(dialog).findByTitle('Preview of Landing page')).toBeTruthy();
  });
});

describe('the Artifacts screen', () => {
  it('lists the project’s artifacts, opens one beside the list, goes to its chat, and deletes after asking', async () => {
    const calls = serve();
    const onGo = vi.fn();
    renderApp(<Artifacts ws="api" project={{ id: 'api', name: 'API' }} onGo={onGo} />);
    expect(await screen.findByText('HTML · 2 versions · ' + new Date(2).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))).toBeTruthy();
    expect(screen.getByText(/Markdown · 1 version ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Landing page/ }));
    expect((await screen.findByTitle('Preview of Landing page')).getAttribute('sandbox')).toBe('allow-scripts');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'chats', id: 'c1' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Landing page and its 2 versions?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toContain('DELETE /api/assistant/artifacts/landing?ws=api'));
    await waitFor(() => expect(screen.queryByTitle('Preview of Landing page')).toBeNull());
  });

  it('says what an empty list means', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ artifacts: [] }))));
    renderApp(<Artifacts onGo={vi.fn()} />);
    expect(await screen.findByText('No artifacts yet')).toBeTruthy();
  });
});
