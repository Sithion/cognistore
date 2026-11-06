import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type CurationOverview, type CurationQueueAction, type DbHealth } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { sectionTab, sectionTabList } from '../components/ui/nav-styles.js';
import { pageClass, pageHeaderClass, pageSubtitleClass, pageTitleClass } from '../components/ui/control-styles.js';
import { AppliedPanel, HealthPanel, PendingPanel, TrashPanel } from '../curation/CurationPanels.js';

const TABS = ['pending', 'applied', 'trash', 'health'] as const;
type Tab = (typeof TABS)[number];
const LEGACY_PATH_TAB: Record<string, Tab> = { '/curation/history': 'applied', '/curation/trash': 'trash' };
const RUN_POLL_MS = 2000;
const RUN_POLL_LIMIT = 450; // 15 minutes

export function CurationPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : LEGACY_PATH_TAB[pathname] ?? 'pending';
  const [overview, setOverview] = useState<CurationOverview | null>(null);
  const [queue, setQueue] = useState<CurationQueueAction[]>([]);
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const [next, page] = await Promise.all([api.getCurationOverview(), api.getCurationQueue(50)]);
      if (!mounted.current) return;
      setOverview(next); setQueue(page.actions); setFailed(false);
      setSelected(previous => new Set([...previous].filter(id => page.actions.some(action => action.id === id))));
    } catch { if (mounted.current) setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab !== 'health') return;
    api.getDbHealth().then(next => { if (mounted.current) setHealth(next); }).catch(() => { if (mounted.current) setFailed(true); });
  }, [tab]);

  const selectTab = (next: Tab) => setParams(previous => { const copy = new URLSearchParams(previous); copy.set('tab', next); return copy; }, { replace: true });

  const undo = useCallback(async (id: string) => {
    setBusy(true);
    try { await api.undoCuration(id); toast.success(t('curationPage.undone')); await load(); }
    catch { toast.error(t('curationPage.undoFailed')); }
    finally { setBusy(false); }
  }, [load, t]);

  const batch = async (operation: 'apply' | 'reject', ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const { results } = await api.curationBatch(operation, ids);
      const okIds = results.filter(result => result.ok).map(result => result.id);
      const failures = results.length - okIds.length;
      const message = t(operation === 'apply' ? 'curationPage.applyDone' : 'curationPage.rejectDone', { count: okIds.length });
      if (operation === 'apply' && okIds.length === 1) toast.success(message, { action: { label: t('curationPage.undo'), onClick: () => { void undo(okIds[0]); } } });
      else toast.success(message);
      if (failures > 0) toast.warning(t('curationPage.batchPartial', { failed: failures }));
      setSelected(new Set());
      await load();
    } catch { toast.error(t('curationPage.actionFailed')); }
    finally { setBusy(false); }
  };

  const restore = async (id: string) => {
    setBusy(true);
    try { await api.restoreTrashed(id); toast.success(t('curationPage.restored')); await load(); }
    catch { toast.error(t('curationPage.restoreFailed')); }
    finally { setBusy(false); }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { runId } = await api.runCuration();
      for (let attempt = 0; attempt < RUN_POLL_LIMIT && mounted.current; attempt++) {
        await new Promise(resolve => setTimeout(resolve, RUN_POLL_MS));
        const { run } = await api.getCurationRun(runId);
        if (run.status === 'failed') { toast.error(t('curationPage.runFailed')); break; }
        if (run.status === 'completed' || run.status === 'paused') { toast.success(t('curationPage.runDone')); break; }
      }
      await load();
    } catch { toast.error(t('curationPage.runFailed')); }
    finally { if (mounted.current) setRunning(false); }
  };

  // The palette's "Run curation" command lands here with ?run=1: start once, then drop the flag.
  const autoRun = useRef(false);
  useEffect(() => {
    if (params.get('run') !== '1' || autoRun.current) return;
    autoRun.current = true;
    setParams(previous => { const copy = new URLSearchParams(previous); copy.delete('run'); return copy; }, { replace: true });
    void runNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  const toggleAll = () => setSelected(previous => previous.size === queue.length ? new Set() : new Set(queue.map(action => action.id)));
  const now = Date.now();

  return <section aria-labelledby="curation-title" className={`${pageClass} mx-auto max-w-4xl`}>
    <header className={pageHeaderClass}>
      <div>
        <h1 id="curation-title" className={pageTitleClass}>{t('curationPage.title')}</h1>
        <p className={pageSubtitleClass}>{t('curationPage.subtitle')}</p>
      </div>
      <Button data-testid="run-curation" onClick={() => void runNow()} disabled={running || overview?.autonomy === 'off'}>{running ? t('curationPage.running') : t('curationPage.runNow')}</Button>
    </header>
    {overview && <p data-testid="autonomy-banner" role="status" className="rounded-lg border bg-card p-3 text-sm">{t(`curationPage.autonomy.${overview.autonomy}`)}</p>}
    <div role="tablist" aria-label={t('curationPage.tabs.label')} className={sectionTabList}>
      {TABS.map(name => <button key={name} type="button" role="tab" id={`curation-tab-${name}`} aria-selected={tab === name} aria-controls="curation-panel" data-testid={`tab-${name}`}
        className={sectionTab(tab === name)} onClick={() => selectTab(name)}>
        {t(`curationPage.tabs.${name}`)}{name === 'pending' && overview ? ` (${overview.pending})` : ''}{name === 'trash' && overview ? ` (${overview.trash.count})` : ''}
      </button>)}
    </div>
    <div id="curation-panel" role="tabpanel" aria-labelledby={`curation-tab-${tab}`} className="space-y-3">
      {failed && <div role="alert" className="flex items-center gap-3"><span>{t('curationPage.loadFailed')}</span><Button variant="outline" onClick={() => { setFailed(false); void load(); }}>{t('curationPage.retry')}</Button></div>}
      {!overview && !failed && <p className="text-sm text-muted-foreground">…</p>}
      {overview && tab === 'pending' && <PendingPanel actions={queue} selected={selected} busy={busy} onToggle={toggle} onToggleAll={toggleAll}
        onApprove={id => void batch('apply', [id])} onReject={id => void batch('reject', [id])} onBatch={operation => void batch(operation, [...selected])} />}
      {overview && tab === 'applied' && <AppliedPanel actions={overview.applied} now={now} busy={busy} onUndo={id => void undo(id)} />}
      {overview && tab === 'trash' && <TrashPanel items={overview.trash.items} now={now} busy={busy} onRestore={id => void restore(id)} />}
      {tab === 'health' && health && <HealthPanel health={health} />}
    </div>
  </section>;
}
