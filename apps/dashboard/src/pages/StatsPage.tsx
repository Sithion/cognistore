import { useEffect, useRef, useState, useCallback, type ReactNode, type CSSProperties } from 'react';
import { api } from '../api/client.js';
import { useTranslation } from 'react-i18next';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  AreaChart, Area, ResponsiveContainer,
} from 'recharts';
import { useAppDispatch, useAppSelector } from '../store/index.js';
import { fetchStats, fetchMetrics, fetchTags, setRefreshInterval, REFRESH_OPTIONS, type RefreshInterval } from '../store/statsSlice.js';

/* ── Constants ── */

const TYPE_COLORS: Record<string, string> = {
  Decision: '#8b5cf6',
  Pattern: '#3b82f6',
  Fix: '#22c55e',
  Constraint: '#f59e0b',
  Gotcha: '#ef4444',
};

const PIE_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];
const SCOPE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

const POLL_INTERVAL_MS = 10_000;

/* ── Spinner ── */

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div
        style={{
          width: size,
          height: size,
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

/* ── Widget Card ── */

type WidgetState = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

function WidgetCard({
  title,
  state,
  children,
  emptyText = 'No data yet',
  errorText = 'Failed to load',
  style,
}: {
  title: string;
  state: WidgetState;
  children: ReactNode;
  emptyText?: string;
  errorText?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        padding: 20,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h3>
      </div>
      {state === 'loading' && !children && <Spinner />}
      {state === 'error' && (
        <p style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', padding: 16 }}>{errorText}</p>
      )}
      {state === 'empty' && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 16 }}>{emptyText}</p>
      )}
      {(state === 'loaded' || (state === 'loading' && children)) && children}
    </div>
  );
}

/* ── Metric Card ── */

function MetricCard({
  label,
  value,
  sub,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        padding: 16,
        flex: 1,
        minWidth: 140,
      }}
    >
      <p
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 4,
        }}
      >
        {label}
      </p>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
          <div
            style={{
              width: 18,
              height: 18,
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        </div>
      ) : (
        <>
          <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{value}</p>
          {sub && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</p>
          )}
        </>
      )}
    </div>
  );
}

/* ── Heatmap ── */

function getHeatmapColor(count: number, maxCount: number): string {
  if (count === 0) return 'var(--bg-input)';
  const intensity = Math.min(count / Math.max(maxCount, 1), 1);
  if (intensity <= 0.25) return '#1e1b4b';
  if (intensity <= 0.5) return '#4c1d95';
  if (intensity <= 0.75) return '#7c3aed';
  return '#8b5cf6';
}

