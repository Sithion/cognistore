import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useRouteState(): { params: URLSearchParams; patch(values: Record<string, string | null>, options?: { replace?: boolean }): void } {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const patch = useCallback((values: Record<string, string | null>, options?: { replace?: boolean }) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values)) value === null ? next.delete(key) : next.set(key, value);
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: options?.replace });
  }, [location.pathname, location.search, navigate]);
  return { params, patch };
}
