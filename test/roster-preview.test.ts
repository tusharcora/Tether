import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILTIN_BOTS, BUILTIN_IDS, loadCrew, saveBot, type BotDef } from '../src/crew.js';
import type { RosterEntry } from '../src/roster.js';
import { clearLanguageCache, rankPreview, taskKeywords, workspaceLanguages } from '../src/rosterPreview.js';
import { startHttpTestServer } from './http-helpers.js';
import { makeRepo } from './helpers.js';

const look = BUILTIN_BOTS[0]!.look;
const ecc = (id: string, when: string): BotDef => ({ id, name: id.replace(/-/g, ' '), title: id, kind: 'verdict', persona: '', look, source: 'ecc@v2.2.3', whenToUse: when });
const entry = (id: string, when = '', builtin = false): RosterEntry => ({ id, kind: 'agent', readOnly: true, when, builtin });

describe('ranking', () => {
  it('scores language, domain and keywords, drops zeros, keeps roster order on ties and returns three', () => {
    // rag: domain +3, "retriever" +1 = 4; go-reviewer: language +3; a/b/c-bot: keyword +1 each (roster order wins the tie)
    const entries = [entry('planner', 'plans', true), entry('go-reviewer', 'Reviews Go code'), entry('rag-pipeline-reviewer', 'Reviews retriever pipelines'), entry('docs-writer', 'Writes documentation'), entry('a-bot', 'retriever tuning'), entry('b-bot', 'retriever tuning'), entry('c-bot', 'retriever tuning')];
    const bots = rankPreview(entries, { task: 'fix the RAG retriever', langs: new Set(['go']), names: { 'rag-pipeline-reviewer': 'Rag reviewer' } });
    expect(bots.map((b) => b.id)).toEqual(['rag-pipeline-reviewer', 'go-reviewer', 'a-bot']);
    expect(bots[0]).toEqual({ id: 'rag-pipeline-reviewer', name: 'Rag reviewer', why: 'Reviews retriever pipelines' });
    expect(bots.some((b) => b.id === 'planner' || b.id === 'docs-writer')).toBe(false);
  });

  it('counts a routing rule that names the bot', () => {
    const bots = rankPreview([entry('ecc-security-reviewer', 'Security review')], { task: 'harden the login endpoint', langs: new Set(), names: {}, routing: { table: [], rules: [{ when: 'login and auth changes', agents: ['security-reviewer'] }] } });
    expect(bots.map((b) => b.id)).toEqual(['ecc-security-reviewer']);
  });

  it('cuts why to 80 characters and keeps only meaningful keywords', () => {
    expect(rankPreview([entry('x-bot', `retriever ${'y'.repeat(100)}`)], { task: 'retriever', langs: new Set(), names: {} })[0]!.why).toHaveLength(80);
    // words of 4+ letters, once each; "with" is a stop word and "fix" is too short
    expect(taskKeywords('Fix the flaky login test with care, care')).toEqual(['flaky', 'login', 'test', 'care']);
  });
});

describe('language cache', () => {
  afterEach(() => vi.useRealTimers());

  it('scans a workspace once per 60 seconds', () => {
    clearLanguageCache();
    const dir = makeRepo();
    vi.useFakeTimers({ now: 0 });
    expect(workspaceLanguages('w', dir).size).toBe(0);
    writeFileSync(join(dir, 'go.mod'), 'module x\n');
    vi.advanceTimersByTime(59_000);
    expect(workspaceLanguages('w', dir).size).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect([...workspaceLanguages('w', dir)]).toEqual(['go']);
  });

  it('rescans when a workspace id is re-registered with a new path', () => {
    clearLanguageCache();
    const a = makeRepo();
    const b = makeRepo();
    writeFileSync(join(b, 'go.mod'), 'module x\n');
    expect(workspaceLanguages('w', a).size).toBe(0);
    expect([...workspaceLanguages('w', b)]).toEqual(['go']);
  });
});

describe('GET /api/roster/preview', () => {
  let srv: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    srv = await startHttpTestServer();
    saveBot(srv.home, ecc('rag-pipeline-reviewer', 'Reviews retrieval and embedding pipelines'));
    saveBot(srv.home, ecc('seo-specialist', 'Improves search ranking of landing pages'));
    expect(loadCrew(srv.home).filter((b) => b.source).map((b) => b.id).sort()).toEqual(['rag-pipeline-reviewer', 'seo-specialist']);
  });
  afterAll(() => srv.close());
  const preview = (task: string, ws = 'api') => srv.api('GET', `/api/roster/preview?task=${encodeURIComponent(task)}&ws=${ws}`);

  it('picks different specialists for different tasks on the same workspace, never a built-in', async () => {
    const calls = srv.mock.calls.length;
    const rag = await preview('fix the RAG retriever');
    expect(rag.status).toBe(200);
    expect(rag.json.bots.map((b: { id: string }) => b.id)).toEqual(['rag-pipeline-reviewer']);
    const seo = await preview('improve SEO for the landing pages');
    expect(seo.json.bots.map((b: { id: string }) => b.id)).toEqual(['seo-specialist']);
    for (const r of [rag, seo]) {
      expect(r.json.bots.some((b: { id: string }) => BUILTIN_IDS.has(b.id))).toBe(false);
      expect(r.json.core).toEqual(expect.arrayContaining(['planner', 'coder', 'reviewer']));
    }
    expect(srv.mock.calls.length).toBe(calls); // no model call
  });

  it('answers built-ins only for an unknown workspace', async () => {
    const r = await preview('fix the RAG retriever', 'nope');
    expect(r.status).toBe(200);
    expect(r.json.bots).toEqual([]);
    expect(r.json.core.length).toBeGreaterThan(0);
  });

  it('refuses a task over 2000 characters', async () => {
    const r = await preview('x'.repeat(2001));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/too long/);
  });
});
