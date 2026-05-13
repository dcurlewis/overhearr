/**
 * Theme storage helpers, kept pure for unit testing.
 *
 * The frontend persists the user's last choice in `localStorage` under the
 * key below, falling back to the system colour-scheme preference if no
 * choice has been made yet.
 */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'overhearr-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/**
 * Read the persisted theme from localStorage, returning `null` if none
 * has been set or the value is malformed.
 *
 * Safe to call in environments where `localStorage` may throw (private mode,
 * SSR shim, etc.).
 */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null | undefined): Theme | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(storage: Pick<Storage, 'setItem'> | null | undefined, theme: Theme): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore quota / privacy-mode failures — theme will simply not persist.
  }
}

/**
 * Resolve the initial theme: prefer the persisted choice, otherwise fall back
 * to the OS preference, otherwise dark (our brand default).
 */
export function resolveInitialTheme(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  prefersDark: boolean
): Theme {
  const stored = readStoredTheme(storage);
  if (stored) return stored;
  return prefersDark ? 'dark' : 'light';
}
