import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentToBot, parseFront, parseRouting } from '../src/ecc.js';

const fx = (p: string) => readFileSync(join(new URL('./fixtures/ecc/', import.meta.url).pathname, p), 'utf8');

describe('ECC parsing', () => {
  it('reads frontmatter with quotes, lists and CRLF', () => {
    const { front, body } = parseFront('---\r\nname: x\r\ndescription: "a: b"\r\ntools: Read, Write\r\nargument-hint: <p>\r\n---\r\nbody\r\n');
    expect(front).toEqual({ name: 'x', description: 'a: b', tools: ['Read', 'Write'], argumentHint: '<p>' });
    expect(body).toBe('body');
    expect(parseFront('no front').front.tools).toEqual([]);
    expect(parseFront('\uFEFF---\nname: x\n---\nbody').front.name).toBe('x');
    expect(parseFront('---\n---\nbody')).toEqual({ front: { tools: [] }, body: 'body' });
  });

  it('maps an agent to a bot', () => {
    const r = agentToBot('go-reviewer.md', fx('agents/go-reviewer.md'), 'v2.2.3', new Set());
    expect(r.bot).toMatchObject({ id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', readOnly: true, source: 'ecc@v2.2.3', modelHint: 'sonnet' });
    expect(r.bot!.whenToUse).toMatch(/^Expert Go code reviewer/);
    expect(r.bot!.persona).toMatch(/senior Go reviewer/);
  });

  it('prefixes clashes with built-ins and taken ids, and keeps writers writable', () => {
    expect(agentToBot('planner.md', fx('agents/planner.md'), 'v2.2.3', new Set()).bot).toMatchObject({ id: 'ecc-planner', kind: 'agent', readOnly: true, modelHint: 'opus' });
    expect(agentToBot('go-reviewer.md', fx('agents/go-reviewer.md'), 'v2.2.3', new Set(['go-reviewer'])).bot!.id).toBe('ecc-go-reviewer');
    const tdd = agentToBot('tdd-guide.md', fx('agents/tdd-guide.md').replace(/\r?\n/g, '\r\n'), 'v2.2.3', new Set()).bot!;
    expect(tdd).toMatchObject({ id: 'tdd-guide', kind: 'agent' });
    expect(tdd.readOnly).toBeUndefined();
  });

  it('uses the file name without a name field, shortens long ids, and refuses junk', () => {
    expect(agentToBot('no-front.md', fx('agents/no-front.md'), 'v2.2.3', new Set()).bot!.id).toBe('no-front');
    const long = agentToBot('x.md', '---\nname: harmonyos-app-resolver-extra-long\n---\nbody', 'v2.2.3', new Set());
    expect(long.bot!.id).toBe('harmonyos-app-resolver-e');
    expect(long.note).toMatch(/shortened/);
    expect(agentToBot('go-reviewer.md', fx('agents/go-reviewer.md'), 'feature/x', new Set()).error).toMatch(/ref/);
    expect(agentToBot('Bad.md', '---\nname: Bad Name!\n---\nx', 'v2.2.3', new Set()).error).toMatch(/name/);
  });

  it('reads the agents table and routing rules', () => {
    const r = parseRouting(fx('AGENTS.md'));
    expect(r.table).toEqual(['planner', 'tdd-guide', 'security-reviewer']);
    expect(r.rules).toContainEqual({ when: 'Go changes', agents: ['go-reviewer'] });
    expect(r.rules).toContainEqual({ when: 'Open-source release prep', agents: ['opensource-forker', 'opensource-sanitizer'] });
    expect(r.rules).toHaveLength(5);
    expect(parseRouting('# nothing')).toEqual({ table: [], rules: [] });
  });
});
