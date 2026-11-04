import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/** URL is the source of truth for filters and detail, including browser Back. */
export function useKnowledgeRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const match = location.pathname.match(/^\/knowledge\/([^/]+)$/);
  const selectedId = match ? decodeURIComponent(match[1]) : params.get('edit');
  const listParams = () => {
    const next = new URLSearchParams(params);
    next.delete('edit'); next.delete('new'); next.delete('editing');
    return next;
  };
  const listUrl = `/knowledge${listParams().size ? `?${listParams()}` : ''}`;
  const patch = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };
  const detailUrl = (id: string) => {
    const next = listParams();
    // The shared route compatibility adapter recognizes this parameter.
    next.set('edit', id);
    return `/knowledge/${encodeURIComponent(id)}?${next}`;
  };
  const open = (id: string, replace = false) => navigate(detailUrl(id), {
    replace, state: replace ? location.state : { knowledgeReturn: listUrl },
  });
  const close = useCallback(() => {
    if (location.state?.knowledgeReturn) navigate(-1);
    else {
      const next = new URLSearchParams(location.search);
      next.delete('edit'); next.delete('new'); next.delete('editing');
      navigate(`/knowledge${next.size ? `?${next}` : ''}`, { replace: true });
    }
  }, [location.search, location.state, navigate]);
  return {
    params, patch, selectedId, open, close, detailUrl, listUrl,
    overview: location.pathname === '/', creating: params.has('new'),
    page: Number.isFinite(Number(params.get('page'))) ? Math.max(0, Math.floor(Number(params.get('page')) || 0)) : 0,
    newEntry: () => {
      const next = listParams(); next.set('new', '1');
      navigate(`/knowledge?${next}`, { state: { knowledgeReturn: listUrl } });
    },
  };
}
