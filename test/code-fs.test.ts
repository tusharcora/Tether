import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isSecretPath, langOf, listDir, readCode, resolveInWorkspace } from '../src/code.js';
import { HttpError } from '../src/serverkit.js';
import { initWorkspace } from '../src/workspace.js';
import { enc, startHttpTestServer } from './http-helpers.js';
import { makeRepo, tmp } from './helpers.js';

const refusal = (fn: () => unknown): number | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
  return undefined;
};
const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });

/** A repo with an ignored folder, an untracked file, a modified, a staged and a deleted file. */
function fixture(): string {
  const dir = makeRepo();
  mkdirSync(join(dir, 'src', 'http'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n*.log\n');
  writeFileSync(join(dir, 'src', 'http', 'limit.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src', 'gone.ts'), 'x\n');
  writeFileSync(join(dir, 'package.json'), '{}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'files');
  writeFileSync(join(dir, 'src', 'http', 'limit.ts'), 'export const a = 2;\n');
  writeFileSync(join(dir, 'src', 'new.ts'), 'n\n');
  git(dir, 'add', 'src/new.ts');
  unlinkSync(join(dir, 'src', 'gone.ts'));
  writeFileSync(join(dir, 'notes.txt'), 'untracked\n');
  writeFileSync(join(dir, 'debug.log'), 'ignored\n');
  mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'x', 'i.js'), '');
  return dir;
}

describe('resolveInWorkspace: one gate for every code path', () => {
  const root = realpathSync(makeRepo());
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), '');
  const outside = realpathSync(tmp('outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'no');
  symlinkSync(outside, join(root, 'escape'));
  symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'));
  symlinkSync(join(root, 'src'), join(root, 'inner'));

  it('refuses a NUL byte, an absolute path and any `..`', () => {
    expect(refusal(() => resolveInWorkspace(root, 'src/a.ts\0.png'))).toBe(400);
    expect(refusal(() => resolveInWorkspace(root, '/etc/passwd'))).toBe(400);
    expect(refusal(() => resolveInWorkspace(root, '../x'))).toBe(400);
    expect(refusal(() => resolveInWorkspace(root, 'src/../../x'))).toBe(400);
    expect(refusal(() => resolveInWorkspace(root, 'src/../a'))).toBe(400);
  });
  it('refuses anything inside .git, at any depth', () => {
    expect(refusal(() => resolveInWorkspace(root, '.git/config'))).toBe(403);
    expect(refusal(() => resolveInWorkspace(root, '.git'))).toBe(403);
    expect(refusal(() => resolveInWorkspace(root, 'vendor/lib/.git/HEAD'))).toBe(403);
  });
  it('refuses symlinks that lead outside, for folders and files, existing or not', () => {
    expect(refusal(() => resolveInWorkspace(root, 'escape'))).toBe(403);
    expect(refusal(() => resolveInWorkspace(root, 'escape/secret.txt'))).toBe(403);
    expect(refusal(() => resolveInWorkspace(root, 'escape/new.txt'))).toBe(403);
    expect(refusal(() => resolveInWorkspace(root, 'escape.txt'))).toBe(403);
  });
  it('allows symlinks that stay inside, the root itself and plain paths', () => {
    expect(resolveInWorkspace(root, 'inner/a.ts')).toEqual({ abs: join(root, 'src', 'a.ts'), rel: 'src/a.ts' });
    expect(resolveInWorkspace(root, '')).toEqual({ abs: root, rel: '' });
    expect(resolveInWorkspace(root, './src//a.ts').rel).toBe('src/a.ts');
  });
});

describe('secrets and languages', () => {
  it('knows secrets files by name', () => {
    for (const p of ['.env', 'api/.env.local', 'certs/server.pem', 'tls.key', '.ssh/id_ed25519', 'id_rsa.pub']) expect(isSecretPath(p), p).toBe(true);
    for (const p of ['env.ts', 'src/environment.ts', 'keys.ts', 'idea.md', 'monkey.json']) expect(isSecretPath(p), p).toBe(false);
  });
  it('names the language CodeMirror should use', () => {
    expect([langOf('a.ts'), langOf('a.tsx'), langOf('a.mjs'), langOf('a.json'), langOf('README.md'), langOf('a.css'), langOf('a.html'), langOf('a.py'), langOf('Makefile')]).toEqual(['typescript', 'tsx', 'javascript', 'json', 'markdown', 'css', 'html', 'python', 'text']);
  });
});

describe('listDir', () => {
  it('lists one level, dirs first, with git badges, hiding .git and ignored files', async () => {
    const dir = fixture();
    const top = await listDir(realpathSync(dir), '');
    expect(top.git).toBe(true);
    expect(top.entries.map((e) => [e.name, e.kind, e.git ?? ''])).toEqual([
      ['src', 'dir', ''],
      ['.gitignore', 'file', ''],
      ['notes.txt', 'file', '?'],
      ['package.json', 'file', ''],
      ['README.md', 'file', ''],
    ]);
    expect(top.files).toBe(7);
    const src = await listDir(realpathSync(dir), 'src');
    expect(src.entries.map((e) => [e.path, e.kind, e.git ?? ''])).toEqual([
      ['src/http', 'dir', ''],
      ['src/gone.ts', 'file', 'D'],
      ['src/new.ts', 'file', 'A'],
    ]);
    expect((await listDir(realpathSync(dir), 'src/http')).entries).toEqual([{ name: 'limit.ts', path: 'src/http/limit.ts', kind: 'file', git: 'M' }]);
  });

  it('works in a folder that is not a git repo, without badges, still hiding .git', async () => {
    const dir = realpathSync(tmp('plain-'));
    mkdirSync(join(dir, 'lib'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, 'a.txt'), '');
    const r = await listDir(dir, '');
    expect(r.git).toBe(false);
    expect(r.entries).toEqual([
      { name: 'lib', path: 'lib', kind: 'dir' },
      { name: 'a.txt', path: 'a.txt', kind: 'file' },
    ]);
  });

  it('lists a project that is a subfolder of a repo with paths relative to the project', async () => {
    const dir = fixture();
    const r = await listDir(realpathSync(join(dir, 'src')), '');
    expect(r.entries.map((e) => [e.path, e.git ?? ''])).toEqual([
      ['http', ''],
      ['gone.ts', 'D'],
      ['new.ts', 'A'],
    ]);
  });
});

describe('readCode', () => {
  const root = realpathSync(tmp('read-'));
  writeFileSync(join(root, 'a.ts'), 'const a = 1;\n');
  writeFileSync(join(root, 'big.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
  writeFileSync(join(root, 'img.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
  writeFileSync(join(root, '.env'), 'KEY=1\n');
  writeFileSync(join(root, 'locked.ts'), 'x');
  chmodSync(join(root, 'locked.ts'), 0o444);

  it('reads text with its size, mtime and language', () => {
    const f = readCode(root, 'a.ts');
    expect(f).toMatchObject({ path: 'a.ts', text: 'const a = 1;\n', size: 13, lang: 'typescript' });
    expect(typeof f.mtimeMs).toBe('number');
    expect(f.readOnly).toBeUndefined();
  });
  it('sends no text for a file over 2 MB or a binary one', () => {
    expect(readCode(root, 'big.txt')).toMatchObject({ tooLarge: true, text: '' });
    expect(readCode(root, 'img.png')).toMatchObject({ binary: true, text: '' });
  });
  it('opens secrets and files it cannot write read-only', () => {
    expect(readCode(root, '.env')).toMatchObject({ secret: true, readOnly: true, text: 'KEY=1\n' });
    expect(readCode(root, 'locked.ts')).toMatchObject({ readOnly: true });
  });
  it('says 404 for a missing file and 400 for a folder', () => {
    expect(refusal(() => readCode(root, 'nope.ts'))).toBe(404);
    mkdirSync(join(root, 'd'), { recursive: true });
    expect(refusal(() => readCode(root, 'd'))).toBe(400);
  });
});

describe('the code routes', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('serve the tree and files of a registered workspace, by id', async () => {
    const s = await startHttpTestServer({ register: false });
    close = s.close;
    const dir = fixture();
    initWorkspace(s.home, dir, { id: 'shop', write: false });
    const tree = await s.api('GET', '/api/code/tree?ws=shop&dir=src');
    expect(tree.status).toBe(200);
    expect(tree.json.entries.map((e: { name: string }) => e.name)).toEqual(['http', 'gone.ts', 'new.ts']);
    const file = await s.api('GET', `/api/code/file?ws=shop&path=${enc('src/http/limit.ts')}`);
    expect(file.json).toMatchObject({ path: 'src/http/limit.ts', text: 'export const a = 2;\n', lang: 'typescript' });
  });

  it('refuse unknown workspaces, missing ids and unsafe paths', async () => {
    const s = await startHttpTestServer();
    close = s.close;
    expect((await s.api('GET', '/api/code/tree?ws=nope')).status).toBe(404);
    expect((await s.api('GET', '/api/code/tree')).status).toBe(400);
    expect((await s.api('GET', `/api/code/file?ws=api&path=${enc('../etc/passwd')}`)).status).toBe(400);
    expect((await s.api('GET', `/api/code/file?ws=api&path=${enc('.git/config')}`)).status).toBe(403);
    expect((await s.api('GET', `/api/code/tree?ws=api&dir=${enc('/etc')}`)).status).toBe(400);
  });
});
