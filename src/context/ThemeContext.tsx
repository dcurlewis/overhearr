import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  readStoredTheme,
  resolveInitialTheme,
  type Theme,
  writeStoredTheme,
} from '../lib/theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.style.colorScheme = theme;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Default to 'dark' on the server (matches the FOUC script's default class).
  // The first client-only effect re-syncs to the user's actual preference.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const prefersDark =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = resolveInitialTheme(
      typeof window !== 'undefined' ? window.localStorage : null,
      prefersDark
    );
    setThemeState(initial);
    applyThemeClass(initial);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyThemeClass(next);
    writeStoredTheme(
      typeof window !== 'undefined' ? window.localStorage : null,
      next
    );
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyThemeClass(next);
      writeStoredTheme(
        typeof window !== 'undefined' ? window.localStorage : null,
        next
      );
      return next;
    });
  }, []);

  // Re-sync when another tab changes theme (rare but cheap).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: StorageEvent) => {
      if (event.key !== 'overhearr-theme') return;
      const stored = readStoredTheme(window.localStorage);
      if (stored && stored !== theme) {
        setThemeState(stored);
        applyThemeClass(stored);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
