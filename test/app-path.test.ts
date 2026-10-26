import { describe, expect, it } from 'vitest';
import { fallbackDirs, loginPath, mergePaths, PRINT_PATH, shellPath } from '../src/app/path.js';

describe('the login-shell PATH merge', () => {
  it('reads the PATH between the markers, ignoring whatever the shell printed around it', () => {
    expect(loginPath('Welcome back!\n__TETHER_PATH__/opt/homebrew/bin:/usr/bin__TETHER_PATH__\n% ')).toBe('/opt/homebrew/bin:/usr/bin');
    expect(loginPath('no markers here')).toBeUndefined();
    expect(loginPath('__TETHER_PATH____TETHER_PATH__')).toBeUndefined();
  });

  it('puts the login PATH first, keeps the current entries after it, each folder once', () => {
    expect(mergePaths('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin::/usr/sbin', '/Users/me')).toBe('/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin');
  });

  it('falls back to the usual CLI folders when the shell gave nothing', () => {
    expect(fallbackDirs('/Users/me')).toEqual(['/opt/homebrew/bin', '/usr/local/bin', '/Users/me/.local/bin', '/Users/me/.npm-global/bin']);
    expect(mergePaths(undefined, '/usr/bin:/bin', '/Users/me')).toBe('/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin:/Users/me/.npm-global/bin:/usr/bin:/bin');
  });

  it('asks a real shell and survives one that fails', async () => {
    const env = { PATH: '/usr/bin:/bin', HOME: '/Users/me', SHELL: '/bin/sh' };
    expect(PRINT_PATH).toContain('"$PATH"');
    expect((await shellPath(env, '/Users/me')).split(':')).toContain('/usr/bin');
    expect(await shellPath({ ...env, SHELL: '/nonexistent/shell' }, '/Users/me')).toBe(mergePaths(undefined, '/usr/bin:/bin', '/Users/me'));
  });
});
