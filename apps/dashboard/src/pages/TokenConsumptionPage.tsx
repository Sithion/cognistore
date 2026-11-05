import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, PROVIDER_SOURCE, SOURCE_TO_PROVIDER, type ProviderFilter, type TokenUsageAggregates } from '../api/client.js';
import { DateRangeControl } from '../components/DateRangeControl.js';
import { ChartPanel, MetricCard } from '../insights/ChartPanel.js';
import { chartTooltipProps } from '../insights/ChartTooltip.js';
import { ScreenState } from '../navigation/ScreenState.js';
import { useInsightsRoute } from '../insights/useInsightsRoute.js';
import { dateAxisProps } from '../utils/chartAxis.js';
import { registerInsightsResources } from '../i18n/round8-insights.js';

const COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const PROVIDERS: { key: ProviderFilter; labelKey: string }[] = [{ key: 'all', labelKey: 'tokens.all' }, { key: 'claude', labelKey: 'tokens.claude' }, { key: 'copilot', labelKey: 'tokens.copilot' }];
const number = (value: number) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);
const totalOf = (v: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) => v.inputTokens + v.outputTokens + v.cacheReadTokens + v.cacheCreationTokens;
const heatColor = (value: number, max: number) => value <= 0 || max <= 0 ? 'hsl(var(--muted))' : `hsl(263 70% ${Math.max(28, 78 - Math.round(value / max * 48))}%)`;

registerInsightsResources();

function PlatformLabel({ sources }: { sources: string }) {
  const providers = Array.from(new Set(sources.split(',').map((s) => SOURCE_TO_PROVIDER[s.trim()]).filter(Boolean)));
  return <span>{providers.length ? providers.join(', ') : 'Unknown'}</span>;
}

