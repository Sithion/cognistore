const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Service unavailable — backend is not running');
  }
  return response.json();
}

export interface SetupStatus {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  databaseReady: boolean;
  modelAvailable: boolean;
  configsReady: boolean;
  sdkReady: boolean;
  allReady: boolean;
}

export interface SetupResult {
  success: boolean;
  message?: string;
  results?: string[];
  path?: string;
}

export const api = {
  // Setup
  getSetupStatus: () => request<SetupStatus>('/api/setup/status'),
  setupOllama: () => request<SetupResult>('/api/setup/ollama', { method: 'POST' }),
  setupOllamaStart: () => request<SetupResult>('/api/setup/ollama-start', { method: 'POST' }),
  setupDatabase: () => request<SetupResult>('/api/setup/database', { method: 'POST' }),
  setupModel: () => request<SetupResult>('/api/setup/model', { method: 'POST' }),
  setupConfigure: () => request<SetupResult>('/api/setup/configure', { method: 'POST' }),
  setupComplete: () => request<SetupResult>('/api/setup/complete', { method: 'POST' }),

  // Uninstall
  uninstallAll: () => request<SetupResult>('/api/uninstall', { method: 'POST' }),

  // Knowledge CRUD
  search: (query: string, options?: Record<string, unknown>) =>
    request('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ query, ...options }) }),

  listRecent: (limit = 20) =>
    request<any[]>(`/api/knowledge/recent?limit=${limit}`),

  getById: (id: string) => request(`/api/knowledge/${id}`),

  create: (data: Record<string, unknown>) =>
    request('/api/knowledge', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Record<string, unknown>) =>
    request(`/api/knowledge/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEntry: (id: string) =>
    request(`/api/knowledge/${id}`, { method: 'DELETE' }),

  listTags: () => request<string[]>('/api/tags'),

  getStats: () => request('/api/stats'),

  getMetrics: () => request<{
    database: { sizeBytes: number; sizeFormatted: string; path: string };
    activity: { last24h: number; last7d: number; last30d: number; total: number };
    activityByDay: { date: string; count: number }[];
    typeDistribution: { name: string; value: number }[];
  }>('/api/metrics'),

  getHealth: () => request('/api/health'),
};
