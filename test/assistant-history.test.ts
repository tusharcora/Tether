import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allChats, deleteChat, isChatId, listChats, loadAllow, readChat, saveChat, titleOf, type Chat } from '../src/assistant/history.js';
import type { ChatMessage } from '../src/assistant/types.js';
import { tmp } from './helpers.js';

const msg = (id: string, role: 'you' | 'tether', text: string, at: number): ChatMessage => ({ id, role, text, at });
const chat = (id: string, o: Partial<Chat> = {}): Chat => ({ id, title: id, created: 1, updated: 1, messages: [msg('m1', 'you', 'hi', 1)], once: [], ...o });
const old = (home: string, name: string, body: unknown) => {
  mkdirSync(join(home, 'assistant', name.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(join(home, 'assistant', name), typeof body === 'string' ? body : JSON.stringify(body));
};

describe('chat titles and ids', () => {
  it('titles a chat from the first line of the first message, cut at a word', () => {
    expect(titleOf('  why did\nit fail')).toBe('why did');
    const long = titleOf('the quick brown fox jumps over the lazy dog and keeps running far away from home');
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith('…')).toBe(true);
    expect(long.slice(0, -1).endsWith(' ')).toBe(false);
    expect('the quick brown fox jumps over the lazy dog and keeps running far away from home'.startsWith(long.slice(0, -1))).toBe(true);
    expect(titleOf('')).toBe('New chat');
  });

  it('takes only short URL-safe ids, never "allow"', () => {
    for (const ok of ['c1', 'a-2026-10-27T10-00-00-000Z', 'h-m-x_1']) expect(isChatId(ok)).toBe(true);
    for (const bad of ['../x', 'allow', '', 'x'.repeat(41), 'a/b', 'a.b', 7, undefined]) expect(isChatId(bad)).toBe(false);
  });
});

describe('chat files', () => {
  it('saves one private file per chat, keeps the last 200 messages, lists newest first and deletes', () => {
    const home = tmp('home-');
    saveChat(home, 'api', chat('c1', { updated: 5 }));
    saveChat(home, 'api', chat('c2', { updated: 9, messages: Array.from({ length: 250 }, (_, i) => msg(`m${i}`, 'you', `n${i}`, i)) }));
    expect(readChat(home, 'api', 'c1')?.title).toBe('c1');
    expect(readChat(home, 'api', 'c2')?.messages.length).toBe(200);
    expect(statSync(join(home, 'assistant', 'api', 'c1.json')).mode & 0o777).toBe(0o600);
    // stray files are not chats
    writeFileSync(join(home, 'assistant', 'api', 'c3.json'), JSON.stringify(chat('other')));
    writeFileSync(join(home, 'assistant', 'api', 'c4.json.1.tmp'), '{}');
    expect(listChats(home, 'api').map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(listChats(home, 'web')).toEqual([]);
    expect(deleteChat(home, 'api', 'c1')).toBe(true);
    expect(deleteChat(home, 'api', 'c1')).toBe(false);
    expect(readChat(home, 'api', 'c1')).toBeUndefined();
  });

  it('builds no path from a bad id', () => {
    const home = tmp('home-');
    old(home, 'api/allow.json', { always: ['x'] });
    expect(() => deleteChat(home, 'api', 'allow')).toThrow();
    expect(() => readChat(home, 'api', '../api/allow')).toThrow();
    expect(loadAllow(home, 'api')).toEqual(['x']);
  });
});

describe('moving the old chat and its archives into chats', () => {
  const current = { messages: [msg('m-cur1', 'you', 'Why did the README run fail?\nmore', 100), msg('m-cur2', 'tether', 'Lens failed it.', 200)], always: ['GET x'], once: ['y'] };
  const archived = (n: number) => ({ messages: [msg(`m-a${n}`, 'you', `archived ${n}`, n), msg(`m-b${n}`, 'tether', 'ok', n + 1)] });

  it('turns the current chat and every archive into chats, keeps the allowed calls, then removes the old files', () => {
    const home = tmp('home-');
    old(home, 'api.json', current);
    old(home, 'api.archive/2026-10-27T10-00-00-000Z.json', archived(1));
    old(home, 'api.archive/2026-10-27T11-00-00-000Z.json', archived(2));
    const chats = listChats(home, 'api');
    expect(chats.map((c) => c.title).sort()).toEqual(['Why did the README run fail?', 'archived 1', 'archived 2']);
    const a1 = chats.find((c) => c.title === 'archived 1')!;
    expect(a1).toMatchObject({ created: 1, updated: Date.parse('2026-10-27T10:00:00.000Z'), once: [] });
    expect(a1.messages.length).toBe(2);
    const cur = chats.find((c) => c.title.startsWith('Why'))!;
    expect(cur).toMatchObject({ created: 100, updated: 200, once: ['y'] });
    expect(loadAllow(home, 'api')).toEqual(['GET x']);
    expect(existsSync(join(home, 'assistant', 'api.json'))).toBe(false);
    expect(existsSync(join(home, 'assistant', 'api.archive'))).toBe(false);
    for (const f of readdirSync(join(home, 'assistant', 'api'))) expect(statSync(join(home, 'assistant', 'api', f)).mode & 0o777).toBe(0o600);
    // idempotent
    expect(listChats(home, 'api').length).toBe(3);
  });

  it('leaves an unreadable archive where it is and moves the rest', () => {
    const home = tmp('home-');
    old(home, 'api.archive/2026-10-27T10-00-00-000Z.json', '{ not json');
    old(home, 'api.archive/2026-10-27T11-00-00-000Z.json', archived(2));
    expect(listChats(home, 'api').map((c) => c.title)).toEqual(['archived 2']);
    expect(readdirSync(join(home, 'assistant', 'api.archive'))).toEqual(['2026-10-27T10-00-00-000Z.json']);
  });

  it('keeps the allowed calls of an empty chat file without making a chat', () => {
    const home = tmp('home-');
    old(home, 'api/allow.json', { always: ['a'] });
    old(home, 'api.json', { messages: [], always: ['b', 'a'], once: [] });
    expect(listChats(home, 'api')).toEqual([]);
    expect(loadAllow(home, 'api')).toEqual(['a', 'b']);
    expect(existsSync(join(home, 'assistant', 'api.json'))).toBe(false);
  });

  it('re-migrates a chat an older build wrote after the move, losing nothing', () => {
    const home = tmp('home-');
    old(home, 'api.json', current);
    expect(listChats(home, 'api').length).toBe(1);
    old(home, 'api.json', { messages: [msg('m-new1', 'you', 'second life', 300)], always: [], once: [] });
    expect(listChats(home, 'api').map((c) => c.title).sort()).toEqual(['Why did the README run fail?', 'second life']);
  });

  it('lists every chat of every project, old layout included', () => {
    const home = tmp('home-');
    old(home, '_.json', current);
    saveChat(home, 'api', chat('c1'));
    saveChat(home, 'web', chat('c2'));
    expect(allChats(home).map((c) => c.title).sort()).toEqual(['Why did the README run fail?', 'c1', 'c2']);
  });
});
