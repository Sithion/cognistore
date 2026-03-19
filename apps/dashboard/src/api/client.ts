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
  nodeReady: boolean;
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
  setupNode: () => request<SetupResult>('/api/setup/node', { method: 'POST' }),
  setupOllama: () => request<SetupResult>('/api/setup/ollama', { method: 'POST' }),
  setupOllamaStart: () => request<SetupResult>('/api/setup/ollama-start', { method: 'POST' }),
  setupDatabase: () => request<SetupResult>('/api/setup/database', { method: 'POST' }),
  setupModel: () => request<SetupResult>('/api/setup/model', { method: 'POST' }),
  setupConfigure: () => request<SetupResult>('/api/setup/configure', { method: 'POST' }),
  setupComplete: () => request<SetupResult>('/api/setup/complete', { method: 'POST' }),

  // Upgrade
  checkUpgrade: () => request<{ needsUpgrade: boolean; fromVersion: string | null; toVersion: string; isFirstInstall: boolean }>('/api/upgrade/check'),
  runUpgrade: () => request<{ success: boolean; fromVersion: string; toVersion: string; results: { step: string; status: string; message?: string }[] }>('/api/upgrade/run', { method: 'POST' }),

  // Uninstall
  uninstallAll: () => request<SetupResult>('/api/uninstall', { method: 'POST' }),

  // Knowledge CRUD
  search: (query: string, options?: Record<string, unknown>) =>
    request('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ query, ...options }) }),

  listRecent: (limit = 20, filters?: { type?: string; scope?: string }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (filters?.type) params.set('type', filters.type);
    if (filters?.scope) params.set('scope', filters.scope);
    return request<any[]>(`/api/knowledge/recent?${params}`);
  },

  getTopTags: (limit = 10) =>
    request<{ tag: string; count: number }[]>(`/api/metrics/top-tags?limit=${limit}`),

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
    operationsByDay: { date: string; reads: number; writes: number }[];
    heatmap: { date: string; count: number }[];
    typeDistribution: { name: string; value: number }[];
    operations: { readsLastHour: number; readsLastDay: number; writesLastHour: number; writesLastDay: number };
  }>('/api/metrics'),

  getHealth: () => request('/api/health'),

  // Scopes
  listScopes: () => request<string[]>('/api/scopes'),

  // Bulk operations
  bulkDeleteKnowledge: (ids: string[]) =>
    request<{ deleted: number; errors: string[] }>('/api/knowledge/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),

  // Export
  exportKnowledge: async (format: 'json' | 'csv' = 'json') => {
    const response = await fetch(`${API_BASE}/api/export/knowledge?format=${format}`);
    if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'csv' ? 'knowledge-export.csv' : 'knowledge-export.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  exportPlans: async () => {
    const response = await fetch(`${API_BASE}/api/export/plans?format=json`);
    if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plans-export.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  // Import
  importKnowledge: (data: { entries?: any[]; csv?: string }) =>
    request<{ imported: number; skipped: number; errors: string[] }>('/api/import/knowledge', { method: 'POST', body: JSON.stringify(data) }),

  importPlans: (data: { plans: any[] }) =>
    request<{ imported: number; skipped: number; errors: string[] }>('/api/import/plans', { method: 'POST', body: JSON.stringify(data) }),

  // Plans
  createPlan: (data: { title: string; content: string; tags?: string[]; scope?: string; source?: string; tasks?: { description: string; priority?: string }[] }) =>
    request('/api/plans', { method: 'POST', body: JSON.stringify(data) }),

  listPlans: (limit = 20, status?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set('status', status);
    return request<any[]>(`/api/plans?${params}`);
  },

  getPlan: (id: string) =>
    request<any>(`/api/plans/${id}`),

  getPlanRelations: (id: string) =>
    request<{ entry: any; relationType: string }[]>(`/api/plans/${id}/relations`),

  addPlanRelation: (id: string, knowledgeId: string, relationType: 'input' | 'output') =>
    request(`/api/plans/${id}/relations`, { method: 'POST', body: JSON.stringify({ knowledgeId, relationType }) }),

  updatePlan: (id: string, data: Record<string, unknown>) =>
    request(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePlan: (id: string) =>
    request(`/api/plans/${id}`, { method: 'DELETE' }),

  // Plan Tasks
  listPlanTasks: (planId: string) =>
    request<any[]>(`/api/plans/${planId}/tasks`),

  createPlanTask: (planId: string, data: Record<string, unknown>) =>
    request(`/api/plans/${planId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),

  updatePlanTask: (taskId: string, data: Record<string, unknown>) =>
    request(`/api/plans/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePlanTask: (taskId: string) =>
    request(`/api/plans/tasks/${taskId}`, { method: 'DELETE' }),

  // Plan Metrics
  getPlanMetrics: () =>
    request<{
      plans: { total: number; draft: number; active: number; completed: number; archived: number };
      tasks: { total: number; pending: number; inProgress: number; completed: number; avgPerPlan: number };
      plansByDay: { date: string; count: number }[];
    }>('/api/metrics/plans'),

  // Maintenance
  cleanupDatabase: () => request<{ success: boolean; orphansRemoved: number; vacuumed: boolean; sizeAfter: string }>(
    '/api/maintenance/cleanup', { method: 'POST' }
  ),

  // Re-deploy configurations
  redeploy: () => request<{ success: boolean; results: { step: string; status: string; message?: string }[] }>(
    '/api/redeploy', { method: 'POST' }
  ),
};
