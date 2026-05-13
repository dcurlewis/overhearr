import { describe, expect, it } from 'vitest';

import {
  isTheme,
  readStoredTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from '../../../src/lib/theme';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private store = new Map<string, string>();
  public throwOnSet = false;
  public throwOnGet = false;
  getItem(k: string): string | null {
    if (this.throwOnGet) throw new Error('boom');
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error('boom');
    this.store.set(k, v);
  }
}

describe('lib/theme', () => {
  it('isTheme accepts only "dark" or "light"', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('system')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(42)).toBe(false);
  });

  it('readStoredTheme returns null when storage is empty', () => {
    const s = new MemoryStorage();
    expect(readStoredTheme(s)).toBeNull();
  });

  it('readStoredTheme returns null for malformed values', () => {
    const s = new MemoryStorage();
    s.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readStoredTheme(s)).toBeNull();
  });

  it('readStoredTheme returns the stored Theme when valid', () => {
    const s = new MemoryStorage();
    s.setItem(THEME_STORAGE_KEY, 'light');
    expect(readStoredTheme(s)).toBe('light');
  });

  it('readStoredTheme tolerates throwing storage (privacy mode)', () => {
    const s = new MemoryStorage();
    s.throwOnGet = true;
    expect(readStoredTheme(s)).toBeNull();
  });

  it('readStoredTheme returns null for missing storage', () => {
    expect(readStoredTheme(null)).toBeNull();
    expect(readStoredTheme(undefined)).toBeNull();
  });

  it('writeStoredTheme persists the value', () => {
    const s = new MemoryStorage();
    writeStoredTheme(s, 'dark');
    expect(s.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('writeStoredTheme swallows storage errors', () => {
    const s = new MemoryStorage();
    s.throwOnSet = true;
    expect(() => writeStoredTheme(s, 'light')).not.toThrow();
  });

  it('writeStoredTheme is a no-op for missing storage', () => {
    expect(() => writeStoredTheme(null, 'dark')).not.toThrow();
    expect(() => writeStoredTheme(undefined, 'dark')).not.toThrow();
  });

  it('resolveInitialTheme prefers a stored value over the system preference', () => {
    const s = new MemoryStorage();
    s.setItem(THEME_STORAGE_KEY, 'light');
    expect(resolveInitialTheme(s, true)).toBe('light');
  });

  it('resolveInitialTheme falls back to prefers-color-scheme:dark', () => {
    const s = new MemoryStorage();
    expect(resolveInitialTheme(s, true)).toBe('dark');
    expect(resolveInitialTheme(s, false)).toBe('light');
  });
});
