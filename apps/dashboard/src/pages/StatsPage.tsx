import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  AreaChart, Area, ResponsiveContainer,
} from 'recharts';
import { useAppDispatch, useAppSelector } from '../store/index.js';
import { fetchStats, fetchMetrics, fetchTags } from '../store/statsSlice.js';

/* ── Constants ── */

const TYPE_COLORS: Record<string, string> = {
  Decision: '#8b5cf6',
  Pattern: '#3b82f6',
  Fix: '#22c55e',
  Constraint: '#f59e0b',
  Gotcha: '#ef4444',
};

const PIE_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];

/** Skip refetch if data was loaded less than 30s ago */
const CACHE_TTL_MS = 30_000;

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

/* ── Main Page ── */

export function StatsPage() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const {
    stats, statsState,
    metrics, metricsState,
    tags, tagsState,
    lastFetchedAt,
  } = useAppSelector((s) => s.stats);

  useEffect(() => {
    // If data was fetched recently, show cached — refresh in background
    const isFresh = lastFetchedAt && (Date.now() - lastFetchedAt) < CACHE_TTL_MS;
    if (!isFresh) {
      dispatch(fetchStats());
      dispatch(fetchMetrics());
      dispatch(fetchTags());
    }
  }, [dispatch, lastFetchedAt]);

  // Derive widget states (show cached data while refreshing)
  const hasStats = stats !== null;
  const hasMetrics = metrics !== null;

  const effectiveStatsState: WidgetState =
    statsState === 'loading' && hasStats ? 'loaded' : statsState === 'idle' ? 'loading' : statsState;

  const effectiveMetricsState: WidgetState =
    metricsState === 'loading' && hasMetrics ? 'loaded' : metricsState === 'idle' ? 'loading' : metricsState;

  const effectiveTagsState: WidgetState =
    tagsState === 'loading' && tags.length > 0 ? 'loaded' : tagsState === 'idle' ? 'loading' : tagsState;

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{t('stats.title')}</h1>

      {/* ── Metric Cards Row ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <MetricCard
          label="Total Entries"
          value={stats?.total ?? 0}
          loading={!hasStats && statsState === 'loading'}
        />
        <MetricCard
          label="Last 24h"
          value={metrics?.activity.last24h ?? 0}
          sub="new entries"
          loading={!hasMetrics && metricsState === 'loading'}
        />
        <MetricCard
          label="Last 7 days"
          value={metrics?.activity.last7d ?? 0}
          sub="new entries"
          loading={!hasMetrics && metricsState === 'loading'}
        />
        <MetricCard
          label="Database Size"
          value={metrics?.database.sizeFormatted ?? '-'}
          sub={metrics?.database.path}
          loading={!hasMetrics && metricsState === 'loading'}
        />
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* Type Distribution */}
        <WidgetCard
          title="Knowledge by Type"
          state={
            effectiveMetricsState === 'loading'
              ? 'loading'
              : metrics && metrics.typeDistribution.length > 0
                ? 'loaded'
                : 'empty'
          }
        >
          {metrics && metrics.typeDistribution.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie
                    data={metrics.typeDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {metrics.typeDistribution.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {metrics.typeDistribution.map((entry, i) => (
                  <div
                    key={entry.name}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        backgroundColor:
                          TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length],
                      }}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                    <span style={{ fontWeight: 600 }}>{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </WidgetCard>

        {/* Scope Distribution */}
        <WidgetCard
          title="Knowledge by Scope"
          state={
            effectiveStatsState === 'loading'
              ? 'loading'
              : stats && stats.byScope.length > 0
                ? 'loaded'
                : 'empty'
          }
        >
          {stats && stats.byScope.length > 0 && (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.byScope} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="scope"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>
      </div>

      {/* ── Activity Chart ── */}
      <WidgetCard
        title="Activity (Last 15 Days)"
        state={
          effectiveMetricsState === 'loading'
            ? 'loading'
            : metrics && metrics.activityByDay.some((d) => d.count > 0)
              ? 'loaded'
              : 'empty'
        }
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

      {/* ── Contribution Heatmap ── */}
      <WidgetCard
        title="Contributions (Last 90 Days)"
        state={
          effectiveMetricsState === 'loading'
            ? 'loading'
            : metrics?.heatmap
              ? 'loaded'
              : 'empty'
        }
        style={{ marginBottom: 24 }}
      >
        {metrics?.heatmap && <ContributionHeatmap data={metrics.heatmap} />}
      </WidgetCard>

      {/* ── Tag Cloud ── */}
      <WidgetCard title={t('stats.tagCloud')} state={effectiveTagsState}>
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
