import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownHeadings } from '../lib/markdownHeadings.js';
import { api, ApiError, type ExternalSection } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { segment, segmentGroup } from '../components/ui/nav-styles.js';
import { Input } from '../components/ui/input.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../components/ui/sheet.js';
import { KnowledgeEditor, type KnowledgeEntry } from '../knowledge/KnowledgeEditor.js';
import { useKnowledgeRoute } from '../knowledge/useKnowledgeRoute.js';
import { registerKnowledgeResources } from '../i18n/round8-knowledge.js';

const PAGE_SIZE = 40;
const SEARCH_LIMIT = 100;
const types = ['decision', 'pattern', 'fix', 'constraint', 'gotcha'];

/** Provider URLs are untrusted. Never turn an arbitrary scheme into a link. */
function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function HomePage() {
  registerKnowledgeResources();
  const route = useKnowledgeRoute();
  return route.overview ? <Overview /> : <KnowledgeBase />;
}

function Overview() {
  const { t } = useTranslation();
  const route = useKnowledgeRoute();
  const scope = route.params.get('scope') || undefined;
  const [recent, setRecent] = useState<KnowledgeEntry[] | null>(null);
  const [plans, setPlans] = useState<{ id: string; title: string }[] | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [health, setHealth] = useState<Record<string, { connected?: boolean }> | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const results = await Promise.allSettled([
        api.listRecent(6, { scope }), api.listPlans(6, 'active', 0, scope),
        api.getCurationOverview(), api.getHealth(),
      ]);
      if (!active) return;
      const [entries, activePlans, cleanup, status] = results;
      setRecent(entries.status === 'fulfilled' ? entries.value as KnowledgeEntry[] : null);
      setPlans(activePlans.status === 'fulfilled' ? activePlans.value as { id: string; title: string }[] : null);
      setPending(cleanup.status === 'fulfilled' ? cleanup.value.pending : null);
      setHealth(status.status === 'fulfilled' ? status.value as Record<string, { connected?: boolean }> : null);
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [scope]);
  const scoped = (path: string) => scope ? `${path}?scope=${encodeURIComponent(scope)}` : path;
  const unavailable = t('knowledgeScreen.unavailable');
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{t('knowledgeScreen.overview')}</h1>
      <Button asChild><Link to={route.listUrl}>{t('knowledgeScreen.viewBase')}</Link></Button>
    </header>
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t('knowledgeScreen.recent')}</h2>
        {recent === null ? <p>{unavailable}</p> : recent.length === 0 ? <p>{t('knowledgeScreen.empty')}</p> :
          <ul className="space-y-3">{recent.map(entry => <li key={entry.id}>
            <Link className="text-primary underline" to={route.detailUrl(entry.id)}>{entry.title}</Link>
            <p className="text-sm text-muted-foreground">{entry.type} · {entry.scope}</p>
          </li>)}</ul>}
      </section>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t('knowledgeScreen.activePlans')}</h2>
        {plans === null ? <p>{unavailable}</p> : plans.length === 0 ? <p>{t('knowledgeScreen.noActivePlans')}</p> :
          <ul className="space-y-3">{plans.map(plan => <li key={plan.id}><Link className="text-primary underline"
            to={scoped(`/plans/${encodeURIComponent(plan.id)}`)}>{plan.title}</Link></li>)}</ul>}
      </section>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t('cleanup.title')}</h2>
        <Link className="text-primary underline" to="/curation?tab=pending">
          {pending === null ? unavailable : t('knowledgeScreen.cleanupPending', { count: pending })}
        </Link>
      </section>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold"><Link to={scoped('/system/health')}>{t('knowledgeScreen.health')}</Link></h2>
        <dl className="space-y-2">{['database', 'ollama'].map(service => <div key={service} className="flex justify-between gap-3">
          <dt>{service === 'database' ? t('knowledgeScreen.database') : 'Ollama'}</dt>
          <dd>{typeof health?.[service]?.connected !== 'boolean' ? unavailable :
            t(health[service].connected ? 'monitoring.connected' : 'monitoring.disconnected')}</dd>
        </div>)}</dl>
      </section>
    </div>
  </div>;
}

