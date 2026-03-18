import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  AreaChart, Area, ResponsiveContainer,
} from 'recharts';
import { api } from '../api/client.js';

interface Stats {
  total: number;
  byType: { type: string; count: number }[];
  byScope: { scope: string; count: number }[];
}

interface Metrics {
  database: { sizeBytes: number; sizeFormatted: string; path: string };
  activity: { last24h: number; last7d: number; last30d: number; total: number };
  activityByDay: { date: string; count: number }[];
  heatmap: { date: string; count: number }[];
  typeDistribution: { name: string; value: number }[];
}

const TYPE_COLORS: Record<string, string> = {
  Decision: '#8b5cf6',
  Pattern: '#3b82f6',
  Fix: '#22c55e',
  Constraint: '#f59e0b',
  Gotcha: '#ef4444',
};

const PIE_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];

function getHeatmapColor(count: number, maxCount: number): string {
  if (count === 0) return 'var(--bg-input)';
  const intensity = Math.min(count / Math.max(maxCount, 1), 1);
  if (intensity <= 0.25) return '#1e1b4b';
  if (intensity <= 0.5) return '#4c1d95';
  if (intensity <= 0.75) return '#7c3aed';
  return '#8b5cf6';
}

function ContributionHeatmap({ data }: { data: { date: string; count: number }[] }) {
  const maxCount = Math.max(...data.map(d => d.count), 1);

  // Organize into weeks (columns) with days (rows, Mon-Sun)
  const weeks: { date: string; count: number; day: number }[][] = [];
  let currentWeek: { date: string; count: number; day: number }[] = [];

  for (const item of data) {
    const d = new Date(item.date);
    const day = d.getDay(); // 0=Sun, 6=Sat

    if (day === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push({ ...item, day });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  // Pad first week with empty cells
  if (weeks.length > 0) {
    const firstDay = weeks[0][0]?.day ?? 0;
    for (let i = 0; i < firstDay; i++) {
      weeks[0].unshift({ date: '', count: -1, day: i });
    }
  }

  const cellSize = 12;
  const gap = 3;
  const dayLabels = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];

  // Month labels
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
      {/* Month labels */}
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
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap, marginRight: 4, width: 24 }}>
          {dayLabels.map((label, i) => (
            <div key={i} style={{ height: cellSize, fontSize: 9, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
              {label}
            </div>
          ))}
        </div>

        {/* Grid */}
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
                    backgroundColor: cell.count < 0 ? 'transparent' : getHeatmapColor(cell.count, maxCount),
                    cursor: cell.count >= 0 ? 'pointer' : 'default',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, marginLeft: 28 }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginRight: 4 }}>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((level, i) => (
          <div key={i} style={{
            width: cellSize, height: cellSize, borderRadius: 2,
            backgroundColor: level === 0 ? 'var(--bg-input)' : getHeatmapColor(level * maxCount, maxCount),
          }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 4 }}>More</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-card)', borderRadius: 10,
      border: '1px solid var(--border)', padding: 16, flex: 1, minWidth: 140,
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let attempt = 0;
    const maxAttempts = 3;

    const loadData = () => {
      attempt++;
      Promise.allSettled([
        api.getStats(),
        api.getMetrics(),
        api.listTags(),
      ]).then(([statsRes, metricsRes, tagsRes]) => {
        if (statsRes.status === 'fulfilled') setStats(statsRes.value as Stats);
        if (metricsRes.status === 'fulfilled') setMetrics(metricsRes.value as Metrics);
        if (tagsRes.status === 'fulfilled') setTags(tagsRes.value as string[]);

        // If stats failed and we have retries left, try again
        if (statsRes.status === 'rejected' && attempt < maxAttempts) {
          setTimeout(loadData, 2000);
          return;
        }

        // Done — show whatever we have (or empty state)
        if (statsRes.status === 'rejected') {
          setStats({ total: 0, byType: [], byScope: [] });
        }
        setLoading(false);
      });
    };

    loadData();
  }, []);

  if (loading) return <p style={{ color: 'var(--text-secondary)', padding: 20 }}>Loading statistics...</p>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{t('stats.title')}</h1>

      {/* Metric Cards Row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <MetricCard label="Total Entries" value={stats.total} />
        <MetricCard label="Last 24h" value={metrics?.activity.last24h ?? '-'} sub="new entries" />
        <MetricCard label="Last 7 days" value={metrics?.activity.last7d ?? '-'} sub="new entries" />
        <MetricCard label="Database Size" value={metrics?.database.sizeFormatted ?? '-'} sub={metrics?.database.path} />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* Type Distribution Pie Chart */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Knowledge by Type</h3>
          {metrics && metrics.typeDistribution.length > 0 ? (
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
                      <Cell key={entry.name} fill={TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {metrics.typeDistribution.map((entry, i) => (
                  <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: TYPE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                    <span style={{ fontWeight: 600 }}>{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No data yet</p>
          )}
        </div>

        {/* Scope Distribution Bar Chart */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Knowledge by Scope</h3>
          {stats.byScope.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.byScope} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="scope" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} width={80} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No data yet</p>
          )}
        </div>
      </div>

      {/* Activity Chart (last 15 days) */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Activity (Last 15 Days)</h3>
        {metrics && metrics.activityByDay.some(d => d.count > 0) ? (
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
                contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => `Date: ${v}`}
              />
              <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="url(#colorActivity)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No activity in the last 15 days</p>
        )}
      </div>

      {/* Contribution Heatmap (last 90 days) */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Contributions (Last 90 Days)</h3>
        {metrics ? <ContributionHeatmap data={metrics.heatmap} /> : <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</p>}
      </div>

      {/* Tag Cloud */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{t('stats.tagCloud')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tags.length > 0 ? tags.map((tag, i) => (
            <span key={tag} style={{
              backgroundColor: 'var(--bg-input)', color: 'var(--accent)',
              padding: '4px 12px', borderRadius: 14,
              fontSize: 11 + (i % 3) * 3, fontWeight: i % 2 === 0 ? 600 : 400,
            }}>
              {tag}
            </span>
          )) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No tags yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
