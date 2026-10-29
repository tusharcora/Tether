import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPrompt, deletePrompt, listPrompts, promptsFile, updatePrompt, variablesOf } from '../src/assistant/prompts.js';
import { tmp } from './helpers.js';

describe('saved prompts', () => {
  it('live in the project at .aorch/prompts.json, or in Tether’s home with no project', () => {
    const home = tmp('home-');
    const root = tmp('proj-');
    expect(promptsFile(home, root)).toBe(join(root, '.aorch', 'prompts.json'));
    expect(promptsFile(home)).toBe(join(home, 'prompts.json'));
  });

  it('creates, lists, edits and deletes, reading {{variables}} from the body on every save', () => {
    const file = promptsFile(tmp('home-'), tmp('proj-'));
    expect(listPrompts(file)).toEqual([]);
    const a = createPrompt(file, { name: '  Review   a file ', body: 'Review {{file}} for {{ concern }}, then {{file}} again.' });
    expect(a).toMatchObject({ name: 'Review a file', variables: ['file', 'concern'] });
    expect(a.id).toMatch(/^p-[a-z0-9]+$/);
    const b = createPrompt(file, { name: 'Plain', body: 'No vars.' });
    expect(listPrompts(file).map((p) => p.name)).toEqual(['Review a file', 'Plain']);
    expect(updatePrompt(file, b.id, { body: 'Now {{one}}' })).toEqual({ id: b.id, name: 'Plain', body: 'Now {{one}}', variables: ['one'] });
    expect(deletePrompt(file, a.id)).toBe(true);
    expect(deletePrompt(file, a.id)).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).prompts.map((p: { name: string }) => p.name)).toEqual(['Plain']);
    expect(variablesOf('{{a}} {{ b-2 }} {{3x}} {a}')).toEqual(['a', 'b-2']);
  });

  it('refuses bad names, bodies and ids', () => {
    const file = promptsFile(tmp('home-'), tmp('proj-'));
    expect(() => createPrompt(file, { name: '', body: 'x' })).toThrow(/"name"/);
    expect(() => createPrompt(file, { name: 'x'.repeat(81), body: 'x' })).toThrow(/"name"/);
    expect(() => createPrompt(file, { name: 'x', body: ' ' })).toThrow(/"body"/);
    expect(() => createPrompt(file, { name: 'x', body: 'x'.repeat(20_001) })).toThrow(/"body"/);
    for (const id of ['../x', 'p-', 'x-abcd', 'p-ABCD', 'p-abcd/..']) {
      expect(() => updatePrompt(file, id, { name: 'y' })).toThrow(/not a prompt id/);
      expect(() => deletePrompt(file, id)).toThrow(/not a prompt id/);
    }
    expect(() => updatePrompt(file, 'p-abcd', { name: 'y' })).toThrow(/no such prompt/);
  });

  it('refuses a symlinked .aorch or prompts.json, and keeps only well-formed entries of a hand-edited file', () => {
    const home = tmp('home-');
    const outside = tmp('outside-');
    const a = tmp('proj-');
    symlinkSync(outside, join(a, '.aorch'));
    expect(() => promptsFile(home, a)).toThrow(/symlinked/);
    const b = tmp('proj-');
    mkdirSync(join(b, '.aorch'));
    writeFileSync(join(outside, 'p.json'), '{"prompts":[]}');
    symlinkSync(join(outside, 'p.json'), join(b, '.aorch', 'prompts.json'));
    expect(() => promptsFile(home, b)).toThrow(/symlinked/);
    const file = promptsFile(home, tmp('proj-'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify({ prompts: [{ id: 'p-good1', name: 'Good', body: 'ok' }, { id: '../bad', name: 'Bad', body: 'x' }, { id: 'p-nobody', name: 'No body' }, 'junk'] }));
    expect(listPrompts(file)).toEqual([{ id: 'p-good1', name: 'Good', body: 'ok', variables: [] }]);
    writeFileSync(file, '{broken');
    expect(listPrompts(file)).toEqual([]);
  });
});