export function TokenConsumptionPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { range, scope, provider: urlProvider, patch } = useInsightsRoute();
  const [data, setData] = useState<TokenUsageAggregates | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const [retentionDays, setRetentionDays] = useState(90);
  const [hydrated, setHydrated] = useState(false);
  const dayLabels = useMemo(() => Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + d)))), [i18n.language]);

  useEffect(() => {
    api.getSettings().then((settings) => {
      const configured = settings.tokenProviderFilter ?? 'all';
      const validUrl = PROVIDERS.some((option) => option.key === urlProvider);
      setProvider(validUrl ? urlProvider as ProviderFilter : configured);
      const days = settings.tokenUsageRetentionDays;
      setRetentionDays(typeof days === 'number' && Number.isFinite(days) && days >= 0 ? days : 90);
    }).catch(() => {}).finally(() => setHydrated(true));
  // Hydrate persisted preference once; URL filter takes precedence.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!hydrated) return;
    setLoading(true); setError(false);
    try { setData(await api.getTokenUsage({ from: range.from, to: range.to, source: PROVIDER_SOURCE[provider] })); }
    catch { setData(null); setError(true); }
    finally { setLoading(false); }
  }, [hydrated, range.from, range.to, provider]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!hydrated || error || loading || scanning) return;
    const timer = setInterval(() => { void api.getTokenUsage({ from: range.from, to: range.to, source: PROVIDER_SOURCE[provider] }).then((fresh) => {
      if (JSON.stringify(fresh.totals) !== JSON.stringify(data?.totals) || fresh.byDay.length !== data?.byDay.length) setData(fresh);
    }).catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [data, error, hydrated, loading, provider, range.from, range.to, scanning]);

  const selectProvider = (value: ProviderFilter) => {
    setProvider(value); patch('provider', value === 'all' ? null : value);
    void api.updateSettings({ tokenProviderFilter: value }).catch(() => {});
  };
  const rescan = async () => { setScanning(true); try { await api.scanTokenUsage(); await load(); } finally { setScanning(false); } };
  const totals = data?.totals ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const daily = (data?.byDay ?? []).map((day) => ({ date: day.date, input: day.inputTokens, output: day.outputTokens, cacheRead: day.cacheReadTokens, cacheWrite: day.cacheCreationTokens, total: totalOf(day) }));
  const hasTokens = totalOf(totals) > 0;
  const lookup = new Map((data?.byHourDay ?? []).map((cell) => [`${cell.dayOfWeek}-${cell.hour}`, cell.totalTokens]));
  const maxHeat = Math.max(0, ...(data?.byHourDay ?? []).map((cell) => cell.totalTokens));
  const failureProps = { onRetry: load };
  const commonState = error ? 'error' as const : loading ? 'loading' as const : 'ready' as const;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{t('tokens.title')}</h1><p className="text-sm text-muted-foreground">{t('tokens.subtitle')}</p></div><div className="flex flex-wrap items-center gap-3"><fieldset aria-label="Provider" className="m-0 flex min-w-0 gap-1 border-0 p-0">{PROVIDERS.map(({ key, labelKey }) => <button key={key} type="button" aria-pressed={provider === key} onClick={() => selectProvider(key)} className={`rounded-md border px-3 py-1.5 text-xs ${provider === key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>{t(labelKey)}</button>)}</fieldset><DateRangeControl /><button type="button" onClick={rescan} disabled={scanning} className="rounded-md border px-3 py-1.5 text-xs">{scanning ? t('tokens.rescanning') : t('tokens.rescan')}</button></div></header>
    {scope && <p role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">Scope “{scope}” is present in the URL, but `/api/token-usage` accepts date range and provider, model, or project filters only; it has no scope parameter. Token totals and charts below include all scopes.</p>}
    {error ? <ScreenState state="error" title={t('tokens.title')} description="Could not load token usage. Retry to load the charts." onRetry={load} /> : <>
    <div className="flex flex-wrap gap-3"><MetricCard label={t('tokens.input')} value={number(totals.inputTokens)} /><MetricCard label={t('tokens.output')} value={number(totals.outputTokens)} /><MetricCard label={t('tokens.cacheRead')} value={number(totals.cacheReadTokens)} /><MetricCard label={t('tokens.cacheWrite')} value={number(totals.cacheCreationTokens)} /></div>
    <p data-testid="retention-notice" className="text-sm text-muted-foreground"><Trans i18nKey="insights.retention" values={{ days: retentionDays === 0 ? t('insights.unlimited') : t('insights.days', { count: retentionDays }) }} components={{ settingsLink: <Link data-testid="retention-link" to="/settings/telemetry" className="underline underline-offset-4" /> }} /></p>
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]"><ChartPanel title={t('tokens.activity')} state={commonState} emptyText={t('tokens.noData')} {...failureProps} summary={`Daily totals across ${daily.length} days; ${number(daily.reduce((sum, d) => sum + d.total, 0))} tokens.`}><div role="img" aria-label={`Daily token totals across ${daily.length} days`} className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" {...dateAxisProps(daily.length)} /><YAxis hide /><Tooltip {...chartTooltipProps('area', number)} /><Legend /><Area type="monotone" stackId="tokens" dataKey="input" name={t('tokens.input')} stroke="#8b5cf6" fill="#8b5cf640" /><Area type="monotone" stackId="tokens" dataKey="output" name={t('tokens.output')} stroke="#3b82f6" fill="#3b82f640" /><Area type="monotone" stackId="tokens" dataKey="cacheRead" name={t('tokens.cacheRead')} stroke="#22c55e" fill="#22c55e40" /><Area type="monotone" stackId="tokens" dataKey="cacheWrite" name={t('tokens.cacheWrite')} stroke="#f59e0b" fill="#f59e0b40" /></AreaChart></ResponsiveContainer></div><div className="mt-2 flex flex-wrap gap-1">{daily.map((d) => <button key={d.date} type="button" onClick={() => navigate(`/insights/tokens?${new URLSearchParams({ preset: 'custom', from: `${d.date}T00:00:00.000Z`, to: `${d.date}T23:59:59.999Z`, ...(scope ? { scope } : {}), ...(provider !== 'all' ? { provider } : {}) })}`)} className="rounded border px-2 py-1 text-xs focus-visible:ring-2">{d.date} · {number(d.total)}</button>)}</div></ChartPanel>
      <ChartPanel title={t('tokens.models')} state={commonState === 'ready' ? data?.byModel.length ? 'ready' : 'empty' : commonState} emptyText={t('tokens.noData')} {...failureProps} summary={`Top models: ${(data?.byModel ?? []).slice(0, 7).map((x) => `${x.model} ${number(x.totalTokens)}`).join(', ')}`}><div role="img" aria-label={`Model totals: ${(data?.byModel ?? []).slice(0, 7).map((x) => `${x.model} ${x.totalTokens}`).join(', ')}`} className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={(data?.byModel ?? []).slice(0, 7)} layout="vertical" margin={{ left: 12, right: 12 }}><XAxis type="number" hide /><YAxis type="category" dataKey="model" width={90} tick={{ fontSize: 11 }} /><Tooltip {...chartTooltipProps('bar', number)} /><Bar dataKey="totalTokens" fill="#8b5cf6" radius={[0, 5, 5, 0]}>{(data?.byModel ?? []).slice(0, 7).map((x, i) => <Cell key={x.model} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div></ChartPanel></div>
    <div className="grid gap-4 xl:grid-cols-2"><ChartPanel title={t('tokens.cacheEfficiency')} state={commonState} {...failureProps} summary={`Cache efficiency ${Math.round((data?.cacheEfficiency ?? 0) * 100)} percent.`}><div className="flex h-40 items-center justify-center"><p className="font-mono text-5xl font-semibold tabular-nums">{Math.round((data?.cacheEfficiency ?? 0) * 100)}%</p></div></ChartPanel>
      <ChartPanel title={t('tokens.timeOfDay')} description="Aggregated by UTC weekday and hour; bounded heatmap summary." state={commonState === 'ready' ? data?.byHourDay.length ? 'ready' : 'empty' : commonState} emptyText={t('tokens.noData')} {...failureProps} summary={`UTC heatmap, ${data?.byHourDay.length ?? 0} populated weekday-hour cells.`}><div className="overflow-x-auto"><div className="min-w-[670px]"><div className="mb-1 flex gap-1 pl-10">{Array.from({ length: 24 }, (_, h) => <span key={h} className="w-5 text-center text-[9px] text-muted-foreground">{h % 6 === 0 ? h : ''}</span>)}</div>{dayLabels.map((label, day) => <div key={label} className="mb-1 flex items-center gap-1"><span className="w-9 text-xs text-muted-foreground">{label}</span>{Array.from({ length: 24 }, (_, hour) => { const value = lookup.get(`${day}-${hour}`) ?? 0; return <button key={hour} type="button" aria-label={`${label} ${hour}:00 UTC: ${number(value)} tokens`} title={`${label} ${hour}:00 UTC — ${number(value)} tokens`} onClick={() => patch('hour', `${day}-${hour}`)} className="size-5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring" style={{ backgroundColor: heatColor(value, maxHeat) }} />; })}</div>)}</div></div></ChartPanel></div>
    <ChartPanel title={t('tokens.topProjects')} state={commonState === 'ready' ? data?.byProject.length ? 'ready' : 'empty' : commonState} emptyText={t('tokens.noData')} {...failureProps} summary={`Showing up to 15 project aggregates from ${data?.byProject.length ?? 0} projects.`}><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground">{[t('tokens.projectCol'), t('tokens.platformCol'), t('tokens.tokensCol')].map((x) => <th scope="col" key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{(data?.byProject ?? []).slice(0, 15).map((p) => <tr key={p.project} className="border-b"><td className="p-2">{p.project}</td><td className="p-2"><PlatformLabel sources={p.sources} /></td><td className="p-2 text-right font-mono tabular-nums">{number(p.totalTokens)}</td></tr>)}</tbody></table></div></ChartPanel>
    <ChartPanel title={t('tokens.topSessions')} description="Bounded raw session records, separate from daily aggregates." state={commonState === 'ready' ? data?.topSessions.length ? 'ready' : 'empty' : commonState} emptyText={t('tokens.noData')} {...failureProps} summary={`Showing ${data?.topSessions.length ?? 0} bounded raw sessions.`}><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-muted-foreground">{[t('tokens.sessionIdCol'), t('tokens.projectCol'), t('tokens.platformCol'), t('tokens.modelCol'), t('tokens.startedCol'), t('tokens.tokensCol')].map((x) => <th scope="col" key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{(data?.topSessions ?? []).map((s) => <tr key={s.sessionId} className="border-b"><td className="p-2 font-mono">{s.sessionId.slice(0, 8)}…</td><td className="p-2">{s.project ?? t('tokens.unknown')}</td><td className="p-2"><PlatformLabel sources={s.source} /></td><td className="p-2">{s.model}</td><td className="p-2">{new Date(s.startedAt).toLocaleString()}</td><td className="p-2 text-right font-mono tabular-nums">{number(s.totalTokens)}</td></tr>)}</tbody></table></div></ChartPanel>
    {hasTokens && <p className="text-xs text-muted-foreground">Daily totals are date-range aggregates. The heatmap summarizes UTC weekday/hour buckets and the session table contains a bounded raw sample.</p>}
    </>}
  </div>;
}
