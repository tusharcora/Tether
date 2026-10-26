import { describe, expect, it } from 'vitest';
import { cssRule, cssText } from '../../test/css';

/**
 * Seamless collapse (spec §6): every icon's centre must be the same collapsed and expanded. jsdom does no layout, so the
 * geometry is read from shell.css, the one place it is decided; the real check measures it in a browser.
 */
const rule = (sel: string) => cssRule('ui/studio/shell.css', sel);
const decl = (sel: string, prop: string): string => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(rule(sel));
  if (!m) throw new Error(`${sel} has no ${prop}`);
  return m[1]!.trim();
};
const px = (v: string) => Number(/^(-?[\d.]+)px$/.exec(v)?.[1] ?? (v === '0' ? 0 : NaN));
/** The left side of a padding or margin shorthand, in px. */
const leftOf = (shorthand: string) => {
  const parts = shorthand.split(/\s+/);
  return px(parts[parts.length === 4 ? 3 : parts.length >= 2 ? 1 : 0]!);
};

describe('the seamless sidebar collapse', () => {
  const railWidth = px(decl('.sl-side.collapsed', 'width'));
  const asidePad = leftOf(decl('.sl-side', 'padding'));

  it('centres each row icon at the rail’s middle in both states: aside padding + row gutter + item padding + half the cell', () => {
    const centre = asidePad + leftOf(decl('.sl-side-row', 'margin')) + leftOf(decl('.sl-side-item', 'padding')) + px(decl('.sl-side-icon', 'width')) / 2;
    expect(centre).toBe(28);
    expect(centre).toBe(railWidth / 2);
  });

  it('centres the glyph and the account avatar on the same line', () => {
    expect(asidePad + leftOf(decl('.sl-side-head', 'padding')) + leftOf(decl('.sl-switch', 'padding')) + px(decl('.sl-switch-glyph', 'width')) / 2).toBe(railWidth / 2);
    expect(asidePad + leftOf(decl('.sl-side-account', 'margin')) + leftOf(decl('.sl-side-account', 'padding')) + px(decl('.sl-side-icon', 'width')) / 2).toBe(railWidth / 2);
  });

  it('centres the section hairline on the rail', () => {
    const after = rule('.sl-side-section-head::after');
    expect(after).toContain('left: 14px');
    expect(after).toContain('right: 14px');
  });

  it('changes only the width when collapsed: no rule under .sl-side.collapsed moves anything', () => {
    const text = cssText('ui/studio/shell.css');
    const collapsedRules = [...text.matchAll(/([^{}]*\.sl-side\.collapsed[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    expect(collapsedRules.length).toBeGreaterThan(3);
    for (const r of collapsedRules) {
      const props = [...r.body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]!);
      const allowed = r.sel === '.sl-side.collapsed' ? ['width'] : ['opacity', 'background', 'color'];
      expect(props.filter((p) => !allowed.includes(p)), r.sel).toEqual([]);
    }
  });

  it('keeps the head at the expanded width, so the clipped actions never push the glyph', () => {
    expect(decl('.sl-side-head', 'width')).toBe(decl('.sl-side', 'width'));
    expect(decl('.sl-side', 'overflow')).toBe('hidden');
  });
});
