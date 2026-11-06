import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

export const searchWithout = (search: string) => {
  const next = new URLSearchParams(search);
  next.delete('select');
  const s = next.toString();
  return s ? `?${s}` : '';
};

/** URL-backed state for the plans list and its full-page detail route. */
export function usePlansRoute() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = useMemo(() => (params.get('status') || '').split(',').filter(Boolean), [params]);
  const scope = params.get('scope') || '';
  const sort = params.get('sort') || 'updated';
  const page = Math.max(1, Number(params.get('page') || '1') || 1);
  const patch = useCallback((updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace });
  }, [params, setParams]);
  const setStatuses = useCallback((values: string[]) => patch({ status: [...values].sort().join(',') || null, page: '1' }), [patch]);
  const setScope = useCallback((value: string) => patch({ scope: value || null, page: '1' }), [patch]);
  const setSort = useCallback((value: string) => patch({ sort: value }), [patch]);
  const setPage = useCallback((value: number) => patch({ page: String(Math.max(1, value)) }), [patch]);
  const openPlan = useCallback((planId: string) => {
    const next = new URLSearchParams(searchWithout(location.search));
    next.set('select', planId);
    navigate({ pathname: `/plans/${encodeURIComponent(planId)}`, search: `?${next}` });
  }, [location.search, navigate]);
  const backToList = useCallback(() => navigate({ pathname: '/plans', search: searchWithout(location.search) }), [location.search, navigate]);
  return { id, status, scope, sort, page, setStatuses, setScope, setSort, setPage, openPlan, backToList, patch };
}
