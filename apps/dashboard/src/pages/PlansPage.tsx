import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  active: '#3b82f6',
  completed: '#22c55e',
  archived: '#a78bfa',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

const TYPE_COLORS: Record<string, string> = {
  decision: '#3b82f6',
  pattern: '#8b5cf6',
  fix: '#ef4444',
  constraint: '#f59e0b',
  gotcha: '#ec4899',
};

interface PlanEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  scope: string;
  source: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PlanTask {
  id: string;
  planId: string;
  description: string;
  status: string;
  priority: string;
  notes: string | null;
  position: number;
}

interface PlanRelation {
  entry: Record<string, unknown>;
  relationType: string;
}

/* ── Badges ── */

function StatusBadge({ status }: { status: string }) {
  const s = status || 'draft';
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      backgroundColor: `${STATUS_COLORS[s] || '#6b7280'}22`,
      color: STATUS_COLORS[s] || '#6b7280',
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {s}
    </span>
  );
}

/* ── Task Status Icon ── */

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return <span style={{ color: '#22c55e', fontSize: 16, fontWeight: 700, lineHeight: 1 }}>✓</span>;
  }
  if (status === 'in_progress') {
    return (
      <span style={{ display: 'inline-block', width: 14, height: 14 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="20 14" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  // pending
  return <span style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1 }}>○</span>;
}

/* ── Progress Bar ── */

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const barColor = pct === 100 ? '#22c55e' : pct > 50 ? 'var(--accent)' : '#6b7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ flex: 1, height: 6, backgroundColor: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {completed}/{total}
      </span>
    </div>
  );
}

/* ── Mini Progress (for plan cards) ── */

