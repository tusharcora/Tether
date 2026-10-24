import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCrew, saveBot } from '../src/crew.js';
import { discardEcc, eccInfo, importEcc, prepareEcc, applyEcc, removeEcc, vendorDir, type Fetch } from '../src/eccImport.js';
import { tmp } from './helpers.js';

const FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;
const copyFetch: Fetch = async (dest) => void cpSync(FIXTURE, dest, { recursive: true });
const ecc = (home: string) => loadCrew(home).filter((b) => b.source?.startsWith('ecc@'));

describe('ECC import', () => {
  it('imports agents as bots and vendors the checkout', async () => {
    const home = tmp('home-');
    const d = await importEcc(home, { fetch: copyFetch });
    expect(d.added.sort()).toEqual(['ecc-planner', 'go-reviewer', 'no-front', 'security-reviewer', 'tdd-guide']);
    expect(d.skills).toBe(1);
    expect(d.commands).toBe(1);
    expect(ecc(home).map((b) => b.id).sort()).toEqual(d.added.sort());
    expect(existsSync(join(vendorDir(home), 'AGENTS.md'))).toBe(true);
    expect(eccInfo(home)).toMatchObject({ ref: 'v2.2.3' });
  });

  it('never touches the user’s own bot with an ECC id, on import and on update', async () => {
    const home = tmp('home-');
    saveBot(home, { id: 'go-reviewer', name: 'My Go', title: 'mine', kind: 'agent', persona: 'mine', look: {} as never });
    await importEcc(home, { fetch: copyFetch });
    const again = await importEcc(home, { fetch: copyFetch });
    expect(loadCrew(home).find((b) => b.id === 'go-reviewer')).toMatchObject({ name: 'My Go', persona: 'mine' });
    expect(loadCrew(home).find((b) => b.id === 'ecc-go-reviewer')?.source).toBe('ecc@v2.2.3');
    expect(again.updated).toContain('ecc-go-reviewer');
    expect(again.added).toEqual([]);
  });

  it('prepare shows the diff before anything is written; removed agents are deleted on apply', async () => {
    const home = tmp('home-');
    await importEcc(home, { fetch: copyFetch });
    saveBot(home, { id: 'old-agent', name: 'Old', title: '', kind: 'agent', persona: '', look: {} as never, source: 'ecc@v2.2.2' });
    const p = await prepareEcc(home, { ref: 'v2.2.4', fetch: copyFetch });
    expect(p.diff.removed).toEqual(['old-agent']);
    expect(loadCrew(home).some((b) => b.id === 'old-agent')).toBe(true);
    applyEcc(home, p);
    expect(loadCrew(home).some((b) => b.id === 'old-agent')).toBe(false);
    expect(ecc(home).every((b) => b.source === 'ecc@v2.2.4')).toBe(true);
  });

  it('imports from a local folder without fetching', async () => {
    const home = tmp('home-');
    const d = await importEcc(home, { from: FIXTURE, fetch: async () => { throw new Error('should not fetch'); } });
    expect(d.added).toHaveLength(5);
    expect(readFileSync(join(vendorDir(home), 'agents', 'planner.md'), 'utf8')).toMatch(/planning/);
  });

  it('a failed fetch writes nothing', async () => {
    const home = tmp('home-');
    await expect(importEcc(home, { fetch: async () => { throw new Error('offline'); } })).rejects.toThrow(/offline/);
    expect(ecc(home)).toEqual([]);
    expect(existsSync(vendorDir(home))).toBe(false);
  });

  it('removes everything it imported and the vendor folder', async () => {
    const home = tmp('home-');
    await importEcc(home, { fetch: copyFetch });
    expect(removeEcc(home)).toHaveLength(5);
    expect(ecc(home)).toEqual([]);
    expect(existsSync(vendorDir(home))).toBe(false);
  });

  it('refuses a ref that is not a version tag before fetching anything', async () => {
    const home = tmp('home-');
    let fetched = 0;
    const fetch: Fetch = async (dest) => {
      fetched++;
      cpSync(FIXTURE, dest, { recursive: true });
    };
    await expect(importEcc(home, { ref: 'feature/x', fetch })).rejects.toThrow(/version tag/);
    expect(fetched).toBe(0);
    expect(existsSync(vendorDir(home))).toBe(false);
  });

  it('skips a second agent whose shortened id duplicates one already in the batch', async () => {
    const home = tmp('home-');
    const src = tmp('ecc-src-');
    cpSync(FIXTURE, src, { recursive: true });
    const long = (n: string) => `---\nname: ${n}\ndescription: long one\n---\nYou are a long-named agent.\n`;
    writeFileSync(join(src, 'agents', 'aaaa-very-long-agent-name-one.md'), long('aaaa-very-long-agent-name-one'));
    writeFileSync(join(src, 'agents', 'aaaa-very-long-agent-name-two.md'), long('aaaa-very-long-agent-name-two'));
    const p = await prepareEcc(home, { from: src });
    expect(p.diff.added).toContain('aaaa-very-long-agent-nam');
    expect(p.diff.added).toHaveLength(6);
    expect(p.diff.skipped).toEqual(['aaaa-very-long-agent-name-two.md: duplicate id "aaaa-very-long-agent-nam"']);
    expect(p.diff.notes).toContain('aaaa-very-long-agent-name-one: id shortened to "aaaa-very-long-agent-nam"');
  });

  it('never overwrites a user bot that loadCrew hides (over the user cap)', async () => {
    const home = tmp('home-');
    for (let i = 0; i < 69; i++) saveBot(home, { id: `u${String(i).padStart(2, '0')}`, name: `a${i}`, title: '', kind: 'agent', persona: '', look: {} as never });
    saveBot(home, { id: 'go-reviewer', name: 'zz', title: 'mine', kind: 'agent', persona: 'mine', look: {} as never });
    expect(loadCrew(home).some((b) => b.id === 'go-reviewer')).toBe(false);
    const file = join(home, 'crew', 'go-reviewer.json');
    const before = readFileSync(file, 'utf8');
    const d = await importEcc(home, { fetch: copyFetch });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(d.added).toContain('ecc-go-reviewer');
    expect(existsSync(join(home, 'crew', 'ecc-go-reviewer.json'))).toBe(true);
  });

  it('skips on apply a user bot made with an ECC id after prepare', async () => {
    const home = tmp('home-');
    const p = await prepareEcc(home, { fetch: copyFetch });
    expect(p.diff.added).toContain('tdd-guide');
    saveBot(home, { id: 'tdd-guide', name: 'My TDD', title: 'mine', kind: 'agent', persona: 'mine', look: {} as never });
    const file = join(home, 'crew', 'tdd-guide.json');
    const before = readFileSync(file, 'utf8');
    const d = applyEcc(home, p);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(d.skipped).toContain('tdd-guide: a bot of yours now has this id; skipped');
    expect(d.added).not.toContain('tdd-guide');
  });

  it('removes the staging folder when prepare fails after the fetch', async () => {
    const home = tmp('home-');
    const fetch: Fetch = async (dest) => {
      cpSync(FIXTURE, dest, { recursive: true });
      mkdirSync(join(dest, 'agents', 'x.md'));
    };
    await expect(prepareEcc(home, { fetch })).rejects.toThrow();
    expect(readdirSync(join(home, 'vendor')).filter((e) => e.startsWith('.ecc-'))).toEqual([]);
  });

  it('discardEcc removes a staged checkout and leaves a --from folder alone', async () => {
    const home = tmp('home-');
    const p = await prepareEcc(home, { fetch: copyFetch });
    expect(existsSync(p.dir)).toBe(true);
    discardEcc(p);
    expect(existsSync(p.dir)).toBe(false);
    expect(ecc(home)).toEqual([]);
    const q = await prepareEcc(home, { from: FIXTURE });
    discardEcc(q);
    expect(existsSync(join(FIXTURE, 'AGENTS.md'))).toBe(true);
  });

  it('refuses --from inside the vendor folder', async () => {
    const home = tmp('home-');
    await importEcc(home, { fetch: copyFetch });
    await expect(prepareEcc(home, { from: vendorDir(home) })).rejects.toThrow(/inside the vendor folder/);
    await expect(prepareEcc(home, { from: join(home, 'vendor') })).rejects.toThrow(/inside the vendor folder/);
    expect(existsSync(join(vendorDir(home), 'AGENTS.md'))).toBe(true);
  });
});
