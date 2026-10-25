import { describe, expect, it } from 'vitest';
import { fileStats } from './fileStats';

describe('fileStats', () => {
  it('counts added and removed lines per file, ignoring headers', () => {
    const diff = ['diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,3 @@', '+one', '+two', '-three', ' same', 'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md', '-gone'].join('\n');
    expect(fileStats(diff)).toEqual([{ file: 'src/a.ts', add: 2, del: 1 }, { file: 'README.md', add: 0, del: 1 }]);
    expect(fileStats('')).toEqual([]);
  });
});