function MiniProgress({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round((completed / total) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
      <div style={{ width: 50, height: 4, backgroundColor: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? '#22c55e' : 'var(--accent)', borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{completed}/{total}</span>
    </div>
  );
}

/* ── Task Item ── */

function TaskItem({ task, expandedNotes, onToggleNotes }: {
  task: PlanTask;
  expandedNotes: boolean;
  onToggleNotes: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex', gap: 8, padding: '8px 10px',
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority] || '#6b7280'}`,
        backgroundColor: 'var(--bg-main)', borderRadius: '0 6px 6px 0',
        opacity: task.status === 'completed' ? 0.6 : 1,
      }}
    >
      <div style={{ paddingTop: 1 }}>
        <TaskStatusIcon status={task.status} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontSize: 12,
          textDecoration: task.status === 'completed' ? 'line-through' : 'none',
          color: task.status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
        }}>
          {task.description}
        </span>
        {task.notes && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleNotes(); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 9, marginLeft: 6, padding: 0 }}
            >
              {expandedNotes ? '▼' : '▶'} notes
            </button>
            {expandedNotes && (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: 4 }}>
                {task.notes}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main PlansPage ── */

export function PlansPage() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedPlan, setSelectedPlan] = useState<PlanEntry | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [relations, setRelations] = useState<PlanRelation[]>([]);
  const [activePlans, setActivePlans] = useState<PlanEntry[]>([]);
  const [activeTasksMap, setActiveTasksMap] = useState<Record<string, PlanTask[]>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Load all plans
  const loadPlans = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listPlans(50, statusFilter || undefined);
      setPlans(data as PlanEntry[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load plans');
    }
    setLoading(false);
  }, [statusFilter]);

  // Load active plans with tasks (for top section)
  const loadActivePlans = useCallback(async () => {
    try {
      const active = await api.listPlans(10, 'active');
      setActivePlans(active as PlanEntry[]);
      const tasksMap: Record<string, PlanTask[]> = {};
      for (const plan of active as PlanEntry[]) {
        try {
          tasksMap[plan.id] = await api.listPlanTasks(plan.id) as PlanTask[];
        } catch { tasksMap[plan.id] = []; }
      }
      setActiveTasksMap(tasksMap);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadPlans(); loadActivePlans(); }, [loadPlans, loadActivePlans]);

  // Poll plans list and active plans every 10s
  useEffect(() => {
    pollRef.current = setInterval(() => { loadPlans(); loadActivePlans(); }, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadPlans, loadActivePlans]);

  // Refresh selected plan detail (status, tasks, relations)
  const refreshSelectedPlan = useCallback(async (planId: string) => {
    try {
      const [planData, t, r] = await Promise.all([
        api.getPlan(planId),
        api.listPlanTasks(planId),
        api.getPlanRelations(planId),
      ]);
      if (planData) setSelectedPlan(planData as PlanEntry);
      setTasks(t as PlanTask[]);
      setRelations(r as PlanRelation[]);
    } catch { /* silent — don't clear on transient errors */ }
  }, []);

  // Poll selected plan every 5s
  useEffect(() => {
    if (!selectedPlan) return;
    const id = selectedPlan.id;
    const interval = setInterval(() => refreshSelectedPlan(id), 5000);
    return () => clearInterval(interval);
  }, [selectedPlan?.id, refreshSelectedPlan]);

  const selectPlan = async (plan: PlanEntry) => {
    setSelectedPlan(plan);
    try {
      const [t, r] = await Promise.all([
        api.listPlanTasks(plan.id),
        api.getPlanRelations(plan.id),
      ]);
      setTasks(t as PlanTask[]);
      setRelations(r as PlanRelation[]);
    } catch {
      setTasks([]);
      setRelations([]);
    }
  };

  const toggleNotes = (taskId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const inputRelations = relations.filter((r) => r.relationType === 'input');
  const outputRelations = relations.filter((r) => r.relationType === 'output');
  const statusFilters = ['', 'draft', 'active', 'completed', 'archived'];

  // ── Detail View (full page) ──
  if (selectedPlan) {
    return (
      <div>
        <button
          onClick={() => setSelectedPlan(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 13, padding: 0,
          }}
        >
          ← Back to plans
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <StatusBadge status={selectedPlan.status} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selectedPlan.scope}</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>{selectedPlan.title}</h1>

        {/* Tasks */}
        {tasks.length > 0 && (
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.tasks')}
            </h3>
            <ProgressBar completed={completedTasks} total={tasks.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  expandedNotes={expandedNotes.has(task.id)}
                  onToggleNotes={() => toggleNotes(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {selectedPlan.content}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
            {selectedPlan.tags.map((tag) => (
              <span key={tag} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, backgroundColor: 'var(--bg-input)', color: 'var(--accent)' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Relations */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.input')}
            </h3>
            {inputRelations.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('plans.noRelations')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {inputRelations.map((rel) => <RelationCard key={rel.entry.id as string} entry={rel.entry} />)}
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.output')}
            </h3>
            {outputRelations.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('plans.noRelations')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {outputRelations.map((rel) => <RelationCard key={rel.entry.id as string} entry={rel.entry} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── List View ──
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{t('plans.title')}</h1>

      {/* ── Active Plans Section ── */}
      {activePlans.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {t('plans.activePlans')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activePlans.map((plan) => {
              const planTasks = activeTasksMap[plan.id] || [];
              const done = planTasks.filter((t) => t.status === 'completed').length;
              return (
                <div
                  key={plan.id}
                  onClick={() => selectPlan(plan)}
                  style={{
                    backgroundColor: 'var(--bg-card)', borderRadius: 10,
                    border: '1px solid #3b82f644', padding: 16, cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600 }}>{plan.title}</h3>
                    <StatusBadge status="active" />
                  </div>
                  {planTasks.length > 0 && (
                    <>
                      <ProgressBar completed={done} total={planTasks.length} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {planTasks.map((task) => (
                          <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <TaskStatusIcon status={task.status} />
                            <span style={{
                              color: task.status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
                              textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                            }}>
                              {task.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Status Filter ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {statusFilters.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => { setStatusFilter(s); setSelectedPlan(null); }}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: statusFilter === s ? '1px solid var(--accent)' : '1px solid var(--border)',
              backgroundColor: statusFilter === s ? 'var(--accent)' : 'var(--bg-card)',
              color: statusFilter === s ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {s ? t(`plans.${s}`) : t('plans.all')}
          </button>
        ))}
      </div>

      <div>
        {/* ── Plans List ── */}
        <div>
          {error ? (
            <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>
          ) : loading ? (
            <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
          ) : plans.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('plans.empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {plans.map((plan) => {
                const planTasks = plan.id === selectedPlan?.id ? tasks : [];
                const done = planTasks.filter((t) => t.status === 'completed').length;
                return (
                  <div
                    key={plan.id}
                    onClick={() => selectPlan(plan)}
                    style={{
                      backgroundColor: selectedPlan?.id === plan.id ? 'var(--accent-bg, rgba(99,102,241,0.1))' : 'var(--bg-card)',
                      borderRadius: 10,
                      border: selectedPlan?.id === plan.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                      padding: 16, cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <StatusBadge status={plan.status} />
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{plan.scope}</span>
                    </div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                      {plan.title || 'Untitled Plan'}
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {plan.content.slice(0, 120)}
                    </p>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {plan.tags.slice(0, 5).map((tag) => (
                        <span key={tag} style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        {new Date(plan.createdAt).toLocaleDateString()}
                      </span>
                      {planTasks.length > 0 && <MiniProgress completed={done} total={planTasks.length} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function RelationCard({ entry }: { entry: Record<string, unknown> }) {
  const type = entry.type as string;
  return (
    <div style={{
      backgroundColor: 'var(--bg-main)', borderRadius: 6, border: '1px solid var(--border)',
      padding: 10, fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
          backgroundColor: TYPE_COLORS[type] || '#6b7280', color: '#fff',
        }}>
          {type}
        </span>
        <span style={{ fontWeight: 600 }}>{(entry.title as string) || (entry.content as string)?.slice(0, 60)}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {((entry.tags as string[]) || []).slice(0, 4).map((tag) => (
          <span key={tag} style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