function KnowledgeBase() {
  const { t } = useTranslation();
  const route = useKnowledgeRoute();
  const navigate = useNavigate();
  const { params, page } = route;
  const query = params.get('q') || '';
  const scope = params.get('scope') || '';
  const type = params.get('type') || '';
  const tags = params.get('tags') || params.get('tag') || '';
  const agent = params.get('agent') || '';
  const platform = params.get('platform') || '';
  const compact = params.get('view') === 'compact';
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [external, setExternal] = useState<ExternalSection[]>([]);
  const [externalEnabled, setExternalEnabled] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [detail, setDetail] = useState<KnowledgeEntry | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [related, setRelated] = useState<Awaited<ReturnType<typeof api.getKnowledgePlans>> | null>(null);
  const [editing, setEditing] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const rowHeight = compact ? 76 : 156;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const visible = entries.slice(start, start + Math.ceil(560 / rowHeight) + 4);
  const filtersKey = JSON.stringify([query, scope, type, tags, agent, platform, page, revision]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.listScopes(), api.listProviders(), api.getSettings()]).then(([scopeList, providers, settings]) => {
      if (!active) return;
      if (scopeList.status === 'fulfilled') setScopes(scopeList.value);
      setExternalEnabled((providers.status === 'fulfilled' && providers.value.providers.some(provider => provider.enabled)) ||
        (settings.status === 'fulfilled' && !!settings.value.alwaysSearchExternalProviders));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadFailed(false); setEntries([]);
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
    const filters = { scope: scope || undefined, type: type || undefined,
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), agent: agent || undefined, platform: platform || undefined };
    const timer = setTimeout(async () => {
      try {
        if (query.trim()) {
          const response = await api.search(query.trim(), { ...filters, limit: SEARCH_LIMIT, threshold: 0 }) as
            { local?: { entry: KnowledgeEntry }[] } | { entry: KnowledgeEntry }[];
          const results = Array.isArray(response) ? response : response.local ?? [];
          const normalized = results.map(result => result.entry ?? result as unknown as KnowledgeEntry)
            .filter(entry => entry.type !== 'plan' && (!agent || entry.agentId === agent) && (!platform || entry.platform === platform));
          if (!active) return;
          setEntries(normalized.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
          setSelected(current => new Set([...current].filter(id => normalized.some(entry => entry.id === id))));
          setHasNext(normalized.length > (page + 1) * PAGE_SIZE);
        } else {
          const results = await api.listRecent(PAGE_SIZE, filters, page * PAGE_SIZE) as KnowledgeEntry[];
          if (!active) return;
          setEntries(results.filter(entry => entry.type !== 'plan')); setHasNext(results.length === PAGE_SIZE);
          setSelected(current => new Set([...current].filter(id => results.some(entry => entry.id === id))));
        }
      } catch { if (active) setLoadFailed(true); }
      finally { if (active) setLoading(false); }
    }, query.trim() ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [filtersKey]);

  useEffect(() => { setSelected(new Set()); }, [query, scope, type, tags, agent, platform, page]);

  useEffect(() => {
    let active = true;
    setExternal([]);
    if (!externalEnabled || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      void api.searchFederated(query.trim(), { scope: scope || undefined, type: type || undefined,
        tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), limit: SEARCH_LIMIT })
        .then(result => { if (active) setExternal(result.external ?? []); })
        .catch(() => { if (active) setExternal([{ providerId: 'unavailable', providerName: t('providers.externalResults'), results: [], error: 'unavailable', tookMs: 0 }]); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [query, scope, type, tags, externalEnabled, t]);

  // Relationships belong to the selected detail, never the list rows.
  useEffect(() => {
    let active = true;
    setDetail(null); setRelated(null); setDetailFailed(false); setEditing(false);
    if (!route.selectedId) return;
    void api.getById(route.selectedId).then(entry => { if (active) setDetail(entry as KnowledgeEntry); })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 404) {
          toast.error(t('missingKnowledge.notFound'));
          navigate('/knowledge', { replace: true });
        } else {
          setDetailFailed(true);
        }
      });
    void api.getKnowledgePlans(route.selectedId).then(plans => { if (active) setRelated(plans); })
      .catch(() => { if (active) setRelated(null); });
    return () => { active = false; };
  }, [route.selectedId, revision, navigate, t]);

  useEffect(() => {
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [compact]);

  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const save = () => {
    setRevision(value => value + 1);
    setEditing(false);
    if (route.creating) {
      // Keep active filters; creation under this scope remains visible after reload.
      route.patch({ new: null, page: null }, false);
    }
  };
  const bulkDelete = async () => {
    if (deleting || !selected.size) return;
    setDeleting(true); setDeleteFailed(false);
    try {
      const result = await api.bulkDeleteKnowledge([...selected]);
      if (result.errors.length) { setDeleteFailed(true); }
      else { setConfirmDelete(false); setSelected(new Set()); }
      setRevision(value => value + 1);
    } catch { setDeleteFailed(true); }
    finally { setDeleting(false); }
  };
  const exportSelected = () => {
    const blob = new Blob([JSON.stringify({ knowledge: entries.filter(entry => selected.has(entry.id)) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'knowledge-selection.json'; link.click();
    URL.revokeObjectURL(url);
  };
  const index = entries.findIndex(entry => entry.id === route.selectedId);
  const unavailable = t('knowledgeScreen.unavailable');
  const metadata: [string, unknown][] = detail ? [
    [t('knowledgeScreen.id'), detail.id], [t('knowledgeScreen.type'), detail.type],
    [t('knowledgeScreen.scope'), detail.scope], [t('knowledgeScreen.tags'), detail.tags.join(', ')],
    [t('knowledgeScreen.source'), detail.source], [t('knowledgeScreen.confidence'), detail.confidenceScore],
    [t('knowledgeScreen.agent'), detail.agentId], [t('filters.platform'), detail.platform],
    [t('knowledgeScreen.created'), detail.createdAt], [t('knowledgeScreen.updated'), detail.updatedAt],
    [t('knowledge.version'), detail.version], [t('knowledge.expires'), detail.expiresAt],
    [t('knowledgeScreen.curationHistory'), null],
  ] : [];

  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{t('knowledgeScreen.base')}</h1>
      <Button onClick={route.newEntry}>{t('knowledgeScreen.new')}</Button>
    </header>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="md:col-span-3">{t('knowledgeScreen.search')}<Input data-testid="knowledge-search" type="search"
        value={query} onChange={event => route.patch({ q: event.target.value })} /></label>
      <label>{t('knowledgeScreen.scope')}<Input list="knowledge-scopes" value={scope}
        onChange={event => route.patch({ scope: event.target.value })} /></label>
      <datalist id="knowledge-scopes">{scopes.map(item => <option key={item} value={item} />)}</datalist>
      <label>{t('knowledgeScreen.filterByTag')}<Input value={tags} onChange={event => route.patch({ tags: event.target.value, tag: null })} /></label>
      <label>{t('knowledgeScreen.type')}<select className="h-9 w-full rounded-md border bg-background px-3" value={type}
        onChange={event => route.patch({ type: event.target.value })}>
        <option value="">{t('filters.all')}</option>{types.map(value => <option key={value} value={value}>{t(`types.${value}`)}</option>)}
      </select></label>
      <label>{t('knowledgeScreen.agent')}<Input value={agent} onChange={event => route.patch({ agent: event.target.value })} /></label>
      <label>{t('filters.platform')}<Input value={platform} onChange={event => route.patch({ platform: event.target.value })} /></label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div className={segmentGroup}>
        <button type="button" className={segment(!compact)} aria-pressed={!compact} onClick={() => route.patch({ view: 'cards' }, false)}>{t('knowledgeScreen.cards')}</button>
        <button type="button" className={segment(compact)} aria-pressed={compact} onClick={() => route.patch({ view: 'compact' }, false)}>{t('knowledgeScreen.compact')}</button>
      </div>
      <Button variant="ghost" onClick={() => route.patch({ q: null, scope: null, tags: null, tag: null, type: null, agent: null, platform: null })}>{t('filters.clear')}</Button>
      <Button variant="outline" disabled={!entries.length} onClick={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map(entry => entry.id)))}>
        {t(selected.size && selected.size === entries.length ? 'actions.deselectAll' : 'knowledgeScreen.selectAll')}
      </Button>
      <span aria-live="polite">{selected.size} {t('knowledgeScreen.selected')}</span>
      <Button variant="outline" disabled={!selected.size} onClick={exportSelected}>{t('actions.export')}</Button>
      <Button variant="destructive" disabled={!selected.size || deleting} onClick={() => { setDeleteFailed(false); setConfirmDelete(true); }}>{t('knowledgeScreen.deleteSelected')}</Button>
    </div>
    {loadFailed && <p role="alert">{t('errors.actionFailed')} <Button onClick={() => setRevision(value => value + 1)}>{t('knowledgeScreen.retry')}</Button></p>}
    {loading && <p role="status">{t('stats.loading')}</p>}
    {!loading && !loadFailed && entries.length === 0 && <p>{t('knowledgeScreen.empty')}</p>}
    {query.trim() && <p className="text-sm text-muted-foreground">{t('knowledgeScreen.searchLimit', { count: SEARCH_LIMIT })}</p>}
    <div ref={viewport} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      className="overflow-auto rounded-lg border" style={{ height: Math.min(560, entries.length * rowHeight) }} aria-busy={loading}>
      <div style={{ height: entries.length * rowHeight, position: 'relative' }}>
        {visible.map((entry, offset) => <article key={entry.id} data-testid="knowledge-row"
          className={`absolute inset-x-0 flex items-start gap-3 border-b p-3 ${compact ? 'bg-background' : 'bg-card'}`}
          style={{ top: (start + offset) * rowHeight, height: rowHeight, overflow: 'hidden' }}>
          <Checkbox aria-label={`${t('knowledgeScreen.selectEntry')} ${entry.title}`} checked={selected.has(entry.id)} onCheckedChange={() => toggle(entry.id)} />
          <Link className="h-full min-w-0 flex-1" to={route.detailUrl(entry.id)} onClick={event => {
            if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); route.open(entry.id); }
          }}>
            <h2 className="truncate font-semibold text-primary">{entry.title}</h2>
            {!compact && <p className="my-2 line-clamp-2 text-sm text-muted-foreground">{entry.content}</p>}
            <p className="truncate text-xs text-muted-foreground">{entry.type} · {entry.scope} · {entry.tags.join(', ')}</p>
          </Link>
        </article>)}
      </div>
    </div>
    <nav className="flex items-center justify-between" aria-label={t('knowledgeScreen.pagination')}>
      <Button variant="outline" disabled={page === 0 || loading} onClick={() => route.patch({ page: String(page - 1) }, false)}>{t('knowledgeScreen.previous')}</Button>
      <span>{page + 1}</span>
      <Button variant="outline" disabled={!hasNext || loading} onClick={() => route.patch({ page: String(page + 1) }, false)}>{t('knowledgeScreen.next')}</Button>
    </nav>
    {external.map(section => <section key={section.providerId} className="space-y-2 rounded-lg border p-4">
      <h2 className="font-semibold">{section.providerName} · {t('providers.untrustedBadge')}</h2>
      <p className="text-sm text-muted-foreground">{t('providers.externalUntrusted')}</p>
      {section.error ? <p role="status">{t('providers.failed')}</p> : section.results.map((result, item) => <article key={item}>
        {isSafeHttpUrl(result.url) ? <a className="text-primary underline" href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a> : <strong>{result.title}</strong>}
        <p className="whitespace-pre-wrap text-sm">{result.content}</p>
      </article>)}
    </section>)}
    <Sheet open={!!route.selectedId || route.creating} onOpenChange={open => { if (!open) route.close(); }}>
      <SheetContent className="overflow-y-auto sm:max-w-2xl" aria-describedby="knowledge-detail-description">
        <SheetTitle>{route.creating ? t('knowledgeScreen.new') : detail?.title ?? t('knowledgeScreen.details')}</SheetTitle>
        <SheetDescription id="knowledge-detail-description">{t('knowledgeScreen.details')}</SheetDescription>
        {route.creating ? <KnowledgeEditor key="new" onSaved={save} onCancel={route.close} /> :
          <div data-testid="knowledge-detail" className="space-y-5 pt-4">
            <div className="flex gap-2">
              <Button variant="outline" disabled={index <= 0} onClick={() => route.open(entries[index - 1].id, true)}>{t('knowledgeScreen.previous')}</Button>
              <Button variant="outline" disabled={index < 0 || index >= entries.length - 1} onClick={() => route.open(entries[index + 1].id, true)}>{t('knowledgeScreen.next')}</Button>
              <Button disabled={!detail} onClick={() => setEditing(value => !value)}>{t('actions.edit')}</Button>
            </div>
            {detailFailed ? <p role="alert">{t('errors.actionFailed')}</p> : !detail ? <p role="status">{t('stats.loading')}</p> : editing ?
              <KnowledgeEditor key={detail.id} entry={detail} onSaved={save} onCancel={() => setEditing(false)} /> : <>
                <div className="prose max-w-none break-words dark:prose-invert [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_code]:font-mono">
                  <ReactMarkdown remarkPlugins={[remarkGfm, [markdownHeadings, { level: 3 }]]} components={{
                    input: ({ node: _node, ...props }) => <input {...props} aria-label="Task completion" />,
                    a: ({ href, children }) => isSafeHttpUrl(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
                    img: ({ alt }) => <span>{alt}</span>,
                  }}>{detail.content}</ReactMarkdown>
                </div>
                <h3 className="font-semibold">{t('knowledgeScreen.metadata')}</h3>
                <dl className="space-y-2 text-sm">{metadata.map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-3">
                  <dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value == null || value === '' ? unavailable : String(value)}</dd>
                </div>)}</dl>
                <h3 className="font-semibold">{t('knowledgeScreen.relatedPlans')}</h3>
                {related === null ? <p>{unavailable}</p> : related.length === 0 ? <p>{t('plans.noPlans')}</p> :
                  <ul className="space-y-2">{related.map(plan => <li key={`${plan.planId}-${plan.relationType}`}>
                    <Link className="text-primary underline" to={`/plans/${encodeURIComponent(plan.planId)}${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`}>{plan.title}</Link>
                    <span className="ml-2 text-sm">{t(plan.relationType === 'output' ? 'plans.originPlan' : 'plans.consultedBy')} · {plan.status}</span>
                  </li>)}</ul>}
              </>}
          </div>}
      </SheetContent>
    </Sheet>
    <Sheet open={confirmDelete} onOpenChange={open => { if (!deleting) setConfirmDelete(open); }}>
      <SheetContent>
        <SheetTitle>{t('delete.bulkTitle')}</SheetTitle>
        <SheetDescription>{t('delete.bulkMessage', { count: selected.size })}</SheetDescription>
        {deleteFailed && <p role="alert">{t('errors.deleteFailed')}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => setConfirmDelete(false)}>{t('knowledgeScreen.cancel')}</Button>
          <Button variant="destructive" disabled={deleting || !selected.size} onClick={bulkDelete}>{t('actions.confirm')}</Button>
        </div>
      </SheetContent>
    </Sheet>
  </div>;
}
