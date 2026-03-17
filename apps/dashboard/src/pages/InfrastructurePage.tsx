import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

interface Health {
  database: { connected: boolean; error?: string };
  ollama: { connected: boolean; model?: string; error?: string };
  docker: { running: boolean; containers: { name: string; status: string }[] };
}

const POLL_INTERVAL = 5000;

export function InfrastructurePage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<Health | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchHealth = useCallback(() => {
    api.getHealth().then(data => setHealth(data as Health)).catch(console.error);
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const allHealthy = health?.database.connected && health?.ollama.connected && health?.docker.running;

  const handleRepair = async () => {
    if (!confirm(t('infra.repairConfirm'))) return;
    setRepairing(true);
    setActionMessage(null);
    try {
      const result = await api.repair();
      setActionMessage({
        type: result.success ? 'success' : 'error',
        text: result.message,
      });
      if (result.success) fetchHealth();
    } catch (error) {
      setActionMessage({ type: 'error', text: String(error) });
    } finally {
      setRepairing(false);
    }
  };

  const handleUninstall = async () => {
    if (!confirm(t('infra.uninstallConfirm'))) return;
    if (!confirm(t('infra.uninstallConfirm2'))) return;
    setUninstalling(true);
    setActionMessage(null);
    try {
      await api.uninstall();
      setActionMessage({ type: 'success', text: t('infra.uninstallSuccess') });
      // Server will shut down — show final message
      setTimeout(() => {
        document.title = 'AI Knowledge Base — Uninstalled';
      }, 2000);
    } catch (error) {
      setActionMessage({ type: 'error', text: String(error) });
      setUninstalling(false);
    }
  };

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
          <StatusCard title={t('infra.database')} ok={health.database.connected} detail={health.database.error} />
          <StatusCard title={t('infra.ollama')} ok={health.ollama.connected} detail={health.ollama.model || health.ollama.error} />
          <StatusCard title={t('infra.docker')} ok={health.docker.running} />
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>Loading...</p>
      )}

      {/* Containers */}
      {health && health.docker.containers.length > 0 && (
        <div style={{
          backgroundColor: 'var(--bg-card)', borderRadius: 10,
          border: '1px solid var(--border)', padding: 16, marginBottom: 24,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Containers
          </h3>
          {health.docker.containers.map(c => (
            <div key={c.name} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <span style={{ color: c.status === 'running' ? 'var(--success)' : 'var(--error)', fontSize: 12 }}>●</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.status}</span>
            </div>
          ))}
        </div>
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

      {/* Action Buttons */}
      <div style={{
        backgroundColor: 'var(--bg-card)', borderRadius: 10,
        border: '1px solid var(--border)', padding: 20,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('infra.actions')}
        </h3>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* Repair Button */}
          <button
            onClick={handleRepair}
            disabled={repairing || uninstalling}
            style={{
              padding: '12px 24px', borderRadius: 8, border: 'none',
              backgroundColor: 'var(--accent)', color: '#fff',
              cursor: repairing ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600,
              opacity: (repairing || uninstalling) ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            🔧 {repairing ? t('infra.repairing') : t('infra.repair')}
          </button>

          {/* Uninstall Button */}
          <button
            onClick={handleUninstall}
            disabled={repairing || uninstalling}
            style={{
              padding: '12px 24px', borderRadius: 8,
              border: '1px solid var(--error)', backgroundColor: 'transparent',
              color: 'var(--error)',
              cursor: uninstalling ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600,
              opacity: (repairing || uninstalling) ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            🗑️ {uninstalling ? t('infra.uninstalling') : t('infra.uninstall')}
          </button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 12 }}>
          {t('infra.repairHint')}
        </p>
      </div>
    </div>
  );
}
