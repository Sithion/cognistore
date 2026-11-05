import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client.js';
import { useAppDispatch, useAppSelector } from '../store/index.js';
import { fetchStats, fetchMetrics } from '../store/statsSlice.js';
import { DateRangeControl } from '../components/DateRangeControl.js';
import { ChartPanel, MetricCard } from '../insights/ChartPanel.js';
import { useInsightsRoute } from '../insights/useInsightsRoute.js';
import { dateAxisProps } from '../utils/chartAxis.js';

const COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const PLAN_COLORS: Record<string, string> = { Draft: '#6b7280', Active: '#3b82f6', Completed: '#22c55e', Archived: '#a78bfa' };
const TASK_COLORS: Record<string, string> = { Pending: '#6b7280', 'In Progress': '#3b82f6', Completed: '#22c55e' };
const fmt = (n: number) => new Intl.NumberFormat().format(Number.isFinite(n) ? n : 0);
const median = (values: number[]) => { const xs = [...values].sort((a, b) => a - b); return xs.length ? (xs[Math.floor((xs.length - 1) / 2)] + xs[Math.floor(xs.length / 2)]) / 2 : 0; };
const scopeNotice = (scope: string, endpoints: string) => scope ? `Scope “${scope}” is present in the URL, but ${endpoints} do not accept a scope filter. These charts show all scopes.` : undefined;

type OverviewData = {
  activity: { date: string; reads: number; writes: number }[];
  topTags: { tag: string; count: number }[];
  tagCount: number;
  byType: { type: string; count: number }[];
  byScope: { scope: string; count: number }[];
  byAgent: { agent: string; count: number }[];
  byPlatform: { platform: string; count: number }[];
};

function useOverview() {
  const range = useAppSelector((s) => s.dateRange.range);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      const r = { from: range.from, to: range.to };
      const [activity, topTags, tags, byType, byScope, agents, platforms] = await Promise.all([
        api.getActivity(r.from, r.to), api.getTopTags(10, r), api.listTags(r), api.getByType(r), api.getByScope(r), api.getByAgent(r), api.getByPlatform(r),
      ]);
      setData({ activity: activity.operationsByDay, topTags, tagCount: tags.length, byType, byScope, byAgent: agents, byPlatform: platforms });
    } catch { setError(true); }
  }, [range.from, range.to]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

export function ClickableBars({ data, dataKey, nameKey, color, destinationKey }: { data: { name: string; value: number }[]; dataKey: string; nameKey: string; color: string; destinationKey: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const ranked = [...data].sort((a, b) => b.value - a.value);
  const go = (value: string) => navigate(`/knowledge?${destinationKey}=${encodeURIComponent(value)}`);
  return <div className="space-y-3">
    <div role="img" aria-label={`${data.length} categories. ${data.map((d) => `${d.name}: ${fmt(d.value)}`).join(', ')}`} className="h-56">
      <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 18, right: 14 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} /> <XAxis type="number" hide /><YAxis type="category" dataKey={nameKey} width={100} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => fmt(Number(value))} /><Bar dataKey={dataKey} fill={color} radius={[0, 5, 5, 0]} />
      </BarChart></ResponsiveContainer>
    </div>
    <ul className="flex flex-wrap gap-2">{(expanded ? ranked : ranked.slice(0, 8)).map((item) => <li key={item.name}><button className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => go(item.name)}>{item.name} <span className="ml-1 font-mono tabular-nums">{fmt(item.value)}</span></button></li>)}</ul>
    {data.length > 8 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? t('stats.showLess') : t('stats.showAll', { count: data.length })}</button>}
  </div>;
}

