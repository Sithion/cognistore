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
  return response.json();
}

export const api = {
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

  getHealth: () => request('/api/health'),

  repair: () => request<{ success: boolean; message: string }>('/api/admin/repair', { method: 'POST' }),

  uninstall: () => request<{ success: boolean; message: string }>('/api/admin/uninstall', { method: 'POST' }),
};
