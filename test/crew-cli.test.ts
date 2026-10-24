import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmp } from './helpers.js';

const root = new URL('..', import.meta.url).pathname;
const tsx = join(root, 'node_modules/.bin/tsx');
const FIXTURE = join(root, 'test/fixtures/ecc');
function aorch(h: string, ...args: string[]) {
  const r = spawnSync(tsx, [join(root, 'src/cli.ts'), ...args, '--home', h], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', AORCH_NO_ANIMATION: '1' }, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('aorch crew', () => {
  it('imports ECC from a local folder, lists by source, and removes it', () => {
    const h = tmp('cli-home-');
    const imp = aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--yes');
    expect(imp.code).toBe(0);
    expect(imp.out).toMatch(/5 added/);
    const list = aorch(h, 'crew', 'list', '--source', 'ecc', '--json');
    expect(JSON.parse(list.out).map((b: { id: string }) => b.id).sort()).toEqual(['ecc-planner', 'go-reviewer', 'no-front', 'security-reviewer', 'tdd-guide']);
    const rm = aorch(h, 'crew', 'remove', '--source', 'ecc', '--yes');
    expect(rm.code).toBe(0);
    expect(JSON.parse(aorch(h, 'crew', 'list', '--source', 'ecc', '--json').out)).toEqual([]);
  });

  it('refuses unknown sources and keeps the old notice for bare `crew`', () => {
    const h = tmp('cli-home-');
    expect(aorch(h, 'crew', 'import', 'other').code).toBe(2);
    const bare = aorch(h, 'crew');
    expect(bare.code).toBe(0);
    expect(bare.err).toMatch(/moved to the web dashboard/);
  });

  it('a flag before the sub-command still reaches it', () => {
    const h = tmp('cli-home-');
    const r = aorch(h, 'crew', '--json', 'list', '--source', 'ecc');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual([]);
    expect(r.err).not.toMatch(/moved to the web dashboard/);
  });

  it('aorch skills lists imported ECC skills and commands with their kind', () => {
    const h = tmp('cli-home-');
    aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--yes');
    const r = aorch(h, 'skills', '--source', 'ecc', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).map((s: { name: string; kind: string }) => [s.name, s.kind])).toEqual([['tdd-workflow', 'skill'], ['plan', 'command']]);
  });

  it('--update without --yes and without a terminal prints the diff and changes nothing', () => {
    const h = tmp('cli-home-');
    aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--yes');
    const up = aorch(h, 'crew', 'import', 'ecc', '--from', FIXTURE, '--update');
    expect(up.code).toBe(2);
    expect(up.out).toMatch(/5 updated/);
  });
});
