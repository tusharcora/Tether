import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractLinks, neutralizeLinks, parseNote, Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

describe('vault', () => {
  it('extracts wikilinks, ignoring aliases, headings and code', () => {
    const body = 'See [[Alpha]] and [[Beta|the beta]] and [[Gamma#Section]].\n```\n[[NotALink]]\n```\n`[[Inline]]`';
    expect(extractLinks(body)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('parses frontmatter tags and type, tolerating malformed yaml', () => {
    const n = parseNote('a/B.md', '---\ntype: run\ntags: [x, y]\n---\nbody [[C]]');
    expect(n.type).toBe('run');
    expect(n.tags).toEqual(['x', 'y']);
    expect(n.title).toBe('B');
    expect(parseNote('c.md', '---\n: : bad\n---\ntext').body).toContain('text');
  });

  it('resolves links Obsidian-style, builds backlinks, and ranks with a graph boost', async () => {
    const v = new Vault(tmp('vault-'));
    await v.writeNote('Concepts/Rate Limiting.md', '# Rate limiting\nToken bucket per API key. See [[Orders API]].');
    await v.writeNote('Services/Orders API.md', '# Orders API\nPOST /orders creates an order.');
    await v.writeNote('Misc/Lunch.md', 'sandwiches only');
    const g = await v.graph();
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toEqual([{ from: 'Concepts/Rate Limiting.md', to: 'Services/Orders API.md' }]);
    expect(await v.backlinks('Services/Orders API.md')).toEqual(['Concepts/Rate Limiting.md']);

    const hits = await v.search('add rate limiting to the orders endpoint');
    expect(hits[0]!.note.title).toBe('Rate Limiting');
    expect(hits.map((h) => h.note.title)).toContain('Orders API');
    expect(hits.map((h) => h.note.title)).not.toContain('Lunch');

    const ctx = await v.contextFor('rate limiting orders');
    expect(ctx).toContain('[[Concepts/Rate Limiting]]');
    expect(ctx.length).toBeLessThanOrEqual(6000);
  });

  it('resolves links to notes whose names contain an extension, and counts unresolved links once', async () => {
    const v = new Vault(tmp('vault-'));
    await v.writeNote('Files/README.md.md', 'readme notes');
    await v.writeNote('A.md', 'see [[Files/README.md]] and [[Ghost]] and [[Ghost]]');
    const g = await v.graph();
    expect(g.edges).toEqual([{ from: 'A.md', to: 'Files/README.md.md' }]);
    expect(g.unresolved).toBe(1);
  });

  it('never retrieves untouched stub notes, but does once a person writes in them', async () => {
    const v = new Vault(tmp('vault-'));
    await v.writeNote('Roles/coder.md', '---\ntype: role\ntags: [aorch/role]\n---\n# coder\n\nAdd standing guidance for this role here; it is retrieved as context for future runs.\n');
    expect(await v.contextFor('coder guidance standing role')).toBe('');
    await v.writeNote('Roles/coder.md', '---\ntype: role\n---\n# coder\n\nAlways write table-driven tests for coder tasks.\n');
    expect(await v.contextFor('coder tests')).toContain('table-driven');
  });

  it('never writes outside the vault', async () => {
    const root = tmp('vault-');
    const v = new Vault(root);
    await v.writeNote('../../escape.md', 'x');
    expect(await v.read('../../escape.md')).toBeDefined(); // sanitised into the vault, not outside it
    const g = await v.graph();
    expect(g.nodes.every((n) => !n.id.includes('..'))).toBe(true);
  });

  it('neutralises links so agent output cannot add edges to the graph', () => {
    expect(extractLinks(neutralizeLinks('evil [[Secrets/Keys]]'))).toEqual([]);
  });

  it('records a run as cross-linked notes and feeds them back as context on the next run', async () => {
    const vault = new Vault(tmp('vault-'));
    const { engine } = setup(vault);
    const p = pipe(
      [
        { id: 'plan', role: 'planner', readOnly: true, mock: { output: 'Use a token bucket. [[Injected]]' } },
        { id: 'code', role: 'coder', mock: { writeFile: { path: 'src/limiter.ts', content: 'export {}\n' } } },
        { id: 'tests', kind: 'gate', command: 'test -f src/limiter.ts' },
      ],
      [['plan', 'code'], ['code', 'tests']],
    );
    const repo = makeRepo();
    const id = await engine.start({ pipeline: p, task: 'Add rate limiting limiter', repo });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');

    const g = await vault.graph();
    const titles = g.nodes.map((n) => n.id);
    expect(titles).toContain('Pipelines/test.md');
    expect(titles).toContain('Roles/coder.md');
    expect(titles).toContain('Files/src/limiter.ts.md');
    expect(titles.some((t) => t.startsWith('Runs/'))).toBe(true);
    const run = g.nodes.find((n) => n.id.startsWith('Runs/'))!;
    const outgoing = g.edges.filter((e) => e.from === run.id).map((e) => e.to);
    expect(outgoing).toEqual(expect.arrayContaining(['Pipelines/test.md', 'Roles/coder.md', 'Files/src/limiter.ts.md']));
    expect(titles).not.toContain('Injected.md'); // agent-minted link was neutralised
    expect(readFileSync(join(vault.root, run.id), 'utf8')).toContain('[ [Injected] ]');

    // a later run on a related task gets the earlier run as context
    const { engine: e2, mock: m2 } = setup(vault);
    const id2 = await e2.start({ pipeline: pipe([{ id: 'plan', role: 'planner', readOnly: true }], []), task: 'rate limiting limiter follow-up', repo });
    await e2.wait(id2);
    expect(m2.calls[0]!.prompt).toContain('Knowledge graph context');
    expect(m2.calls[0]!.prompt).toContain('token bucket');
  });
});
