import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitArtifacts, wordCount } from '../src/assistant/artifactBlocks.js';
import { artifactsDir, deleteArtifact, listArtifacts, readArtifact, saveArtifact } from '../src/assistant/artifacts.js';
import { checkReply } from '../src/assistant/reply.js';
import { Store } from '../src/store.js';
import { tmp } from './helpers.js';

const PAGE = '<!doctype html>\n<html><body><h1>Hi</h1>\n```js\nnot a fence\n```\n</body></html>';

describe('artifact blocks in a reply', () => {
  it('cuts each artifact out of the text, keeping its raw content, title, kind and id', () => {
    const r = splitArtifacts(`Here is the page.\n<artifact title="Landing &amp; pricing" kind="html">\n${PAGE}\n</artifact>\nAnd the notes:\n<artifact id="notes" title="Notes" kind="markdown">\n# Notes\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n</artifact>\nDone.`);
    expect(r.text).toBe('Here is the page.\n\nAnd the notes:\n\nDone.');
    expect(r.artifacts).toEqual([
      { title: 'Landing & pricing', kind: 'html', content: PAGE },
      { id: 'notes', title: 'Notes', kind: 'markdown', content: '# Notes\n\n```ts\nconst a = 1;\n```' },
    ]);
  });

  it('reads a streaming reply: an unclosed artifact is open and runs to the end; a half-written tag is held back', () => {
    const r = splitArtifacts('Writing it.\n<artifact title="Plan" kind="markdown">\n# Plan\n\nstep one and two');
    expect(r.text).toBe('Writing it.\n');
    expect(r.artifacts).toEqual([{ title: 'Plan', kind: 'markdown', content: '# Plan\n\nstep one and two', open: true }]);
    expect(wordCount(r.artifacts[0]!.content)).toBe(6);
    expect(splitArtifacts('Writing it.\n<artif').text).toBe('Writing it.\n');
    expect(splitArtifacts('Writing it.\n<artifact title="Pl').text).toBe('Writing it.\n');
    // an unclosed one stops at the tether block
    const cut = splitArtifacts('x\n<artifact title="T">\n# T\n```tether\n{"sources":[]}\n```');
    expect(cut.artifacts[0]!.content).toBe('# T');
    expect(cut.text).toBe('x\n```tether\n{"sources":[]}\n```');
    // plain text with < stays
    expect(splitArtifacts('a < b and <b>bold</b>').text).toBe('a < b and <b>bold</b>');
  });

  it('unwraps a fence around the page, guesses a missing kind, and names an untitled one', () => {
    expect(splitArtifacts('<artifact title="P">\n```html\n<p>x</p>\n```\n</artifact>').artifacts[0]).toEqual({ title: 'P', kind: 'html', content: '<p>x</p>' });
    expect(splitArtifacts('<artifact>\n# Doc\n</artifact>').artifacts[0]).toEqual({ title: 'Untitled', kind: 'markdown', content: '# Doc' });
  });

  it('checkReply keeps the artifacts apart from the text and the tether block, at most three, none empty', async () => {
    const store = Store.open(':memory:');
    const four = [1, 2, 3, 4].map((n) => `<artifact title="A${n}" kind="markdown">\n# ${n}\n</artifact>`).join('\n');
    const c = await checkReply(`Made them.\n${four}\n<artifact title="Empty"></artifact>\n\`\`\`tether\n{"sources":[]}\n\`\`\``, { home: tmp('home-'), store });
    expect(c.text).toBe('Made them.');
    expect(c.artifacts.map((a) => a.title)).toEqual(['A1', 'A2', 'A3']);
  });
});

