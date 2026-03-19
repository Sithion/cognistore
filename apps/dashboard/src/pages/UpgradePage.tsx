import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

declare const __APP_VERSION__: string;

interface UpgradeStep {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
}

const STEP_LABELS: Record<string, string> = {
  database: 'Database Schema',
  'instructions-claude': 'Claude Code Instructions',
  'instructions-copilot': 'Copilot Instructions',
  'mcp-configs': 'MCP Configurations',
  skills: 'Skills & Hooks',
  version: 'Save Version',
};

function StepIcon({ status }: { status: string }) {
  if (status === 'success') return <span style={{ color: '#22c55e', fontSize: 18 }}>✓</span>;
  if (status === 'error') return <span style={{ color: '#ef4444', fontSize: 18 }}>✗</span>;
  if (status === 'running') {
    return (
      <span style={{ display: 'inline-block', width: 16, height: 16 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: 'spin 0.8s linear infinite' }}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="22 16" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>○</span>;
}

export function UpgradePage({ fromVersion, onComplete }: { fromVersion: string; onComplete: () => void }) {
  const [steps, setSteps] = useState<UpgradeStep[]>([
    { step: 'database', status: 'pending' },
    { step: 'instructions-claude', status: 'pending' },
    { step: 'instructions-copilot', status: 'pending' },
    { step: 'mcp-configs', status: 'pending' },
    { step: 'skills', status: 'pending' },
    { step: 'version', status: 'pending' },
  ]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  const runUpgrade = useCallback(async () => {
    // Mark all as running
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'running' as const })));

    try {
      const result = await api.runUpgrade();

      // Map results to steps
      setSteps((prev) =>
        prev.map((s) => {
          const r = result.results.find((r) => r.step === s.step);
          if (r) return { ...s, status: r.status as 'success' | 'error', message: r.message };
          return { ...s, status: 'success' as const };
        })
      );

      if (result.success) {
        setDone(true);
        setTimeout(onComplete, 1500);
      } else {
        setError(true);
      }
    } catch (e: any) {
      setSteps((prev) => prev.map((s) => s.status === 'running' ? { ...s, status: 'error' as const, message: e.message } : s));
      setError(true);
    }
  }, [onComplete]);

  useEffect(() => {
    // Start upgrade automatically after a brief delay
    const timer = setTimeout(runUpgrade, 500);
    return () => clearTimeout(timer);
  }, [runUpgrade]);

  const completed = steps.filter((s) => s.status === 'success').length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg-main)',
      flexDirection: 'column', gap: 0,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ width: 440, padding: 32 }}>
        {/* Version Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Updating AI Knowledge Base
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 14 }}>
            <span style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            }}>
              v{fromVersion}
            </span>
            <span style={{ color: 'var(--accent)', fontSize: 18 }}>→</span>
            <span style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              backgroundColor: 'var(--accent)', color: '#fff',
            }}>
              v{__APP_VERSION__}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ height: 4, backgroundColor: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              backgroundColor: done ? '#22c55e' : 'var(--accent)',
              borderRadius: 2, transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((s) => (
            <div key={s.step} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 8,
              backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)',
            }}>
              <StepIcon status={s.status} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {STEP_LABELS[s.step] || s.step}
                </span>
                {s.message && s.status === 'error' && (
                  <p style={{ fontSize: 11, color: 'var(--error)', marginTop: 2 }}>{s.message}</p>
                )}
              </div>
              {s.status === 'success' && (
                <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>Done</span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          {done && (
            <p style={{ color: '#22c55e', fontSize: 14, fontWeight: 600 }}>
              Update complete! Opening dashboard...
            </p>
          )}
          {error && (
            <button
              onClick={runUpgrade}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                backgroundColor: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
