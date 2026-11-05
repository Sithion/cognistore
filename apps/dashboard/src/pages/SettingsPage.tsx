import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, SIDECAR_TOKEN } from '../api/client.js';
import { triggerUpdateCheck, triggerUpdateDownload, onUpdateState, getIsTauri, getLatestReleaseUrl, useAutoUpdateSetting } from '../components/UpdateChecker.js';
import { ConfirmModal } from '../components/ConfirmModal.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Switch } from '../components/ui/switch.js';
import { RetentionField } from '../settings/RetentionField.js';
import { SettingsCard, SettingsRow, StatusBadge, fieldClass } from '../settings/SettingsLayout.js';
import { ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useSettingsCopy } from '../i18n/settings-v261.js';
import { useSettingsRoute, settingsRoutes } from '../settings/useSettingsRoute.js';
import { round8Settings } from '../i18n/round8-settings.js';
import { applyTheme, getThemeMode, type ThemeMode } from '../design/theme.js';
import type { AppSettings, SetupStatus } from '../api/client.js';
declare const __APP_VERSION__: string;

interface Health {
  database: { connected: boolean; path?: string; error?: string };
  ollama: { connected: boolean; model?: string; host?: string; error?: string };
}

const POLL_INTERVAL = 5000;

const languages = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português (BR)' },
];

export function SettingsPage() {
  const route = useSettingsRoute();
  const { i18n } = useTranslation();
  const copy = round8Settings[i18n.language.split('-')[0] as keyof typeof round8Settings] ?? round8Settings.en;
  return <div>
    <h1 style={{ fontSize: 20, fontWeight: 700 }}>{copy[route]}</h1>
    {(route.startsWith('settings/') || route.startsWith('curation')) && <nav aria-label="Sections" style={{ display: 'flex', gap: 16, margin: '16px 0', flexWrap: 'wrap' }}>
      {settingsRoutes.filter(path => route.startsWith('settings/') ? path.startsWith('settings/') : path.startsWith('curation')).map(path => <Link key={path} to={'/' + path} className={`rounded-md px-3 py-1.5 text-sm ${route === path ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}`} aria-current={route === path ? 'page' : undefined}>{copy[path]}</Link>)}
    </nav>}
    <SettingsScreen key={route} route={route} />
  </div>;
}