describe('the artifacts folder', () => {
  it('lives in the project at .aorch/artifacts, or in Tether’s home with no project', () => {
    const home = tmp('home-');
    const root = tmp('proj-');
    expect(artifactsDir(home, root)).toBe(join(root, '.aorch', 'artifacts'));
    expect(artifactsDir(home)).toBe(join(home, 'artifacts'));
  });

  it('saves a version per write: an id it has makes v2, an unknown id a new artifact slugged from the title', () => {
    const dir = artifactsDir(tmp('home-'), tmp('proj-'));
    const a = saveArtifact(dir, { title: 'Landing page!', kind: 'html', content: PAGE }, 'c1', 1000);
    expect(a).toEqual({ id: 'landing-page', version: 1, title: 'Landing page!', kind: 'html' });
    expect(readFileSync(join(dir, 'landing-page', 'v1.html'), 'utf8')).toBe(PAGE);
    const b = saveArtifact(dir, { id: 'landing-page', title: 'Landing page', kind: 'html', content: '<p>v2</p>' }, 'c2', 2000);
    expect(b.version).toBe(2);
    const v = readArtifact(dir, 'landing-page');
    expect(v.version).toBe(2);
    expect(v.content).toBe('<p>v2</p>');
    // the chat that made it stays its owner
    expect(v.meta).toMatchObject({ id: 'landing-page', chatId: 'c1', createdAt: 1000, updatedAt: 2000, versions: [{ n: 1, file: 'v1.html', bytes: PAGE.length }, { n: 2, file: 'v2.html' }] });
    expect(readArtifact(dir, 'landing-page', 1).content).toBe(PAGE);
    expect(saveArtifact(dir, { id: 'nope', title: 'Landing page', kind: 'markdown', content: '# x y' }).id).toBe('landing-page-2');
    expect(readArtifact(dir, 'landing-page-2').meta.versions[0]).toMatchObject({ file: 'v1.md', words: 3 });
    expect(listArtifacts(dir).map((m) => m.id)).toEqual(['landing-page-2', 'landing-page']);
    expect(deleteArtifact(dir, 'landing-page')).toBe(true);
    expect(deleteArtifact(dir, 'landing-page')).toBe(false);
    expect(listArtifacts(dir).map((m) => m.id)).toEqual(['landing-page-2']);
  });

  it('refuses ids that could leave the folder, and empty or oversized content', () => {
    const dir = artifactsDir(tmp('home-'), tmp('proj-'));
    for (const id of ['../x', '..', 'a/b', '.aorch', 'A', '', 'a'.repeat(65)]) {
      expect(() => readArtifact(dir, id)).toThrow(/not an artifact id/);
      expect(() => deleteArtifact(dir, id)).toThrow(/not an artifact id/);
    }
    expect(() => readArtifact(dir, 'missing')).toThrow(/no such artifact/);
    expect(() => saveArtifact(dir, { title: 'x', kind: 'markdown', content: '  ' })).toThrow(/empty/);
    expect(() => saveArtifact(dir, { title: 'x', kind: 'markdown', content: 'a'.repeat(500_001) })).toThrow(/too large/);
    // an id from the reply that is not a slug is ignored: a new artifact
    expect(saveArtifact(dir, { id: '../../etc', title: 'Safe', kind: 'markdown', content: '# ok' }).id).toBe('safe');
  });

  it('refuses a symlinked .aorch, artifacts folder, artifact folder or version file', () => {
    const home = tmp('home-');
    const outside = tmp('outside-');
    const linked = tmp('proj-');
    symlinkSync(outside, join(linked, '.aorch'));
    expect(() => artifactsDir(home, linked)).toThrow(/symlinked/);
    const p2 = tmp('proj-');
    mkdirSync(join(p2, '.aorch'));
    symlinkSync(outside, join(p2, '.aorch', 'artifacts'));
    expect(() => artifactsDir(home, p2)).toThrow(/symlinked/);
    const dir = artifactsDir(home, tmp('proj-'));
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(outside, 'evil'));
    writeFileSync(join(outside, 'evil', 'meta.json'), JSON.stringify({ title: 'x', kind: 'markdown', createdAt: 1, updatedAt: 1, versions: [{ n: 1, at: 1, file: 'v1.md' }] }));
    writeFileSync(join(outside, 'evil', 'v1.md'), 'secret');
    symlinkSync(join(outside, 'evil'), join(dir, 'evil'));
    expect(() => readArtifact(dir, 'evil')).toThrow(/symlink/);
    expect(() => deleteArtifact(dir, 'evil')).toThrow(/symlink/);
    expect(listArtifacts(dir)).toEqual([]);
    expect(existsSync(join(outside, 'evil', 'v1.md'))).toBe(true);
    // a version file that is a link
    saveArtifact(dir, { title: 'Doc', kind: 'markdown', content: '# a' });
    symlinkSync(join(outside, 'evil', 'v1.md'), join(dir, 'doc', 'v2.md'));
    expect(() => saveArtifact(dir, { id: 'doc', title: 'Doc', kind: 'markdown', content: '# b' })).toThrow(/symlink/);
    expect(readFileSync(join(outside, 'evil', 'v1.md'), 'utf8')).toBe('secret');
  });

  it('skips a broken meta.json and a version file name that is not its own', () => {
    const dir = artifactsDir(tmp('home-'), tmp('proj-'));
    mkdirSync(join(dir, 'bad'), { recursive: true });
    writeFileSync(join(dir, 'bad', 'meta.json'), '{nope');
    mkdirSync(join(dir, 'odd'));
    writeFileSync(join(dir, 'odd', 'meta.json'), JSON.stringify({ title: 'x', kind: 'html', createdAt: 1, updatedAt: 1, versions: [{ n: 1, at: 1, file: '../../secret.html' }] }));
    expect(listArtifacts(dir)).toEqual([]);
    expect(() => readArtifact(dir, 'odd')).toThrow(/no such artifact/);
  });
});
