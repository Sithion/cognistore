export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'cognistore.theme';
let systemQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

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
  if (systemQuery && systemListener) systemQuery.removeEventListener('change', systemListener);
  systemQuery = null; systemListener = null;
  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    window.dispatchEvent(new CustomEvent('cognistore:themechange', { detail: { dark, mode } }));
  };
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  apply(dark);
  if (mode === 'system') {
    systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemListener = (event) => apply(event.matches);
    systemQuery.addEventListener('change', systemListener);
  }
  return dark;
}
