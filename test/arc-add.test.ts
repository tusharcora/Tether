import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script without types
import { itemUrl, targetPath } from '../scripts/arc-add.mjs';

describe('arc-add', () => {
  it('maps registry targets under the arc folder', () => {
    expect(targetPath('/r', '@components/arc/tabs/tabs.tsx')).toBe(join('/r', 'tabs/tabs.tsx'));
    expect(targetPath('/r', '@components/arc/lib/motion-tokens.ts')).toBe(join('/r', 'lib/motion-tokens.ts'));
  });
  it('refuses targets outside the arc folder', () => {
    expect(() => targetPath('/r', '@components/arc/../../etc/x')).toThrow(/unsafe/);
    expect(() => targetPath('/r', '@components/other/x.tsx')).toThrow(/unexpected/);
  });
  it('builds item urls', () => {
    expect(itemUrl('tabs')).toBe('https://uiarc.dev/r/tabs.json');
    expect(itemUrl('https://uiarc.dev/r/button.json')).toBe('https://uiarc.dev/r/button.json');
  });
});
