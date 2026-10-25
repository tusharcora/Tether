import { describe, expect, it } from 'vitest';
import { cssRule, norm, ruleIn } from './css';

const sheet = `
/* .sl-dot { color: comment; } */
.sl-chip.t-live .sl-dot { background: var(--acc); }
.sl-dot { width: 6px; }
.a, .b { color: red; }
@keyframes sl-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) {
  .sl-dot { animation: none; }
}
.twice { color: red; }
.twice { color: blue; }
`;

describe('css test helper', () => {
  it('normalises whitespace, comma spacing and quotes', () => {
    expect(norm('  a ,  b\n "c" ')).toBe("a,b 'c'");
  });
  it('matches the whole selector, not a rule whose selector ends with it', () => {
    expect(ruleIn(sheet, '.sl-dot')).toBe('width: 6px;');
    expect(ruleIn(sheet, '.sl-chip.t-live .sl-dot')).toBe('background: var(--acc);');
    expect(ruleIn(sheet, '.a, .b')).toBe('color: red;');
    expect(() => ruleIn(sheet, '.a')).toThrow(/no rule/);
  });
  it('skips @-rule blocks unless their scope is asked for', () => {
    expect(ruleIn(sheet, '.sl-dot', '@media (prefers-reduced-motion: reduce)')).toBe('animation: none;');
    expect(() => ruleIn(sheet, '50%')).toThrow(/no rule/);
    expect(ruleIn(sheet, '50%', '@keyframes sl-pulse')).toBe('opacity: .35;');
  });
  it('throws when a selector has more than one rule', () => {
    expect(() => ruleIn(sheet, '.twice')).toThrow(/ambiguous/);
  });
  it('reads rules from a file under web/src', () => {
    expect(cssRule('ui/studio/parts.css', '.sl-dot')).toContain('border-radius: 50%');
  });
});
