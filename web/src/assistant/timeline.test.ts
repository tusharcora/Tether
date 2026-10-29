import { describe, expect, it } from 'vitest';
import type { ToolRun } from './api';
import { searchLinks, stepOf, thinkingSummary, timeline, webCall } from './timeline';

let n = 0;
const run = (code: string, o: Partial<ToolRun> = {}): ToolRun => ({ id: `t${++n}`, code, output: 'ok', ms: 12, ...o });

describe('stepOf: a script becomes a step with a label from what it called', () => {
  it.each([
    ['const r = await tether.runs.get("R-7D92"); return r;', 'Opened run R-7D92'],
    ['return Promise.all([tether.runs.get("R-1"), tether.runs.get(\'R-2\')]);', 'Opened 2 runs'],
    ['return await tether.runs.list();', 'Listed recent runs'],
    ['const a = await repo.read("src/assistant/turn.ts"); const b = await repo.read(`web/src/App.tsx`, { from: 1, to: 40 }); return a + b;', 'Read 2 files'],
    ['for (const f of files) out.push(await repo.read(f)); return out;', 'Read files'],
    ['return repo.search("history.ts", { max: 20 });', 'Searched the codebase for "history.ts"'],
    ['return repo.search(q);', 'Searched the codebase'],
    ['return repo.list("src");', 'Looked through the folders'],
    ['return repo.diff();', 'Looked at the uncommitted changes'],
    ['return tether.vault.search("limits");', 'Searched the notes'],
    ['return tether.vault.read("Notes/limits.md");', 'Read 1 note'],
    ['return [await github.prs("o/r"), await github.checks("o/r", 4)];', 'Checked GitHub: prs, checks'],
    ['return mcp.linear.issues({});', 'Used linear'],
    ['return http.get("https://x.dev");', 'Called a web API'],
    ['http.search("vitest 5")', 'Searched the web for "vitest 5"'],
    ['return codemode.describe("repo");', 'Looked up the tools'],
    ['return 1 + 1;', 'Ran a script'],
  ])('%s → %s', (code, label) => {
    expect(stepOf(run(code)).label).toBe(label);
  });

  it('turns the files, runs, notes and connectors it touched into chips', () => {
    const s = stepOf(run('await repo.read("src/assistant/turn.ts"); await tether.runs.get("R-7D92"); await tether.vault.read("Notes/limits.md"); await github.pr("o/r", 4);'));
    expect(s.chips).toEqual([
      { kind: 'file', label: 'turn.ts', mark: 'TS', title: 'src/assistant/turn.ts' },
      { kind: 'run', label: 'R-7D92', mark: 'run', title: 'run R-7D92' },
      { kind: 'note', label: 'limits', mark: 'note', title: 'Notes/limits.md' },
      { kind: 'tool', label: 'GitHub' },
    ]);
  });

  it('makes a failed or refused script a dead end, with the reason', () => {
    const s = stepOf(run('await github.comment("o/r", 4, "x")', { isError: true, output: 'Error: github.comment needs the person\'s approval ("comment on o/r#4"). It is now in their Inbox.\nmore' }));
    expect(s).toMatchObject({ dead: true, label: 'Dead end: github.comment needs the person\'s approval ("comment on o/r#4")', chips: [] });
    expect(stepOf(run('x', { isError: true, output: '' })).label).toBe('Dead end: the script failed');
  });
});

describe('timeline', () => {
  it('collapses consecutive scripts of one kind into one step with a count', () => {
    const steps = timeline([run('repo.read("a.ts")'), run('repo.read("b.ts"); repo.read("c.ts")'), run('repo.read("a.ts"); repo.read("d.md")'), run('repo.search("x")')], false);
    expect(steps.map((s) => [s.label, s.calls])).toEqual([['Read 4 files', 3], ['Searched the codebase for "x"', 1]]);
    expect(steps[0]!.chips.map((c) => c.label)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.md']);
  });

  it('does not merge across a dead end, and repeated searches say how many', () => {
    const steps = timeline([run('repo.search("a")'), run('repo.search("b")'), run('repo.read("x")', { isError: true, output: 'Error: no such file' }), run('repo.read("y")')], false);
    expect(steps.map((s) => s.label)).toEqual(['Searched the codebase 2 times', 'Dead end: no such file', 'Read 1 file']);
  });

  it('marks only the last unfinished script as live, and only while streaming', () => {
    const tools = [run('repo.search("a")'), run('repo.read("x")', { output: undefined, ms: undefined })];
    expect(timeline(tools, true).map((s) => !!s.live)).toEqual([false, true]);
    expect(timeline(tools, false).some((s) => s.live)).toBe(false);
    // a live step never merges with the finished one before it
    expect(timeline([run('repo.read("a")'), run('repo.read("b")', { output: undefined })], true)).toHaveLength(2);
  });
});

describe('web steps', () => {
  it('tells the agent’s search from a page read, and leaves a script’s saved request alone', () => {
    expect(webCall('http.search("react 19")')).toEqual({ search: 'react 19' });
    expect(webCall('http.get("https://react.dev/blog")')).toEqual({ url: 'https://react.dev/blog' });
    expect(webCall('return http.get("my-saved-request")')).toBeUndefined();
    expect(webCall('return repo.read("a.ts")')).toBeUndefined();
  });

  it('reads the links a search returned, skipping a list cut short', () => {
    const out = 'Web search results for query: "q"\n\nLinks: [{"title":"A","url":"https://a.dev"},{"title":"B","url":"https://b.dev/x"},{"url":"no title"}]\n\nSummary…\nLinks: [{"title":"C","url":"https://c.dev"';
    expect(searchLinks(out)).toEqual([{ title: 'A', url: 'https://a.dev' }, { title: 'B', url: 'https://b.dev/x' }]);
    expect(searchLinks(undefined)).toEqual([]);
  });

  it('keeps each step’s scripts', () => {
    const tools = [run('http.search("a")'), run('http.get("https://a.dev")')];
    expect(timeline(tools, false)[0]!.runs).toEqual(tools);
  });
});

describe('thinkingSummary', () => {
  it('counts calls, files, runs and notes, leaving out zeros', () => {
    expect(thinkingSummary([run('repo.read("a.ts"); repo.read("b.ts")'), run('tether.runs.get("R-1")'), run('repo.read("a.ts")')])).toBe('3 calls · 2 files · 1 run');
    expect(thinkingSummary([run('return 1')])).toBe('1 call');
    expect(thinkingSummary([run('repo.read("a.ts")'), run('repo.read("gone.ts")', { isError: true, output: 'Error: no such file' })])).toBe('2 calls · 1 file');
  });
});
