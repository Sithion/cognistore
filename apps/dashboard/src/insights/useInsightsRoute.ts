import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/index.js';

/** URL-backed filters shared by the Insights routes; DateRangeControl owns range updates. */
export function useInsightsRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const range = useAppSelector((state) => state.dateRange.range);
  const params = new URLSearchParams(location.search);
  const scope = params.get('scope') ?? '';
  const provider = params.get('provider') ?? '';
  const filters = Object.fromEntries(params.entries());
  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value); else next.delete(key);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: false });
  };
  return { params, filters, scope, provider, range, patch };
}
