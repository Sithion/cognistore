import { useEffect, useState, useCallback } from 'react';
import { api, PROVIDER_SOURCE, type ProviderFilter, type TokenUsageAggregates } from '../../api/client.js';
import { useWidgetClose } from '../shared/useWidgetClose.js';
import { Button } from '../../components/ui/button.js';

const REFRESH_INTERVAL = 30_000;

const PROVIDER_SEGMENTS: { key: ProviderFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'claude', label: 'Claude' },
  { key: 'copilot', label: 'Copilot' },
];

function navigateMainApp(route: string) {
  import('@tauri-apps/api/event').then(({ emit }) => emit('navigate', route)).catch(() => {});
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function isoWeekAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function Row({ label, value, color = '#a5b4fc' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    }}>
      <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color }}>{formatTokens(value)}</span>
    </div>
  );
}

export function TokenConsumptionWidget() {
  const [data, setData] = useState<TokenUsageAggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const handleClose = useWidgetClose();

  // Hydrate the persisted provider filter (shared with the full page via settings.json).
  useEffect(() => {
    api.getSettings()
      .then((s) => setProvider(s.tokenProviderFilter ?? 'all'))
      .catch(() => { /* keep default */ });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const now = new Date().toISOString();
      const result = await api.getTokenUsage({ from: isoWeekAgo(), to: now, source: PROVIDER_SOURCE[provider] });
      setData(result);
    } catch { /* keep last value */ } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  const changeProvider = (p: ProviderFilter) => {
    setProvider(p);
    void api.updateSettings({ tokenProviderFilter: p }).catch(() => {});
  };

  const totals = data?.totals;
  const total = totals ? totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens : 0;

  return (
    <main className="widget-shell">
      <div className="widget-drag-region" data-tauri-drag-region>
        <h1 className="widget-title" data-tauri-drag-region>Tokens · 7d</h1>
        <button className="widget-close" aria-label="Close widget" onClick={handleClose} title="Close">×</button>
      </div>

      <div className="widget-content">
        <div style={{ display: 'flex', gap: 4, paddingBottom: 8 }}>
          {PROVIDER_SEGMENTS.map(({ key, label }) => {
            const active = provider === key;
            return (
              <Button variant={active ? 'default' : 'outline'} size="sm"
                key={key}
                onClick={() => changeProvider(key)}
              >
                {label}
              </Button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div style={{
              width: 20, height: 20,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => navigateMainApp('/insights/tokens')}
              style={{
                textAlign: 'center',
                padding: '8px 0 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                marginBottom: 8,
                cursor: 'pointer',
                borderRadius: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, color: '#6366f1' }}>
                {formatTokens(total)}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Total Tokens · 7 Days
              </div>
            </button>

            <Row label="Input" value={totals?.inputTokens ?? 0} color="#a5b4fc" />
            <Row label="Output" value={totals?.outputTokens ?? 0} color="#86efac" />
            <Row label="Cache Read" value={totals?.cacheReadTokens ?? 0} color="#7dd3fc" />
            <Row label="Cache Write" value={totals?.cacheCreationTokens ?? 0} color="#fcd34d" />
          </>
        )}
      </div>
    </main>
  );
}
