import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

interface Health {
  database: { connected: boolean; error?: string };
  ollama: { connected: boolean; model?: string; error?: string };
  docker: { running: boolean; containers: { name: string; status: string }[] };
}

const POLL_INTERVAL = 5000;

export function HealthPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<Health | null>(null);

  const fetchHealth = useCallback(() => {
    api.getHealth().then(data => setHealth(data as Health)).catch(console.error);
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchHealth]);

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
        {ok ? t('health.connected') : t('health.disconnected')}
      </span>
      {detail && <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{detail}</p>}
    </div>
  );

  if (!health) return <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{t('health.title')}</h1>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <StatusCard title={t('health.database')} ok={health.database.connected} detail={health.database.error} />
        <StatusCard title={t('health.ollama')} ok={health.ollama.connected} detail={health.ollama.model || health.ollama.error} />
        <StatusCard title={t('health.docker')} ok={health.docker.running} />
      </div>
      {health.docker.containers.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Containers</h3>
          {health.docker.containers.map(c => (
            <div key={c.name} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6 }}>
              <span style={{ color: c.status === 'running' ? 'var(--success)' : 'var(--error)', fontSize: 12 }}>●</span>
              <span style={{ fontSize: 13 }}>{c.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