function ContributionHeatmap({ data }: { data: { date: string; count: number }[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const weeks: { date: string; count: number; day: number }[][] = [];
  let currentWeek: { date: string; count: number; day: number }[] = [];

  for (const item of data) {
    const d = new Date(item.date);
    const day = d.getDay();
    if (day === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push({ ...item, day });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  if (weeks.length > 0) {
    const firstDay = weeks[0][0]?.day ?? 0;
    for (let i = 0; i < firstDay; i++) {
      weeks[0].unshift({ date: '', count: -1, day: i });
    }
  }

  const cellSize = 12;
  const gap = 3;
  const dayLabels = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];

  const monthLabels: { label: string; col: number }[] = [];
  let lastMonth = '';
  for (let w = 0; w < weeks.length; w++) {
    for (const cell of weeks[w]) {
      if (cell.date) {
        const month = cell.date.slice(0, 7);
        if (month !== lastMonth) {
          const d = new Date(cell.date);
          monthLabels.push({ label: d.toLocaleString('en', { month: 'short' }), col: w });
          lastMonth = month;
        }
        break;
      }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', marginLeft: 28, marginBottom: 4, gap: 0 }}>
        {monthLabels.map((m, i) => (
          <span
            key={i}
            style={{
              fontSize: 10,
              color: 'var(--text-secondary)',
              position: 'relative',
              left: m.col * (cellSize + gap),
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap, marginRight: 4, width: 24 }}>
          {dayLabels.map((label, i) => (
            <div
              key={i}
              style={{
                height: cellSize,
                fontSize: 9,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {label}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap }}>
              {week.map((cell, di) => (
                <div
                  key={di}
                  title={cell.count >= 0 ? `${cell.date}: ${cell.count} entries` : ''}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 2,
                    backgroundColor:
                      cell.count < 0 ? 'transparent' : getHeatmapColor(cell.count, maxCount),
                    cursor: cell.count >= 0 ? 'pointer' : 'default',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, marginLeft: 28 }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginRight: 4 }}>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((level, i) => (
          <div
            key={i}
            style={{
              width: cellSize,
              height: cellSize,
              borderRadius: 2,
              backgroundColor:
                level === 0 ? 'var(--bg-input)' : getHeatmapColor(level * maxCount, maxCount),
            }}
          />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 4 }}>More</span>
      </div>
    </div>
  );
}

/* ── Responsive Chart Wrappers ── */

const CHART_MIN_WIDTH = 300;

function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, width };
}

function TypeDistribution({ data }: { data: { name: string; value: number }[] }) {
  const { ref, width } = useContainerWidth();
  const maxVal = Math.max(...data.map(d => d.value));

  return (
    <div ref={ref}>
      {width >= CHART_MIN_WIDTH ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ResponsiveContainer width="50%" height={180}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                {data.map((entry, i) => (
                  <Cell key={entry.name} fill={TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.map((entry, i) => (
              <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length] }} />
                <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                <span style={{ fontWeight: 600 }}>{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((entry, i) => (
            <div key={entry.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.name}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{entry.value}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--bg-input)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${(entry.value / maxVal) * 100}%`, backgroundColor: TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeDistribution({ data }: { data: { scope: string; count: number }[] }) {
  const { ref, width } = useContainerWidth();
  const pieData = data.map(d => ({ name: d.scope, value: d.count }));
  const maxVal = Math.max(...data.map(d => d.count));

  return (
    <div ref={ref}>
      {width >= CHART_MIN_WIDTH ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ResponsiveContainer width="50%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                {pieData.map((entry, i) => (
                  <Cell key={entry.name} fill={SCOPE_COLORS[i % SCOPE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pieData.map((entry, i) => (
              <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: SCOPE_COLORS[i % SCOPE_COLORS.length] }} />
                <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                <span style={{ fontWeight: 600 }}>{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((entry, i) => (
            <div key={entry.scope}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: SCOPE_COLORS[i % SCOPE_COLORS.length] }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.scope}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{entry.count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--bg-input)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${(entry.count / maxVal) * 100}%`, backgroundColor: SCOPE_COLORS[i % SCOPE_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopTagsChart({ data }: { data: { tag: string; count: number }[] }) {
  const { ref, width } = useContainerWidth();
  const maxVal = Math.max(...data.map(d => d.count));

  return (
    <div ref={ref}>
      {width >= CHART_MIN_WIDTH ? (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 28)}>
          <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="tag" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={80} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }} />
            <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((entry) => (
            <div key={entry.tag}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.tag}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{entry.count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--bg-input)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${(entry.count / maxVal) * 100}%`, backgroundColor: '#8b5cf6' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */

export function StatsPage() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTotalRef = useRef<number | null>(null);

  const {
    stats, statsState,
    metrics, metricsState,
    tags, tagsState,
    lastFetchedAt,
    isRefreshing,
    refreshInterval,
  } = useAppSelector((s) => s.stats);

  const [topTags, setTopTags] = useState<{ tag: string; count: number }[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<string | null>(null);

  const loadTopTags = useCallback(() => {
    api.getTopTags(10).then(setTopTags).catch(() => {});
  }, []);

  const refreshAll = useCallback(() => {
    dispatch(fetchStats());
    dispatch(fetchMetrics());
    dispatch(fetchTags());
    loadTopTags();
  }, [dispatch, loadTopTags]);

  // Initial fetch
  useEffect(() => {
    const hasCached = stats !== null || metrics !== null;
    if (!hasCached) {
      refreshAll();
    } else {
      // Background refresh if data exists
      refreshAll();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh interval (from Redux selector)
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(refreshAll, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, refreshAll]);

  // Poll for new entries — refresh all stats when total count changes
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await api.getStats() as { total: number };
        if (lastTotalRef.current !== null && data.total !== lastTotalRef.current) {
          refreshAll();
        }
        lastTotalRef.current = data.total;
      } catch { /* ignore polling errors */ }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Never show blocking loading — always treat as loaded or empty
  const hasTypeData = metrics && metrics.typeDistribution.length > 0;
  const hasScopeData = stats && stats.byScope.length > 0;
  const hasActivityData = metrics && metrics.activityByDay.some((d) => d.count > 0);
  const hasHeatmap = metrics?.heatmap;
  const hasTags = tags.length > 0;

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Header with refresh controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('stats.title')}</h1>
          {isRefreshing && (
            <div
              style={{
                width: 14,
                height: 14,
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Refresh interval selector */}
          <div style={{ display: 'flex', gap: 2, backgroundColor: 'var(--bg-input)', borderRadius: 6, padding: 2 }}>
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => dispatch(setRefreshInterval(opt.value as RefreshInterval))}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: refreshInterval === opt.value ? 600 : 400,
                  backgroundColor: refreshInterval === opt.value ? 'var(--accent)' : 'transparent',
                  color: refreshInterval === opt.value ? 'white' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Manual refresh button */}
          <button
            onClick={refreshAll}
            disabled={isRefreshing}
            title="Refresh now"
            style={{
              padding: '4px 10px',
              fontSize: 13,
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              opacity: isRefreshing ? 0.5 : 1,
            }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Metric Cards Row ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <MetricCard label="Total Entries" value={stats?.total ?? 0} />
        <MetricCard label="Last 24h" value={metrics?.activity.last24h ?? 0} sub="new entries" />
        <MetricCard label="Last 7 days" value={metrics?.activity.last7d ?? 0} sub="new entries" />
        <div style={{ flex: 1, minWidth: 140, position: 'relative' }}>
          <MetricCard label="Database Size" value={metrics?.database.sizeFormatted ?? '-'} sub={metrics?.database.path} />
          <button
            onClick={async () => {
              setCleaning(true);
              setCleanResult(null);
              try {
                const result = await api.cleanupDatabase();
                setCleanResult(result.orphansRemoved > 0 ? `${result.orphansRemoved} cleaned` : t('stats.cacheClean'));
                refreshAll();
              } catch { setCleanResult('Error'); }
              setCleaning(false);
              setTimeout(() => setCleanResult(null), 3000);
            }}
            disabled={cleaning}
            style={{
              position: 'absolute', top: 8, right: 8,
              padding: '3px 8px', fontSize: 10, fontWeight: 600,
              backgroundColor: cleanResult ? 'var(--success)' : 'var(--bg-input)',
              color: cleanResult ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 4,
              cursor: cleaning ? 'not-allowed' : 'pointer',
              opacity: cleaning ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            {cleaning ? '...' : cleanResult ?? t('stats.cleanCache')}
          </button>
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* Type Distribution */}
        <WidgetCard title="Knowledge by Type" state={hasTypeData ? 'loaded' : 'empty'}>
          {metrics && metrics.typeDistribution.length > 0 && (
            <TypeDistribution data={metrics.typeDistribution} />
          )}
        </WidgetCard>

        {/* Scope Distribution */}
        <WidgetCard title="Knowledge by Scope" state={hasScopeData ? 'loaded' : 'empty'}>
          {stats && stats.byScope.length > 0 && (
            <ScopeDistribution data={stats.byScope} />
          )}
        </WidgetCard>
      </div>

      {/* ── Activity Chart ── */}
      <WidgetCard
        title="Activity (Last 15 Days)"
        state={hasActivityData ? 'loaded' : 'empty'}
        emptyText="No activity in the last 15 days"
        style={{ marginBottom: 24 }}
      >
        {metrics && metrics.activityByDay.some((d) => d.count > 0) && (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={metrics.activityByDay}>
              <defs>
                <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--text-primary)',
                }}
                labelFormatter={(v) => `Date: ${v}`}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#8b5cf6"
                fill="url(#colorActivity)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      {/* ── Contribution Heatmap + Top Tags ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <WidgetCard
          title="Contributions (Last 90 Days)"
          state={hasHeatmap ? 'loaded' : 'empty'}
        >
          {metrics?.heatmap && <ContributionHeatmap data={metrics.heatmap} />}
        </WidgetCard>

        <WidgetCard
          title="Top Tags"
          state={topTags.length > 0 ? 'loaded' : 'empty'}
          emptyText="No tags yet"
        >
          {topTags.length > 0 && <TopTagsChart data={topTags} />}
        </WidgetCard>
      </div>

      {/* ── Tag Cloud ── */}
      <WidgetCard title={t('stats.tagCloud')} state={hasTags ? 'loaded' : 'empty'}>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tags.map((tag, i) => (
              <span
                key={tag}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--accent)',
                  padding: '4px 12px',
                  borderRadius: 14,
                  fontSize: 11 + (i % 3) * 3,
                  fontWeight: i % 2 === 0 ? 600 : 400,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </WidgetCard>
    </div>
  );
}
