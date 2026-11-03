// Runs before React so the first paint already has the right theme (no flash).
// External file on purpose: the sidecar and Tauri CSP are `script-src 'self'` (no inline scripts).
try {
  const mode = localStorage.getItem('cognistore.theme') || 'dark';
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {
  document.documentElement.classList.add('dark');
}