function SettingsScreen({ route }: { route: ReturnType<typeof useSettingsRoute> }) {
  const { t, i18n } = useTranslation();
  const copy = useSettingsCopy();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof api.getMetrics>> | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uninstallStep, setUninstallStep] = useState(0);
  const [updateState, setUpdateState] = useState<string>('idle');
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [autoUpdate, setAutoUpdate] = useAutoUpdateSetting();
  const [dbSize, setDbSize] = useState<{ sizeFormatted: string; path: string } | null>(null);

  useEffect(() => {
    if (route !== 'system/health') return;
    let cancelled = false;
    api.getMetrics()
      .then((m) => { if (!cancelled) { setDbSize(m.database); setMetrics(m); } })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [route]);

  useEffect(() => {
    return onUpdateState((state) => {
      setUpdateState(state);
      if (state === 'upToDate') {
        setCheckResult('upToDate');
        setTimeout(() => setCheckResult(null), 5000);
      } else if (state === 'available') {
        setCheckResult('available');
      } else if (state === 'error') {
        setCheckResult('error');
        setTimeout(() => setCheckResult(null), 5000);
      }
    });
  }, []);

  const fetchHealth = useCallback(() => {
    api.getHealth().then(data => {
      setHealth(data as Health);
      setHealthFailed(false);
    }).catch(() => {
      setHealth(null);
      setHealthFailed(true);
    });
  }, []);

  useEffect(() => {
    if (route !== 'system/health') return;
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchHealth, route]);

  const allHealthy = health?.database.connected && health?.ollama.connected;

  return <div className="w-full max-w-3xl">
    {route === 'knowledge/tags' && <TagSuggestionsSection />}
    {route === 'integrations/agents' && <>
      <AgentReadinessSection />
      <MaintenanceSection redeployOnly />
    </>}
    {(route === 'settings/telemetry' || route === 'settings/models' || route === 'settings/curation') &&
      <SettingsFields route={route} />}

    {route === 'system/health' && <>
      <SettingsCard title={copy.services} description={t('monitoring.subtitle')} footer={<Button type="button" variant="outline" size="sm" onClick={fetchHealth}><RefreshCw aria-hidden="true" className="size-4" />{copy.refresh}</Button>}>
        <SettingsRow label={t('monitoring.database')} description={
          health ? (health.database.connected ? health.database.path : health.database.error) : undefined
        }>
          <StatusBadge
            status={health ? (health.database.connected ? 'ok' : 'error') : 'unknown'}
            label={health ? t(health.database.connected ? 'monitoring.connected' : 'monitoring.disconnected') : copy.unknown}
          />
        </SettingsRow>
        <SettingsRow label={t('monitoring.ollama')} description={
          health ? (health.ollama.connected ? `${health.ollama.model} @ ${health.ollama.host}` : health.ollama.error) : undefined
        }>
          <StatusBadge
            status={health ? (health.ollama.connected ? 'ok' : 'error') : 'unknown'}
            label={health ? t(health.ollama.connected ? 'monitoring.connected' : 'monitoring.disconnected') : copy.unknown}
          />
        </SettingsRow>
        <SettingsRow label={t('stats.dbSize')} description={
          dbSize?.path ? <span className="break-all">{dbSize.path}</span> : undefined
        }>
          <span className="text-sm font-medium">{dbSize?.sizeFormatted ?? '—'}</span>
        </SettingsRow>
        <SettingsRow label={copy.overallStatus}>
          <StatusBadge
            status={health ? (allHealthy ? 'ok' : 'error') : 'unknown'}
            label={health ? t(allHealthy ? 'monitoring.allReady' : 'monitoring.degraded') :
              healthFailed ? copy.unknown : t('monitoring.checking')}
          />
        </SettingsRow>
        {!health && <p role={healthFailed ? 'alert' : 'status'} className="pb-4 text-sm text-muted-foreground">
          {healthFailed ? copy.healthUnavailable : t('stats.loading')}
        </p>}
      </SettingsCard>
      <SettingsCard title={copy.activity}>
        {metrics ? <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-3">
          {[
            [copy.totalEntries, metrics.activity.total],
            [copy.readsDay, metrics.operations.readsLastDay],
            [copy.writesDay, metrics.operations.writesLastDay],
          ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-background p-4">
            <p className="text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{label}</p>
          </div>)}
        </div> : <p className="py-4 text-sm text-muted-foreground">{copy.metricsUnavailable}</p>}
      </SettingsCard>
    </>}

    {actionMessage && <p role={actionMessage.type === 'error' ? 'alert' : 'status'} className="mt-6">
      <StatusBadge status={actionMessage.type === 'success' ? 'ok' : 'error'} label={actionMessage.text} />
    </p>}

    {route === 'system/about' && <SettingsCard title={copy.about}>
      <SettingsRow label={copy.version}>
        <span className="text-sm font-medium">{typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : copy.versionUnavailable}</span>
      </SettingsRow>
      <SettingsRow label={t('update.section')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setCheckResult(null); triggerUpdateCheck(); }}
            disabled={updateState === 'checking'}>
            {updateState === 'checking' && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
            {updateState === 'checking' ? t('update.checking') : t('update.check')}
          </Button>
          {checkResult === 'upToDate' && <StatusBadge status="ok" label={t('update.upToDate')} />}
          {checkResult === 'available' && updateState !== 'downloading' && updateState !== 'ready' && (
            getIsTauri() && (window as any).__pendingUpdate ? (
              <Button type="button" size="sm" onClick={triggerUpdateDownload}>{t('update.updateNow')}</Button>
            ) : (
              <Button asChild size="sm">
                <a href={getLatestReleaseUrl() || 'https://github.com/Sithion/cognistore/releases/latest'}
                  target="_blank" rel="noopener noreferrer">{t('update.viewRelease')}</a>
              </Button>
            )
          )}
          {updateState === 'downloading' && <StatusBadge status="unknown" label={t('update.downloading')} />}
          {updateState === 'ready' && <StatusBadge status="ok" label={t('update.restartToApply')} />}
          {checkResult === 'error' && <StatusBadge status="error" label={t('update.checkFailed')} />}
        </div>
      </SettingsRow>
    </SettingsCard>}

    {route === 'settings/general' && <>
      <SettingsCard title={copy.appearance} description={copy.appearanceDesc}>
        <SettingsRow label={copy.language} htmlFor="settings-language">
          <select id="settings-language" className={fieldClass} value={i18n.language.split('-')[0]} onChange={e => i18n.changeLanguage(e.target.value)}>
            {languages.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow label={copy.theme} htmlFor="settings-theme"><ThemeField /></SettingsRow>
      </SettingsCard>
      <SettingsCard title={copy.updates}>
        <SettingsRow label={t('update.autoUpdate')} description={t('update.autoUpdateHint')} htmlFor="settings-auto-update">
          <Switch id="settings-auto-update" checked={autoUpdate} onCheckedChange={v => { void setAutoUpdate(v); }} />
        </SettingsRow>
      </SettingsCard>
      <KnowledgeHealthSection />
    </>}

    {route === 'settings/advanced' && <>
      <MaintenanceSection />
      <DataManagementSection />
      <LogSection />
      <SettingsCard title={t('settings.dangerZone')} description={t('settings.uninstallDesc')} tone="danger">
        <SettingsRow label={t('settings.uninstallBtn')}>
          {uninstallStep === 3 ? (
            <span role="status" className="text-sm text-muted-foreground">{t('settings.uninstallingMsg')}</span>
          ) : (
            <Button type="button" variant="destructive" size="sm" onClick={() => setUninstallStep(1)}>
              <Trash2 aria-hidden="true" className="size-4" />
              {t('settings.uninstallBtn')}
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>
      <ConfirmModal
        isOpen={uninstallStep === 1}
        onClose={() => setUninstallStep(0)}
        onConfirm={() => setUninstallStep(2)}
        title={t('settings.uninstallBtn')}
        message={t('settings.uninstallConfirm1')}
        confirmLabel={t('settings.yesContinue')}
      />
      <ConfirmModal
        isOpen={uninstallStep === 2}
        onClose={() => setUninstallStep(0)}
        onConfirm={async () => {
          setUninstallStep(3);
          setActionMessage({ type: 'success', text: t('settings.uninstallingMsg') });
          try {
            // Provider secrets live outside the directory removed by uninstallAll.
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('cleanup_provider_secrets', { token: SIDECAR_TOKEN });
            } catch { /* not running in Tauri, or no secrets */ }
            await api.uninstallAll();
          } catch {
            // Server shutdown during uninstall is expected.
          }
          setTimeout(() => {
            setUninstallStep(4);
            try { window.close(); } catch { /* ignore */ }
          }, 2000);
        }}
        title={t('settings.uninstallBtn')}
        message={t('settings.uninstallConfirm2')}
        confirmLabel={t('settings.yesUninstallAll')}
      />
      {uninstallStep === 4 && <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4 bg-background p-6">
        <h2 className="text-xl font-bold text-success">{t('settings.uninstallCompleteTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.uninstallCompleteHint')}</p>
      </div>}
    </>}
  </div>;
}

function LogSection() {
  const { t } = useTranslation();
  const copy = useSettingsCopy();
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [total, setTotal] = useState(0);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.getLogs(200);
      setLines(res.lines);
      setTotal(res.total);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [expanded, fetchLogs]);

  const handleClear = async () => {
    try {
      await api.clearLogs();
      setLines([]);
      setTotal(0);
    } catch { /* ignore */ }
  };

  return <SettingsCard title={t('settings.logs.title')}>
    <SettingsRow label={t('settings.logs.title')} description={total > 0 ? `${total} ${copy.logLines}` : undefined}>
      <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls="settings-log-output"
        onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
        {expanded ? copy.hideLog : copy.showLog}
      </Button>
    </SettingsRow>
    {expanded && <div id="settings-log-output" className="pb-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={fetchLogs}>
          <RefreshCw aria-hidden="true" className="size-4" />{t('settings.logs.refresh')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleClear}>
          <Trash2 aria-hidden="true" className="size-4" />{t('settings.logs.clear')}
        </Button>
      </div>
      <div className="max-h-[300px] overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed">
        {lines.length === 0 ? <span className="text-muted-foreground">{t('settings.logs.empty')}</span> :
          lines.map((line, i) => <div key={i} className={`whitespace-pre-wrap break-all ${line.includes('[ERROR]') ? 'text-destructive' : 'text-foreground'}`}>{line}</div>)}
      </div>
    </div>}
  </SettingsCard>;
}

function MaintenanceSection({ redeployOnly = false }: { redeployOnly?: boolean }) {
  const { t } = useTranslation();
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployResult, setRedeployResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleCleanup = async () => {
    setCleaning(true);
    setCleanResult(null);
    try {
      const res = await api.cleanupDatabase();
      setCleanResult(
        res.sizeAfter
          ? t('settings.orphansRemovedDb', { count: res.orphansRemoved, size: res.sizeAfter })
          : t('settings.orphansRemoved', { count: res.orphansRemoved })
      );
    } catch {
      setCleanResult(t('settings.cleanupFailed'));
    }
    setCleaning(false);
  };

  const handleRedeploy = async () => {
    setRedeploying(true);
    setRedeployResult(null);
    try {
      const res = await api.redeploy();
      const failed = res.results.filter((r) => r.status === 'error');
      if (failed.length === 0) {
        setRedeployResult({ type: 'success', text: t('settings.redeploySuccess') });
      } else {
        setRedeployResult({ type: 'error', text: t('settings.redeployStepsFailed', { count: failed.length, steps: failed.map((f) => f.step).join(', ') }) });
      }
    } catch {
      setRedeployResult({ type: 'error', text: t('settings.redeployFailed') });
    }
    setRedeploying(false);
    setTimeout(() => setRedeployResult(null), 5000);
  };

  return <SettingsCard title={t('settings.maintenance')}>
    <SettingsRow label={t('settings.redeploy')} description={t('settings.redeployTooltip')}>
      <div className="flex flex-col items-start gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleRedeploy}
          disabled={redeploying} title={t('settings.redeployTooltip')}>
          {redeploying ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> :
            <RefreshCw aria-hidden="true" className="size-4" />}
          {t('settings.redeploy')}
        </Button>
        {redeployResult && <span role={redeployResult.type === 'error' ? 'alert' : 'status'}>
          <StatusBadge status={redeployResult.type === 'success' ? 'ok' : 'error'} label={redeployResult.text} />
        </span>}
      </div>
    </SettingsRow>
    {!redeployOnly && <SettingsRow label={t('settings.removeEmbeddings')}>
      <div className="flex flex-col items-start gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleCleanup}
          disabled={cleaning} title={t('settings.removeEmbeddings')}>
          {cleaning ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> :
            <Trash2 aria-hidden="true" className="size-4" />}
          {t('settings.removeEmbeddings')}
        </Button>
        {cleanResult && <span role="status" className="text-xs text-muted-foreground">{cleanResult}</span>}
      </div>
    </SettingsRow>}
  </SettingsCard>;
}

export function DataManagementSection() {
  const { t } = useTranslation();
  const copy = useSettingsCopy();
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportKnowledge, setExportKnowledge] = useState(true);
  const [exportPlans, setExportPlans] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<{
    knowledgeCount: number; plansCount: number;
    knowledge?: any[]; plans?: any[];
  } | null>(null);
  const [importKnowledge, setImportKnowledge] = useState(true);
  const [importPlansFlag, setImportPlansFlag] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const include: ('knowledge' | 'plans')[] = [];
      if (exportKnowledge) include.push('knowledge');
      if (exportPlans) include.push('plans');
      await api.exportUnified(include);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
    setShowExportModal(false);
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const parsed = await api.parseExportFile(file);
        setImportFile(parsed);
        setImportKnowledge(parsed.knowledgeCount > 0);
        setImportPlansFlag(parsed.plansCount > 0);
        setShowImportModal(true);
      } catch {
        setImportResult({ type: 'error', text: t('settings.importParseError') });
        setTimeout(() => setImportResult(null), 5000);
      }
    };
    input.click();
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const include: string[] = [];
      const body: Record<string, any> = { include };
      if (importKnowledge && importFile.knowledge) {
        include.push('knowledge');
        body.knowledge = importFile.knowledge;
      }
      if (importPlansFlag && importFile.plans) {
        include.push('plans');
        body.plans = importFile.plans;
      }
      const result = await api.importUnified(body as any);
      const parts: string[] = [];
      if (result.knowledge) parts.push(copy.importKnowledgeResult.replace('{imported}', String(result.knowledge.imported)).replace('{skipped}', String(result.knowledge.skipped)));
      if (result.plans) parts.push(copy.importPlansResult.replace('{imported}', String(result.plans.imported)).replace('{skipped}', String(result.plans.skipped)));
      setImportResult({ type: 'success', text: parts.join(' · ') });
    } catch (err) {
      setImportResult({ type: 'error', text: copy.importFailed.replace('{error}', err instanceof Error ? err.message : String(err)) });
    }
    setImporting(false);
    setShowImportModal(false);
    setImportFile(null);
    setTimeout(() => setImportResult(null), 8000);
  };

  return <SettingsCard title={t('settings.dataManagement')}>
    <SettingsRow label={t('settings.exportBtn')} description={t('settings.exportModalDesc')}>
      <Button type="button" variant="outline" size="sm"
        onClick={() => { setExportKnowledge(true); setExportPlans(true); setShowExportModal(true); }}>
        <Download aria-hidden="true" className="size-4" />{t('settings.exportBtn')}
      </Button>
    </SettingsRow>
    <SettingsRow label={t('settings.importBtn')} description={copy.importDesc}>
      <Button type="button" variant="outline" size="sm" onClick={handleImportClick}>
        <Upload aria-hidden="true" className="size-4" />{t('settings.importBtn')}
      </Button>
    </SettingsRow>
    {importResult && <p role={importResult.type === 'error' ? 'alert' : 'status'} className="pb-4">
      <StatusBadge status={importResult.type === 'success' ? 'ok' : 'error'} label={importResult.text} />
    </p>}

    {showExportModal && <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
      <DialogContent className="w-[90%] max-w-[400px]">
        <DialogTitle>{t('settings.exportModalTitle')}</DialogTitle>
        <DialogDescription>{t('settings.exportModalDesc')}</DialogDescription>
        <div className="space-y-2">
          <label className="flex items-center gap-2 py-2 text-sm">
            <input type="checkbox" checked={exportKnowledge} onChange={e => setExportKnowledge(e.target.checked)} />
            {t('settings.knowledgeEntries')}
          </label>
          <label className="flex items-center gap-2 py-2 text-sm">
            <input type="checkbox" checked={exportPlans} onChange={e => setExportPlans(e.target.checked)} />
            {t('settings.planEntries')}
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowExportModal(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={handleExport} disabled={exporting || (!exportKnowledge && !exportPlans)}>
            {exporting && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
            {t('settings.exportBtn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>}

    {showImportModal && importFile && <Dialog open={showImportModal}
      onOpenChange={open => { setShowImportModal(open); if (!open) setImportFile(null); }}>
      <DialogContent className="w-[90%] max-w-[400px]">
        <DialogTitle>{t('settings.importModalTitle')}</DialogTitle>
        <DialogDescription>{t('settings.importModalDesc')}</DialogDescription>
        <div className="space-y-2">
          <label className={`flex items-center gap-2 py-2 text-sm ${importFile.knowledgeCount === 0 ? 'opacity-40' : ''}`}>
            <input type="checkbox" checked={importKnowledge} disabled={importFile.knowledgeCount === 0}
              onChange={e => setImportKnowledge(e.target.checked)} />
            {t('settings.knowledgeEntries')} ({importFile.knowledgeCount})
          </label>
          <label className={`flex items-center gap-2 py-2 text-sm ${importFile.plansCount === 0 ? 'opacity-40' : ''}`}>
            <input type="checkbox" checked={importPlansFlag} disabled={importFile.plansCount === 0}
              onChange={e => setImportPlansFlag(e.target.checked)} />
            {t('settings.planEntries')} ({importFile.plansCount})
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setShowImportModal(false); setImportFile(null); }}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={handleImport} disabled={importing || (!importKnowledge && !importPlansFlag)}>
            {importing && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
            {t('settings.importBtn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>}
  </SettingsCard>;
}


type TagSuggestion = { a: string; b: string; similarity: number; countA: number; countB: number };
type TagGroup = { key: string; members: { tag: string; count: number }[]; maxSimilarity: number };

// Cluster overlapping suggestion pairs into GROUPS (union-find). With raw pairs,
// "select all" was unusable: one tag appearing in several pairs got contradictory
// default keepers ("'x' cannot be merged in two directions") with no practical way
// to fix 40+ rows by hand. With one keeper per group, every merge is loser→keeper —
// conflicts are impossible by construction (the server CONFLICT guard stays as a
// backstop).
function buildTagGroups(suggestions: TagSuggestion[]): TagGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const counts = new Map<string, number>();
  for (const s of suggestions) {
    union(s.a, s.b);
    counts.set(s.a, s.countA);
    counts.set(s.b, s.countB);
  }
  const byRoot = new Map<string, Set<string>>();
  for (const tag of counts.keys()) {
    const root = find(tag);
    const set = byRoot.get(root) ?? new Set<string>();
    set.add(tag);
    byRoot.set(root, set);
  }
  const maxSim = new Map<string, number>();
  for (const s of suggestions) {
    const root = find(s.a);
    maxSim.set(root, Math.max(maxSim.get(root) ?? 0, s.similarity));
  }
  return Array.from(byRoot.entries())
    .map(([root, tags]) => {
      const members = Array.from(tags)
        .map((tag) => ({ tag, count: counts.get(tag) ?? 0 }))
        .sort((x, y) => (y.count - x.count) || x.tag.localeCompare(y.tag));
      return { key: members.map((m) => m.tag).join('|'), members, maxSimilarity: maxSim.get(root) ?? 0 };
    })
    .sort((x, y) => (y.members.length - x.members.length) || (y.maxSimilarity - x.maxSimilarity));
}

function TagSuggestionsSection() {
  const { t } = useTranslation();
  const copy = useSettingsCopy();
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keeper, setKeeper] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Default keeper = the most-used tag of the group (members are pre-sorted).
  const keeperOf = (g: TagGroup) => keeper[g.key] ?? g.members[0]?.tag;

  const load = useCallback(() => {
    setLoading(true);
    api.getTagSuggestions()
      .then((s) => { setGroups(buildTagGroups(s)); setSelected(new Set()); setKeeper({}); })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleGroup = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const allSelected = groups.length > 0 && selected.size === groups.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.key)));
  };

  // Every merge is member→keeper of its own group: each `from` appears exactly
  // once and all of a group's merges share one target — no chains, no conflicts.
  const selectedMerges = groups
    .filter((g) => selected.has(g.key))
    .flatMap((g) => {
      const keep = keeperOf(g);
      return g.members.filter((m) => m.tag !== keep).map((m) => ({ from: m.tag, to: keep }));
    });

  const applyBatch = async () => {
    setApplying(true);
    try {
      // The endpoint accepts at most 50 merges per call — chunk large batches.
      let entries = 0;
      let mergesApplied = 0;
      for (let i = 0; i < selectedMerges.length; i += 50) {
        const res = await api.mergeTagsBatch(selectedMerges.slice(i, i + 50));
        entries += res.entriesReembedded;
        mergesApplied += res.applied.length;
      }
      setMessage(t('tagSuggestions.batchDone', { entries, merges: mergesApplied }));
      setConfirmOpen(false);
      load();
    } catch {
      setMessage(t('tagSuggestions.mergeFailed'));
      setConfirmOpen(false);
    }
    setApplying(false);
    setTimeout(() => setMessage(null), 5000);
  };

  return <SettingsCard title={t('tagSuggestions.title')} footer={
    !loading && groups.length > 0 ? <>
      <span className="text-xs text-muted-foreground">{t('tagSuggestions.selectedCount', { count: selected.size })}</span>
      <Button type="button" size="sm" disabled={selectedMerges.length === 0 || applying} onClick={() => setConfirmOpen(true)}>
        {applying && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
        {applying ? t('tagSuggestions.applying') : t('tagSuggestions.applyN', { count: selectedMerges.length })}
      </Button>
    </> : undefined
  }>
    {message && <p role="status" className="py-4 text-sm text-muted-foreground">{message}</p>}
    {loading ? <p className="py-4 text-sm text-muted-foreground">{t('tagSuggestions.loading')}</p> :
      groups.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t('tagSuggestions.none')}</p> : <>
        <SettingsRow label={t('tagSuggestions.selectAll')} htmlFor="settings-tags-select-all">
          <input id="settings-tags-select-all" type="checkbox" checked={allSelected} onChange={toggleAll} disabled={applying} />
        </SettingsRow>
        {groups.map(g => {
          const isSelected = selected.has(g.key);
          const keep = keeperOf(g);
          return <SettingsRow key={g.key} label={
            <span className="break-words">
              {g.members.map((m, i) => <span key={m.tag}>
                {i > 0 && <span className="text-muted-foreground"> ↔ </span>}
                <strong className={isSelected && keep === m.tag ? 'text-primary' : undefined}>{m.tag}</strong>
              </span>)}
            </span>
          } description={`${Math.round(g.maxSimilarity * 100)}%`}>
            <input aria-label={`${copy.selectTagGroup}: ${g.members.map(m => m.tag).join(', ')}`}
              type="checkbox" checked={isSelected} onChange={() => toggleGroup(g.key)} disabled={applying} />
            {isSelected && <select aria-label={t('tagSuggestions.keepLabel')} className={fieldClass}
              value={keep} disabled={applying}
              onChange={e => setKeeper(prev => ({ ...prev, [g.key]: e.target.value }))}>
              {g.members.map(m => <option key={m.tag} value={m.tag}>
                {m.tag} · {t('tagSuggestions.uses', { count: m.count })}
              </option>)}
            </select>}
          </SettingsRow>;
        })}
      </>}
    <ConfirmModal
      isOpen={confirmOpen}
      onClose={() => { if (!applying) setConfirmOpen(false); }}
      onConfirm={applyBatch}
      title={t('tagSuggestions.title')}
      message={t('tagSuggestions.confirmBatch', { count: selectedMerges.length })}
      confirmLabel={t('tagSuggestions.mergeBtn')}
      loading={applying}
    />
  </SettingsCard>;
}


type DuplicateGroup = { groupId: string; maxSimilarity: number; memberCount: number; members: { id: string; title: string; scope: string; type: string; version: number; updatedAt: string }[] };

function KnowledgeHealthSection() {
  const { t } = useTranslation();
  const copy = useSettingsCopy();
  const navigate = useNavigate();
  const [stale, setStale] = useState<{ id: string; title: string; type: string; scope: string; confidenceScore: number; updatedAt: string; expiresAt: string | null }[]>([]);
  // null = not checked yet. Duplicate detection is a full scan of the base, so
  // it runs only when the user asks for it, never on mount (plan v2.6 1A.5).
  const [duplicates, setDuplicates] = useState<DuplicateGroup[] | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [loading, setLoading] = useState(true);
  // Per-group "keep" choice (groupId → member id). Default = first member
  // (server pre-sorts: version DESC, then updatedAt DESC).
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({});
  const [resolveGroup, setResolveGroup] = useState<DuplicateGroup | null>(null);
  const [resolving, setResolving] = useState(false);
  const [dupMessage, setDupMessage] = useState<string | null>(null);

  useEffect(() => {
    api.getStaleEntries().catch(() => []).then(setStale).finally(() => setLoading(false));
  }, []);

  const openEntry = (id: string) => navigate('/?edit=' + encodeURIComponent(id));

  const reloadDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      setDuplicates(await api.getDuplicateGroups());
    } catch {
      setDuplicates((prev) => prev ?? []);
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const keeperFor = (g: DuplicateGroup) => keepChoice[g.groupId] ?? g.members[0]?.id;

  const confirmResolve = async () => {
    if (!resolveGroup) return;
    const keeperId = keeperFor(resolveGroup);
    const toDelete = resolveGroup.members.filter((m) => m.id !== keeperId).map((m) => m.id);
    setResolving(true);
    try {
      const res = await api.bulkDeleteKnowledge(toDelete);
      setDupMessage(
        res.errors?.length
          ? t('health.deleteFailed', { error: res.errors[0] })
          : t('health.deleted', { count: res.deleted }),
      );
      setResolveGroup(null);
      await reloadDuplicates();
    } catch {
      setDupMessage(t('health.deleteFailed', { error: '' }));
      setResolveGroup(null);
    }
    setResolving(false);
    setTimeout(() => setDupMessage(null), 5000);
  };

  return <SettingsCard title={t('health.title')}>
    {loading ? <p className="py-4 text-sm text-muted-foreground">{t('health.loading')}</p> : <>
      <SettingsRow label={t('health.stale')}>
        <span className="text-sm text-muted-foreground">{stale.length === 0 ? t('health.staleEmpty') : stale.length}</span>
      </SettingsRow>
      {stale.map(entry => <SettingsRow key={entry.id} label={entry.title || copy.untitled}
        description={`${entry.scope} · ${entry.updatedAt.slice(0, 10)}`}>
        <Button type="button" variant="ghost" size="sm" onClick={() => openEntry(entry.id)}
          className="max-w-full whitespace-normal break-words text-left">
          {entry.title || copy.untitled}
        </Button>
      </SettingsRow>)}
      <SettingsRow label={t('health.duplicates')}>
        <Button type="button" variant="outline" size="sm" disabled={checkingDuplicates || resolving}
          onClick={reloadDuplicates} data-testid="check-duplicates">
          {checkingDuplicates && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
          {checkingDuplicates ? t('health.checkingDuplicates') : t('health.checkDuplicates')}
        </Button>
      </SettingsRow>
      {dupMessage && <p role="status" className="pb-4 text-sm text-muted-foreground">{dupMessage}</p>}
      {duplicates !== null && duplicates.length === 0 &&
        <p className="pb-4 text-sm text-muted-foreground">{t('health.dupEmpty')}</p>}
      {duplicates?.map(g => {
        const keeperId = keeperFor(g);
        const deleteCount = (g.memberCount ?? g.members.length) - 1;
        return <fieldset key={g.groupId} className="my-4 min-w-0 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">
            {t('health.groupTitle', { count: g.memberCount ?? g.members.length })} · {Math.round(g.maxSimilarity * 100)}%
          </legend>
          {g.members.map(m => <div key={m.id} className="flex flex-wrap items-center gap-2 py-2">
            <label className="flex min-w-0 items-center gap-2 text-sm">
              <input type="radio" name={`dup-${g.groupId}`} checked={keeperId === m.id}
                onChange={() => setKeepChoice(prev => ({ ...prev, [g.groupId]: m.id }))} disabled={resolving} />
              <span className="break-words">{m.title || copy.untitled}</span>
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={() => openEntry(m.id)}
              className="max-w-full whitespace-normal break-words text-left">
              {m.title || copy.untitled}
            </Button>
            <span className="text-xs text-muted-foreground">
              {m.scope} · {m.type} · v{m.version} · {m.updatedAt.slice(0, 10)}
            </span>
          </div>)}
          <Button type="button" variant="outline" size="sm" disabled={resolving || deleteCount === 0}
            onClick={() => setResolveGroup(g)}>
            <Trash2 aria-hidden="true" className="size-4" />
            {t('health.deleteOthers', { count: deleteCount })}
          </Button>
        </fieldset>;
      })}
    </>}
    <ConfirmModal
      isOpen={resolveGroup !== null}
      onClose={() => { if (!resolving) setResolveGroup(null); }}
      onConfirm={confirmResolve}
      title={t('health.duplicates')}
      message={resolveGroup ? t('health.confirmGroupDelete', { count: resolveGroup.members.length - 1 }) : ''}
      confirmLabel={resolveGroup ? t('health.deleteOthers', { count: resolveGroup.members.length - 1 }) : ''}
      loading={resolving}
    />
  </SettingsCard>;
}


function ThemeField() {
  const copy = useSettingsCopy();
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
  return <select id="settings-theme" className={fieldClass} value={theme} onChange={event => {
    const mode = event.target.value as ThemeMode;
    applyTheme(mode);
    setTheme(mode);
  }}>
    <option value="system">{copy.themeSystem}</option><option value="light">{copy.themeLight}</option><option value="dark">{copy.themeDark}</option>
  </select>;
}

function SettingsFields({ route }: { route: 'settings/telemetry' | 'settings/models' | 'settings/curation' }) {
  const { t } = useTranslation();
  const copy = useSettingsCopy();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<AppSettings | null>(null);
  const load = () => {
    setError(false);
    api.getSettings().then(value => { setSettings(value); setBaseline(value); }).catch(() => setError(true));
  };
  useEffect(load, []);
  const patchFor = (s: AppSettings) => route === 'settings/models' ? { cleanupLlmModel: s.cleanupLlmModel } : {
    cleanupEnabled: s.cleanupEnabled, cleanupIntervalDays: s.cleanupIntervalDays,
    cleanupUnreadDays: s.cleanupUnreadDays, cleanupDupThreshold: s.cleanupDupThreshold,
    curationAutonomy: s.curationAutonomy, curationModel: s.curationModel, curationClusterThreshold: s.curationClusterThreshold,
    curationTrashRetentionDays: s.curationTrashRetentionDays, curationIdleMinutes: s.curationIdleMinutes,
  };
  const dirty = settings !== null && baseline !== null && JSON.stringify(patchFor(settings)) !== JSON.stringify(patchFor(baseline));
  if (!settings) return error
    ? <div role="alert" className="mt-6 text-sm">{copy.loadFailed} <Button variant="outline" size="sm" onClick={load}>{copy.retry}</Button></div>
    : <p className="mt-6 text-sm text-muted-foreground">{copy.loading}</p>;
  if (route === 'settings/telemetry') return <SettingsCard title={copy.tokenHistory} description={copy.tokenHistoryDesc}><RetentionField copy={copy} value={settings.tokenUsageRetentionDays ?? 90} onSave={async days => {
    const confirmed = await api.updateSettings({ tokenUsageRetentionDays: days });
    if (typeof confirmed.tokenUsageRetentionDays !== 'number') throw new Error('Missing confirmed retention');
    setSettings(confirmed);
  }} /></SettingsCard>;
  const save = async () => {
    setSaving(true); setMessage(null); setError(false);
    try {
      const confirmed = await api.updateSettings(patchFor(settings));
      setSettings(confirmed);
      setBaseline(confirmed);
      setMessage(copy.saved);
    } catch { setError(true); }
    finally { setSaving(false); }
  };
  const footer = <>{error && <p role="alert" className="text-xs text-destructive">{copy.saveFailed}</p>}{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}<Button type="submit" size="sm" disabled={saving || !dirty}>{saving ? copy.saving : copy.save}</Button></>;
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    {route === 'settings/models' ? <SettingsCard title={copy.models} description={copy.modelsDesc} footer={footer}>
      <SettingsRow label={copy.mergeModel} description={copy.mergeModelDesc} htmlFor="settings-merge-model">
        <Input id="settings-merge-model" className="sm:w-56" required maxLength={100} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*(:[a-zA-Z0-9][a-zA-Z0-9._\-]*)?" value={settings.cleanupLlmModel} disabled={saving}
          onChange={event => setSettings({ ...settings, cleanupLlmModel: event.target.value })} />
      </SettingsRow>
      <SettingsRow label={copy.embeddingModel} description={copy.embeddingModelDesc}><ModelSetupControl /></SettingsRow>
    </SettingsCard> : <>
      <SettingsCard title={copy.reports} description={copy.reportsDesc}>
        <SettingsRow label={t('cleanup.enabled')} htmlFor="settings-cleanup-enabled">
          <Switch id="settings-cleanup-enabled" checked={settings.cleanupEnabled} disabled={saving} onCheckedChange={checked => setSettings({ ...settings, cleanupEnabled: checked })} />
        </SettingsRow>
      {([
        ['cleanupIntervalDays', 'cleanup.intervalDays', 1, 365, 1],
        ['cleanupUnreadDays', 'cleanup.unreadDays', 30, 3650, 1],
        ['cleanupDupThreshold', 'cleanup.dupThreshold', 0.8, 1, 0.01],
      ] as const).map(([key, label, min, max, step]) => <SettingsRow key={key} label={t(label)} htmlFor={`settings-${key}`}><Input id={`settings-${key}`} type="number" className="w-28" required min={min} max={max} step={step} disabled={saving} value={settings[key]}
        onChange={event => setSettings({ ...settings, [key]: event.target.valueAsNumber })} /></SettingsRow>)}
      </SettingsCard>
      <SettingsCard title={copy.autoCuration} description={<>{copy.autoCurationDesc} <Link className="underline" to="/curation">{t('curationPage.settings.open')}</Link></>} footer={footer}>
        <SettingsRow label={t('curationPage.settings.autonomy')} htmlFor="settings-curationAutonomy"><select id="settings-curationAutonomy" className={fieldClass} value={settings.curationAutonomy ?? 'suggest'} disabled={saving}
          onChange={event => setSettings({ ...settings, curationAutonomy: event.target.value as NonNullable<typeof settings.curationAutonomy> })}>
          {(['off', 'suggest', 'auto-safe', 'auto'] as const).map(mode => <option key={mode} value={mode}>{t(`curationPage.settings.autonomyOptions.${mode}`)}</option>)}</select></SettingsRow>
        <SettingsRow label={t('curationPage.settings.model')} htmlFor="settings-curationModel"><Input id="settings-curationModel" className="sm:w-56" required maxLength={100} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*(:[a-zA-Z0-9][a-zA-Z0-9._\-]*)?" disabled={saving} value={settings.curationModel ?? ''}
          onChange={event => setSettings({ ...settings, curationModel: event.target.value })} /></SettingsRow>
        {([
          ['curationClusterThreshold', 'curationPage.settings.threshold', 0.8, 1, 0.01, 0.85],
          ['curationTrashRetentionDays', 'curationPage.settings.trashRetention', 1, 3650, 1, 30],
          ['curationIdleMinutes', 'curationPage.settings.idle', 10, 1440, 1, 10],
        ] as const).map(([key, label, min, max, step, fallback]) => <SettingsRow key={key} label={t(label)} htmlFor={`settings-${key}`}><Input id={`settings-${key}`} type="number" className="w-28" required min={min} max={max} step={step} disabled={saving} value={settings[key] ?? fallback}
          onChange={event => setSettings({ ...settings, [key]: event.target.valueAsNumber })} /></SettingsRow>)}
      </SettingsCard>
    </>}
  </form>;
}

function ModelSetupControl() {
  const copy = useSettingsCopy();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return <div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
    setBusy(true); setMessage(null);
    try { const result = await api.setupModel(); setMessage(result.success ? copy.modelReady : copy.modelFailed); }
    catch { setMessage(copy.modelFailed); }
    finally { setBusy(false); }
  }}>{busy ? copy.installing : copy.installModel}</Button>
    {message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}
  </div>;
}

export function AgentReadinessSection() {
  const copy = useSettingsCopy();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    setStatus(null);
    api.getSetupStatus().then(setStatus).catch(() => setFailed(true));
  };
  useEffect(load, []);

  return <SettingsCard title={copy.readiness} description={copy.readinessDesc}
    footer={<Button type="button" variant="outline" size="sm" onClick={load}>
      <RefreshCw aria-hidden="true" className="size-4" />{copy.refreshReadiness}
    </Button>}>
    {([
      ['nodeReady', copy.nodeRuntime],
      ['sdkReady', copy.sdk],
      ['configsReady', copy.agentConfiguration],
      ['databaseReady', copy.databaseSetup],
      ['ollamaInstalled', copy.ollamaInstalled],
      ['ollamaRunning', copy.ollamaReachable],
      ['modelAvailable', copy.embeddingModel],
    ] as const).map(([key, label]) => <SettingsRow key={key} label={label}>
      <StatusBadge status={status ? (status[key] ? 'ok' : 'error') : 'unknown'}
        label={status ? (status[key] ? copy.ready : copy.notReady) : copy.unknown} />
    </SettingsRow>)}
    {!status && <p role={failed ? 'alert' : 'status'} className="py-4 text-sm text-muted-foreground">
      {failed ? copy.readinessFailed : copy.loadingReadiness}
    </p>}
    <p className="py-4 text-xs text-muted-foreground">
      {copy.redeployHintBefore}{' '}
      <Link className="underline" to="/settings/advanced">{copy.advancedSettings}</Link>{' '}
      {copy.redeployHintAfter}
    </p>
  </SettingsCard>;
}
