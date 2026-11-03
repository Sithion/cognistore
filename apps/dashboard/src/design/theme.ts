export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'cognistore.theme';

export function getThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(mode: ThemeMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* storage may be disabled */ }
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}
