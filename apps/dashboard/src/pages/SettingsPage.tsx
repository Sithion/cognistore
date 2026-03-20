import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { triggerUpdateCheck, onUpdateState } from '../components/UpdateChecker.js';
import { ConfirmModal } from '../components/ConfirmModal.js';

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
  const { t, i18n } = useTranslation();
  const [health, setHealth] = useState<Health | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uninstallStep, setUninstallStep] = useState(0);
  const [updateState, setUpdateState] = useState<string>('idle');
  const [checkResult, setCheckResult] = useState<string | null>(null);

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
      } else if (state === 'unavailable') {
        setCheckResult('unavailable');
        setTimeout(() => setCheckResult(null), 5000);
      }
    });
  }, []);

  const fetchHealth = useCallback(() => {
    api.getHealth().then(data => setHealth(data as Health)).catch(console.error);
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const allHealthy = health?.database.connected && health?.ollama.connected;

  const StatusCard = ({ title, ok, detail }: { title: string; ok: boolean; detail?: string }) => (
    <div style={{
      backgroundColor: 'var(--bg-card)', borderRadius: 10,
      border: `1px solid ${ok ? 'var(--success)' : 'var(--error)'}`,
      padding: 20, flex: 1, minWidth: 200,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{ok ? '🟢' : '🔴'}</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      </div>
      <span style={{ color: ok ? 'var(--success)' : 'var(--error)', fontSize: 13 }}>
        {ok ? t('monitoring.connected') : t('monitoring.disconnected')}
      </span>
      {detail && <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{detail}</p>}
    </div>
  );

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t('monitoring.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>{t('monitoring.subtitle')}</p>

      {/* ── Infrastructure Monitoring Section ── */}
      <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 16 }}>
        {t('monitoring.infraSection')}
      </h2>

      {/* Service Status Cards */}
      {health ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <StatusCard
            title={t('monitoring.database')}
            ok={health.database.connected}
            detail={health.database.connected ? health.database.path : health.database.error}
          />
          <StatusCard
            title={t('monitoring.ollama')}
            ok={health.ollama.connected}
            detail={health.ollama.connected ? `${health.ollama.model} @ ${health.ollama.host}` : health.ollama.error}
          />
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>{t('stats.loading')}</p>
      )}

      {/* Overall Status */}
      <div style={{
        backgroundColor: 'var(--bg-card)', borderRadius: 10,
        border: `1px solid ${allHealthy ? 'var(--success)' : 'var(--border)'}`,
        padding: 16, marginBottom: 24, textAlign: 'center',
      }}>
        <span style={{ fontSize: 32 }}>{allHealthy ? '✅' : health ? '⚠️' : '⏳'}</span>
        <p style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: allHealthy ? 'var(--success)' : 'var(--warning)' }}>
          {allHealthy ? t('monitoring.allReady') : health ? t('monitoring.degraded') : t('monitoring.checking')}
        </p>
      </div>

      {/* Action Message */}
      {actionMessage && (
        <div style={{
          backgroundColor: actionMessage.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${actionMessage.type === 'success' ? 'var(--success)' : 'var(--error)'}`,
          borderRadius: 8, padding: 12, marginBottom: 24,
          color: actionMessage.type === 'success' ? 'var(--success)' : 'var(--error)',
          fontSize: 13,
        }}>
          {actionMessage.text}
        </div>
      )}

      {/* ── Updates Section ── */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 24 }}>
        <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {t('update.section')}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => { setCheckResult(null); triggerUpdateCheck(); }}
            disabled={updateState === 'checking'}
            style={{
              padding: '8px 16px', borderRadius: 6,
              border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
              cursor: updateState === 'checking' ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {updateState === 'checking' ? (
              <>
                <span style={{ width: 12, height: 12, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                {t('update.checking')}
              </>
            ) : (
              t('update.check')
            )}
          </button>
          {checkResult === 'upToDate' && <span style={{ fontSize: 13, color: 'var(--success)' }}>{t('update.upToDate')}</span>}
          {checkResult === 'available' && <span style={{ fontSize: 13, color: 'var(--accent)' }}>{t('update.available')}</span>}
          {checkResult === 'error' && <span style={{ fontSize: 13, color: 'var(--error)' }}>{t('update.checkFailed')}</span>}
          {checkResult === 'unavailable' && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('update.desktopOnly')}</span>}
        </div>
      </div>

      {/* ── Language Section ── */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 24 }}>
        <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {t('settings.language')}
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              style={{
                padding: '8px 16px', borderRadius: 6,
                border: i18n.language === lang.code ? '1px solid var(--accent)' : '1px solid var(--border)',
                backgroundColor: i18n.language === lang.code ? 'var(--accent)' : 'var(--bg-card)',
                color: i18n.language === lang.code ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Maintenance Section ── */}
      <MaintenanceSection />

      {/* ── Data Management Section ── */}
      <DataManagementSection />

      {/* ── Uninstall Section ── */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 24 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--error)', marginBottom: 16 }}>
        {t('settings.dangerZone')}
      </h2>

      <div style={{
        backgroundColor: 'var(--bg-card)', borderRadius: 10,
        border: '1px solid var(--error)', padding: 20,
        opacity: 0.8,
      }}>
        {uninstallStep === 3 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('settings.uninstallingMsg')}</p>
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {t('settings.uninstallDesc')}
            </p>
            <button
              onClick={() => setUninstallStep(1)}
              style={{
                padding: '10px 20px', borderRadius: 8,
                border: '1px solid var(--error)', backgroundColor: 'transparent',
                color: 'var(--error)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('settings.uninstallBtn')}
            </button>
          </>
        )}
      </div>

      {/* Uninstall Step 1 — first confirmation modal */}
      <ConfirmModal
        isOpen={uninstallStep === 1}
        onClose={() => setUninstallStep(0)}
        onConfirm={() => setUninstallStep(2)}
        title={t('settings.uninstallBtn')}
        message={t('settings.uninstallConfirm1')}
        confirmLabel={t('settings.yesContinue')}
      />

      {/* Uninstall Step 2 — final confirmation modal */}
      <ConfirmModal
        isOpen={uninstallStep === 2}
        onClose={() => setUninstallStep(0)}
        onConfirm={async () => {
          setUninstallStep(3);
          setActionMessage({ type: 'success', text: t('settings.uninstallingMsg') });
          try {
            await api.uninstallAll();
          } catch {
            // Server shuts down during uninstall — expected
          }
          setTimeout(() => {
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;background:#0a0a1a;color:#22c55e;font-family:sans-serif"><h2>Uninstall complete</h2><p style="color:#6b7280">You can close this window.</p></div>';
            try { window.close(); } catch { /* ignore */ }
          }, 2000);
        }}
        title={t('settings.uninstallBtn')}
        message={t('settings.uninstallConfirm2')}
        confirmLabel={t('settings.yesUninstallAll')}
      />
      </div>
    </div>
  );
}

function MaintenanceSection() {
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
      setCleanResult(`${res.orphansRemoved} orphan${res.orphansRemoved !== 1 ? 's' : ''} removed${res.sizeAfter ? ` — DB: ${res.sizeAfter}` : ''}`);
    } catch {
      setCleanResult('Cleanup failed');
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
        setRedeployResult({ type: 'success', text: 'All configurations re-deployed successfully' });
      } else {
        setRedeployResult({ type: 'error', text: `${failed.length} step(s) failed: ${failed.map((f) => f.step).join(', ')}` });
      }
    } catch {
      setRedeployResult({ type: 'error', text: 'Re-deploy failed' });
    }
    setRedeploying(false);
    setTimeout(() => setRedeployResult(null), 5000);
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 24 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 16 }}>
        {t('settings.maintenance')}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleRedeploy}
            disabled={redeploying}
            title="Re-deploy skills, hooks, instructions, and MCP configs without losing data"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: redeploying ? 'not-allowed' : 'pointer',
              opacity: redeploying ? 0.6 : 1,
            }}
          >
            {redeploying ? (
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            ) : (
              <span style={{ fontSize: 14 }}>🔄</span>
            )}
            {t('settings.redeploy')}
          </button>
          {redeployResult && (
            <span style={{ fontSize: 12, color: redeployResult.type === 'success' ? 'var(--success)' : 'var(--error)' }}>
              {redeployResult.text}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            title="Remove unused embeddings"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: cleaning ? 'not-allowed' : 'pointer',
              opacity: cleaning ? 0.6 : 1,
            }}
          >
            {cleaning ? (
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            ) : (
              <span style={{ fontSize: 14 }}>🗑</span>
            )}
            {t('settings.removeEmbeddings')}
          </button>
          {cleanResult && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{cleanResult}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DataManagementSection() {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleFileImport = async (type: 'knowledge' | 'plans') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'knowledge' ? '.json,.csv' : '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setImporting(true);
      setImportResult(null);

      try {
        const text = await file.text();

        if (type === 'knowledge') {
          if (file.name.endsWith('.csv')) {
            const result = await api.importKnowledge({ csv: text });
            setImportResult({
              type: 'success',
              text: `${result.imported} imported, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
            });
          } else {
            const data = JSON.parse(text);
            const result = await api.importKnowledge({ entries: data.entries || data });
            setImportResult({
              type: 'success',
              text: `${result.imported} imported, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
            });
          }
        } else {
          const data = JSON.parse(text);
          const result = await api.importPlans({ plans: data.plans || data });
          setImportResult({
            type: 'success',
            text: `${result.imported} imported, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
          });
        }
      } catch (err) {
        setImportResult({ type: 'error', text: `Import failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      setImporting(false);
      setTimeout(() => setImportResult(null), 8000);
    };
    input.click();
  };

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', cursor: 'pointer',
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 24 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 16 }}>
        {t('settings.dataManagement')}
      </h2>

      {/* Export */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('settings.exportDesc')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => api.exportKnowledge('json')} style={btnStyle}>
            ↓ {t('settings.exportKnowledgeJson')}
          </button>
          <button onClick={() => api.exportKnowledge('csv')} style={btnStyle}>
            ↓ {t('settings.exportKnowledgeCsv')}
          </button>
          <button onClick={() => api.exportPlans()} style={btnStyle}>
            ↓ {t('settings.exportPlansJson')}
          </button>
        </div>
      </div>

      {/* Import */}
      <div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('settings.importDesc')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => handleFileImport('knowledge')} disabled={importing} style={{ ...btnStyle, opacity: importing ? 0.5 : 1 }}>
            {importing ? (
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            ) : '↑'} {t('settings.importKnowledge')}
          </button>
          <button onClick={() => handleFileImport('plans')} disabled={importing} style={{ ...btnStyle, opacity: importing ? 0.5 : 1 }}>
            {importing ? (
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--text-secondary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            ) : '↑'} {t('settings.importPlans')}
          </button>
          {importResult && (
            <span style={{ fontSize: 12, color: importResult.type === 'success' ? 'var(--success)' : 'var(--error)' }}>
              {importResult.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
