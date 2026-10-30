import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsks, parseUserAsks, stripAsks, stripUserAsks } from '../src/consult.js';
import { parseHands, stripHands } from '../src/handoff.js';
import { liveLines } from '../src/protocolLines.js';

const live = (t: string) => liveLines(t).filter((l) => l.live).map((l) => l.line);

describe('protocol lines follow CommonMark fences', () => {
  it('a fence closes only with the same character and at least the same length', () => {
    expect(live('````\n```\n@HAND a: x\n```\n````\n@HAND a: real')).toEqual(['@HAND a: real']);
    expect(live('~~~\n```\n@HAND a: x\n~~~\n@HAND a: real')).toEqual(['@HAND a: real']);
    expect(live('```\n~~~\n@HAND a: x\n```\nafter')).toEqual(['after']);
    // a longer closer closes; a closer with text after it does not
    expect(live('```\n@HAND a: x\n`````\nafter')).toEqual(['after']);
    expect(live('```\n@HAND a: x\n``` not a closer\n@HAND a: still inside')).toEqual([]);
    // an info string on the opener is fine; an unclosed fence runs to the end
    expect(live('```markdown\n@HAND a: x')).toEqual([]);
  });

  it('indented code and > quotes never carry live lines', () => {
    expect(live('    @HAND a: x\n\t@HAND a: y\n> @HAND a: z\n   > @HAND a: q\nok')).toEqual(['ok']);
    // a fence inside a quote does not open a fence outside it
    expect(live('> ```\n@HAND a: real')).toEqual(['@HAND a: real']);
    // up to three spaces before a fence still make a fence
    expect(live('   ```\n@HAND a: x\n   ```\n@HAND a: real')).toEqual(['@HAND a: real']);
  });

  it("the owner's README run: a ```` outer fence with ``` inner fences carries no live @ASK or @HAND line", () => {
    const report = readFileSync(join(import.meta.dirname, 'fixtures', 'readme-quoted.md'), 'utf8');
    expect(parseHands(report)).toEqual([]);
    expect(parseUserAsks(report)).toEqual([]);
    expect(parseAsks(report)).toEqual([]);
    expect(stripHands(report)).toBe(report.trimEnd());
    expect(stripUserAsks(report)).toBe(report.trimEnd());
    expect(stripAsks(report)).toBe(report.trimEnd());
    // the same report with a real request after it: only that one is live
    const asking = `${report}\n@HAND reviewer: check the README | expect: PASS\n@ASK user: Ship it? | options: yes; no\n@ASK planner: which sections changed?`;
    expect(parseHands(asking).map((h) => h.goal)).toEqual(['check the README']);
    expect(parseUserAsks(asking).map((a) => a.question)).toEqual(['Ship it?']);
    expect(parseAsks(asking)).toEqual([{ target: 'planner', question: 'which sections changed?' }]);
  });

  it('a step-to-step @ASK inside a fence or a quote is not a question', () => {
    expect(parseAsks('```\n@ASK plan: why?\n```')).toEqual([]);
    expect(parseAsks('> @ASK plan: why?')).toEqual([]);
    expect(stripAsks('a\n```\n@ASK plan: why?\n```')).toBe('a\n```\n@ASK plan: why?\n```');
  });
});
