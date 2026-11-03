import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client.js';
import { useWidgetClose } from '../shared/useWidgetClose.js';

interface PlanMetrics {
  plans: { total: number; draft: number; active: number; completed: number; archived: number };
  tasks: { total: number; pending: number; inProgress: number; completed: number; avgPerPlan: number };
}

const REFRESH_INTERVAL = 10_000;

function navigateMainApp(route: string) {
  import('@tauri-apps/api/event').then(({ emit }) => {
    emit('navigate', route);
  }).catch(() => {});
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  active: '#3b82f6',
  completed: '#22c55e',
  archived: '#8b5cf6',
};

function StatusPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 0',
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#a5b4fc' }}>{value}</span>
    </div>
  );
}

export function PlanStatsWidget() {
  const [metrics, setMetrics] = useState<PlanMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const handleClose = useWidgetClose();

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getPlanMetrics();
      setMetrics(data);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  const completionPct = metrics && metrics.tasks.total > 0
    ? Math.round((metrics.tasks.completed / metrics.tasks.total) * 100)
    : 0;

  return (
    <div className="widget-shell">
      <div className="widget-drag-region" data-tauri-drag-region>
        <span className="widget-title" data-tauri-drag-region>Plan Stats</span>
        <button className="widget-close" onClick={handleClose} title="Close">×</button>
      </div>

      <div className="widget-content">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div style={{
              width: 20, height: 20,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        ) : (
          <>
            {/* Total Plans */}
            <button
              type="button"
              onClick={() => navigateMainApp('/insights/plans')}
              style={{
              textAlign: 'center',
              padding: '4px 0 10px',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              marginBottom: 6,
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#6366f1' }}>
                {metrics?.plans.total ?? 0}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Total Plans
              </div>
            </button>

            {/* Status breakdown */}
            <StatusPill label="Active" value={metrics?.plans.active ?? 0} color={STATUS_COLORS.active} />
            <StatusPill label="Draft" value={metrics?.plans.draft ?? 0} color={STATUS_COLORS.draft} />
            <StatusPill label="Completed" value={metrics?.plans.completed ?? 0} color={STATUS_COLORS.completed} />

            {/* Task completion bar */}
            <div style={{
              marginTop: 8,
              padding: '6px 0 0',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>Task Completion</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#a5b4fc' }}>{completionPct}%</span>
              </div>
              <div style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${completionPct}%`,
                  borderRadius: 2,
                  backgroundColor: '#22c55e',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
