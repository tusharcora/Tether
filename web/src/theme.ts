import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'Match system' };

const KEY = 'aorch.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The saved choice; missing, unknown or unreadable means Match system. An old 'light'/'dark' is kept as the manual pick. */
export function storedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY)?.matches ? 'dark' : 'light';
}

export const resolveTheme = (c: ThemeChoice): Theme => (c === 'system' ? systemTheme() : c);
export const initialTheme = (): Theme => resolveTheme(storedChoice());

/** Arc's foundation.css and the Studio tokens key their dark palette on data-theme. The Arc accent attribute is never set. */
export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  el.dataset.theme = t;
  delete el.dataset.accent;
  el.style.colorScheme = t;
}

export function useTheme(): { choice: ThemeChoice; theme: Theme; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(choice));

  useEffect(() => {
    setTheme(resolveTheme(choice));
    if (choice !== 'system') return;
    const mql = window.matchMedia?.(DARK_QUERY);
    if (!mql?.addEventListener) return;
    const on = () => setTheme(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [choice]);
  useEffect(() => applyTheme(theme), [theme]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return { choice, theme, setChoice };
}