export function StatsPage() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { stats, isRefreshing } = useAppSelector((s) => s.stats);
  const { scope } = useInsightsRoute();
  const { data, error, load } = useOverview();
  useEffect(() => { dispatch(fetchStats()); dispatch(fetchMetrics()); }, [dispatch]);
  const activity = data?.activity ?? [];
  const totalReads = activity.reduce((sum, d) => sum + d.reads, 0);
  const totalWrites = activity.reduce((sum, d) => sum + d.writes, 0);
  const activitySeries = activity.map((d) => ({ ...d, total: d.reads + d.writes }));
  const notice = scopeNotice(scope, '/api/metrics/activity, /api/metrics/top-tags, /api/tags, /api/metrics/by-type, /api/metrics/by-scope, /api/metrics/by-agent and /api/metrics/by-platform');
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{t('statsTitle.knowledge')}</h1><p className="text-sm text-muted-foreground">{isRefreshing ? t('stats.loading') : t('stats.thisPeriod')}</p></div><DateRangeControl /></header>
    {notice && <p role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap gap-3"><MetricCard label={t('stats.totalEntries')} value={fmt(stats?.total ?? 0)} detail={t('stats.totalEntries')} /><MetricCard label={t('stats.consulted')} value={fmt(totalReads)} detail={t('stats.consultedSub')} /><MetricCard label={t('stats.written')} value={fmt(totalWrites)} detail={t('stats.writtenSub')} /></div>
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartPanel title={`${t('stats.knowledgeByType')} ${t('stats.thisPeriod')}`} state={error ? 'error' : !data ? 'loading' : data.byType.length ? 'ready' : 'empty'} onRetry={load} summary={data ? `Knowledge by type: ${data.byType.map((x) => `${x.type} ${fmt(x.count)}`).join(', ')}` : undefined}><ClickableBars data={(data?.byType ?? []).map((x) => ({ name: x.type || 'Unknown', value: x.count }))} nameKey="name" dataKey="value" color="#8b5cf6" destinationKey="type" /></ChartPanel>
      <ChartPanel title={`${t('stats.knowledgeByScope')} ${t('stats.thisPeriod')}`} state={error ? 'error' : !data ? 'loading' : data.byScope.length ? 'ready' : 'empty'} onRetry={load} summary={data ? `Knowledge by scope: ${data.byScope.map((x) => `${x.scope} ${fmt(x.count)}`).join(', ')}` : undefined}><ClickableBars data={(data?.byScope ?? []).map((x) => ({ name: x.scope, value: x.count }))} nameKey="name" dataKey="value" color="#3b82f6" destinationKey="scope" /></ChartPanel>
      <ChartPanel title={`${t('stats.knowledgeByAgent')} ${t('stats.thisPeriod')}`} state={error ? 'error' : !data ? 'loading' : data.byAgent.length ? 'ready' : 'empty'} onRetry={load}><ClickableBars data={(data?.byAgent ?? []).map((x) => ({ name: x.agent, value: x.count }))} nameKey="name" dataKey="value" color="#06b6d4" destinationKey="agent" /></ChartPanel>
      <ChartPanel title={`${t('stats.knowledgeByPlatform')} ${t('stats.thisPeriod')}`} state={error ? 'error' : !data ? 'loading' : data.byPlatform.length ? 'ready' : 'empty'} onRetry={load}><ClickableBars data={(data?.byPlatform ?? []).map((x) => ({ name: x.platform, value: x.count }))} nameKey="name" dataKey="value" color="#ec4899" destinationKey="platform" /></ChartPanel>
    </div>
    <ChartPanel title={t('stats.activity')} state={error ? 'error' : !data ? 'loading' : activity.some((d) => d.reads + d.writes > 0) ? 'ready' : 'empty'} onRetry={load} summary={`Activity: ${fmt(totalReads)} reads and ${fmt(totalWrites)} writes.`}>
      <div role="img" aria-label={`Daily knowledge activity, ${fmt(totalReads)} reads and ${fmt(totalWrites)} writes`} className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={activitySeries}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" {...dateAxisProps(activitySeries.length)} /><YAxis hide /><Tooltip /><Legend /><Area type="monotone" dataKey="reads" name={t('stats.consultedLine')} stroke="#3b82f6" fill="#3b82f620" /><Area type="monotone" dataKey="writes" name={t('stats.writtenLine')} stroke="#22c55e" fill="#22c55e20" /></AreaChart></ResponsiveContainer></div>
    </ChartPanel>
    <ChartPanel title={`${t('stats.topTags')} ${t('stats.thisPeriod')}`} state={error ? 'error' : !data ? 'loading' : data.topTags.length ? 'ready' : 'empty'} onRetry={load} description={`${fmt(data?.tagCount ?? 0)} ${t('stats.distinctTags')}`} summary={data ? `Top tags: ${data.topTags.map((x) => `${x.tag} ${fmt(x.count)}`).join(', ')}` : undefined}>
      <ClickableBars data={(data?.topTags ?? []).map((x) => ({ name: x.tag, value: x.count }))} nameKey="name" dataKey="value" color="#8b5cf6" destinationKey="tag" />
      <p className="mt-2 text-xs text-muted-foreground">Median: <span className="font-mono tabular-nums">{fmt(median(data?.topTags.map((x) => x.count) ?? []))}</span></p>
    </ChartPanel>
  </div>;
}

