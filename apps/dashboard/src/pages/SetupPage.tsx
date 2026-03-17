import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

interface SetupStatus {
  dockerInstalled: boolean;
  databaseReady: boolean;
  ollamaReady: boolean;
  modelAvailable: boolean;
  allReady: boolean;
}

const steps = ['docker', 'database', 'ollama', 'model', 'ready'];
const POLL_INTERVAL = 5000;

export function SetupPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SetupStatus | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const data = await api.getSetupStatus() as SetupStatus;
      setStatus(data);
    } catch {
      setStatus({ dockerInstalled: false, databaseReady: false, ollamaReady: false, modelAvailable: false, allReady: false });
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const getStepStatus = (step: string): 'done' | 'error' | 'pending' => {
    if (!status) return 'pending';
    switch (step) {
      case 'docker': return status.dockerInstalled ? 'done' : 'error';
      case 'database': return status.databaseReady ? 'done' : status.dockerInstalled ? 'error' : 'pending';
      case 'ollama': return status.ollamaReady ? 'done' : status.dockerInstalled ? 'error' : 'pending';
      case 'model': return status.modelAvailable ? 'done' : status.ollamaReady ? 'error' : 'pending';
      case 'ready': return status.allReady ? 'done' : 'pending';
      default: return 'pending';
    }
  };

  const stepLabels: Record<string, string> = {
    docker: 'Docker Desktop',
    database: 'PostgreSQL + pgvector',
    ollama: 'Ollama (Embedding Engine)',
    model: 'Embedding Model (all-minilm)',
    ready: t('setup.ready'),
  };

  const statusColors = { done: 'var(--success)', error: 'var(--error)', pending: 'var(--text-secondary)' };
  const statusIcons = { done: '✓', error: '✗', pending: '○' };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>{t('setup.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 32 }}>{t('setup.welcome')}</p>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 24 }}>
        {steps.map((step, i) => {
          const s = getStepStatus(step);
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
              borderBottom: i < steps.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: s === 'done' ? 'var(--success)' : 'var(--bg-input)',
                color: statusColors[s], fontSize: 14, fontWeight: 700,
                border: s !== 'done' ? `1px solid ${statusColors[s]}` : 'none',
              }}>
                {statusIcons[s]}
              </span>
              <span style={{ flex: 1, fontSize: 14, color: s === 'pending' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                {stepLabels[step]}
              </span>
              <span style={{ fontSize: 11, color: statusColors[s], fontWeight: 600 }}>
                {s === 'done' ? 'OK' : s === 'error' ? 'FAILED' : 'WAITING'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
