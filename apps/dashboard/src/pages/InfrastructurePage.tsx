import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

interface Health {
  database: { connected: boolean; path?: string; error?: string };
  ollama: { connected: boolean; model?: string; host?: string; error?: string };
}

const POLL_INTERVAL = 5000;

export function InfrastructurePage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<Health | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uninstallStep, setUninstallStep] = useState(0); // 0=hidden, 1=first confirm, 2=final confirm, 3=running

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
        {ok ? t('infra.connected') : t('infra.disconnected')}
      </span>
      {detail && <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{detail}</p>}
    </div>
  );

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t('infra.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>{t('infra.subtitle')}</p>

      {/* Service Status Cards */}
      {health ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <StatusCard
            title={t('infra.database')}
            ok={health.database.connected}
            detail={health.database.connected ? health.database.path : health.database.error}
          />
          <StatusCard
            title={t('infra.ollama')}
            ok={health.ollama.connected}
            detail={health.ollama.connected ? `${health.ollama.model} @ ${health.ollama.host}` : health.ollama.error}
          />
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>Loading...</p>
      )}

      {/* Overall Status */}
      <div style={{
        backgroundColor: 'var(--bg-card)', borderRadius: 10,
        border: `1px solid ${allHealthy ? 'var(--success)' : 'var(--border)'}`,
        padding: 16, marginBottom: 24, textAlign: 'center',
      }}>
        <span style={{ fontSize: 32 }}>{allHealthy ? '✅' : health ? '⚠️' : '⏳'}</span>
        <p style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: allHealthy ? 'var(--success)' : 'var(--warning)' }}>
          {allHealthy ? t('infra.allReady') : health ? t('infra.degraded') : t('infra.checking')}
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

      {/* Danger Zone */}
      <div style={{
        backgroundColor: 'var(--bg-card)', borderRadius: 10,
        border: '1px solid var(--error)', padding: 20, marginTop: 24,
        opacity: 0.8,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--error)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Danger Zone
        </h3>

        {uninstallStep === 0 && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Remove all data, configurations, Ollama, and the app itself.
            </p>
            <button
              onClick={() => setUninstallStep(1)}
              style={{
                padding: '10px 20px', borderRadius: 8,
                border: '1px solid var(--error)', backgroundColor: 'transparent',
                color: 'var(--error)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Uninstall Everything
            </button>
          </>
        )}

        {uninstallStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--error)', fontWeight: 600 }}>
              This will remove ALL data, configurations, and the app. Continue?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setUninstallStep(2)}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', backgroundColor: 'var(--error)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Yes, continue
              </button>
              <button
                onClick={() => setUninstallStep(0)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {uninstallStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--error)', fontWeight: 600 }}>
              Are you absolutely sure? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  setUninstallStep(3);
                  setActionMessage({ type: 'success', text: 'Uninstalling... The app will close shortly.' });
                  try {
                    await api.uninstallAll();
                  } catch {
                    // Server shuts down during uninstall — expected
                  }
                  // Show goodbye message and try to close
                  setTimeout(() => {
                    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;background:#0a0a1a;color:#22c55e;font-family:sans-serif"><h2>Uninstall complete</h2><p style="color:#6b7280">You can close this window.</p></div>';
                    try { window.close(); } catch { /* ignore */ }
                  }, 2000);
                }}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', backgroundColor: 'var(--error)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Yes, uninstall everything
              </button>
              <button
                onClick={() => setUninstallStep(0)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {uninstallStep === 3 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Uninstalling... The app will close shortly.</p>
        )}
      </div>
    </div>
  );
}