export function PlanStatsPage() {
  const { t } = useTranslation();
  const { range, scope } = useInsightsRoute();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getPlanMetrics>> | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => { setError(false); api.getPlanMetrics(range.from, range.to).then(setData).catch(() => setError(true)); }, [range.from, range.to]);
  useEffect(() => { void load(); }, [load]);
  const p = data?.plans;
  const tasks = data?.tasks;
  const planDistribution = p ? [{ name: 'Draft', value: p.draft }, { name: 'Active', value: p.active }, { name: 'Completed', value: p.completed }, { name: 'Archived', value: p.archived }].filter((x) => x.value > 0) : [];
  const taskDistribution = tasks ? [{ name: 'Pending', value: tasks.pending }, { name: 'In Progress', value: tasks.inProgress }, { name: 'Completed', value: tasks.completed }].filter((x) => x.value > 0) : [];
  const notice = scopeNotice(scope, '/api/metrics/plans');
  return <div className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">{t('statsTitle.plans')}</h1><DateRangeControl /></header>
    {notice && <p role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">{notice}</p>}
    {data && <div className="flex flex-wrap gap-3"><MetricCard label={t('stats.totalPlans')} value={fmt(p?.total ?? 0)} /><MetricCard label={t('stats.activePlans')} value={fmt(p?.active ?? 0)} /><MetricCard label={t('stats.completedPlans')} value={fmt(p?.completed ?? 0)} /><MetricCard label={t('stats.avgTasksPerPlan')} value={fmt(tasks?.avgPerPlan ?? 0)} /></div>}
    <div className="grid gap-4 xl:grid-cols-2"><ChartPanel title={t('stats.planStatus')} state={error ? 'error' : !data ? 'loading' : planDistribution.length ? 'ready' : 'empty'} onRetry={load} summary={`Plans by status: ${planDistribution.map((x) => `${x.name} ${fmt(x.value)}`).join(', ')}`}><div role="img" aria-label={`Plan status: ${planDistribution.map((x) => `${x.name} ${x.value}`).join(', ')}`} className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={planDistribution} dataKey="value" nameKey="name" innerRadius={62} outerRadius={95}>{planDistribution.map((x) => <Cell key={x.name} fill={PLAN_COLORS[x.name]} />)}</Pie><Tooltip formatter={(v) => fmt(Number(v))} /><Legend /></PieChart></ResponsiveContainer></div></ChartPanel>
      <ChartPanel title={t('stats.taskStatus')} state={error ? 'error' : !data ? 'loading' : taskDistribution.length ? 'ready' : 'empty'} onRetry={load} summary={`Tasks by status: ${taskDistribution.map((x) => `${x.name} ${fmt(x.value)}`).join(', ')}`}><div role="img" aria-label={`Task status: ${taskDistribution.map((x) => `${x.name} ${x.value}`).join(', ')}`} className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={taskDistribution} dataKey="value" nameKey="name" innerRadius={62} outerRadius={95}>{taskDistribution.map((x) => <Cell key={x.name} fill={TASK_COLORS[x.name]} />)}</Pie><Tooltip formatter={(v) => fmt(Number(v))} /><Legend /></PieChart></ResponsiveContainer></div></ChartPanel></div>
    <ChartPanel title={t('stats.plansActivity')} state={error ? 'error' : !data ? 'loading' : data.plansByDay.some((x) => x.count > 0) ? 'ready' : 'empty'} onRetry={load} summary={`Daily created plans: ${data?.plansByDay.map((x) => `${x.date} ${fmt(x.count)}`).join(', ') ?? ''}`}><div role="img" aria-label="Plans created per day" className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data?.plansByDay ?? []}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" {...dateAxisProps(data?.plansByDay.length ?? 0)} /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f620" /></AreaChart></ResponsiveContainer></div></ChartPanel>
  </div>;
}
