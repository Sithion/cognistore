import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../../api/client.js';
import { useWidgetClose } from '../shared/useWidgetClose.js';
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';

interface Task {
  id: string;
  description: string;
  status: string;
}

interface Plan {
  id: string;
  title: string;
  status: string;
  taskCount?: number;
  completedTasks?: number;
  tasks?: Task[];
}

const REFRESH_INTERVAL = 10_000;
const HEADER_HEIGHT = 32;
const PADDING_HEIGHT = 24;
const EMPTY_HEIGHT = 80;
const MIN_WIDTH = 320;

const STATUS_DOT: Record<string, string> = {
  in_progress: '#3b82f6',
  pending: '#6b7280',
  completed: '#22c55e',
};

function getMaxVisible(): number {
  const params = new URLSearchParams(window.location.search);
  const val = Number(params.get('max'));
  return val > 0 ? val : 5;
}

function PlanRow({ plan, onDelete, expanded, onToggle }: {
  plan: Plan;
  onDelete: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const total = plan.taskCount ?? 0;
  const completed = plan.completedTasks ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const tasks = plan.tasks ?? [];
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    import('@tauri-apps/api/event').then(({ emit }) => {
      emit('open-plan', plan.id);
    }).catch(() => {});
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(plan.id);
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        background: hover ? 'rgba(255,255,255,0.03)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        {/* Expand toggle */}
        <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${plan.title}`} aria-expanded={expanded}
          onClick={onToggle}
          style={{
            fontSize: 9, color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
            transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0, width: 12, textAlign: 'center',
          }}
        >{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
        <div
          onClick={handleNavigate}
          style={{
            fontSize: 12, fontWeight: 500, color: '#e2e8f0', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
          title={plan.title}
        >
          {plan.title}
        </div>
        {hover && (
          <button
            onClick={handleDelete}
            title="Delete plan"
            style={{
              width: 18, height: 18, borderRadius: '50%', border: 'none',
              background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 10, lineHeight: 1,
              padding: 0, flexShrink: 0,
            }}
          ><Trash2 size={11} /></button>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12 }}>
        <div style={{
          flex: 1, height: 3, borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 2,
            backgroundColor: pct === 100 ? '#22c55e' : '#3b82f6',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', flexShrink: 0 }}>
          {completed}/{total}
        </span>
      </div>

      {/* In-progress tasks always visible */}
      {!expanded && inProgressTasks.length > 0 && (
        <div style={{ paddingLeft: 12, marginTop: 6 }}>
          {inProgressTasks.map(t => (
            <TaskLine key={t.id} task={t} />
          ))}
        </div>
      )}

      {/* Expanded: show all tasks by status */}
      {expanded && (
        <div style={{ paddingLeft: 12, marginTop: 6 }}>
          {inProgressTasks.map(t => <TaskLine key={t.id} task={t} />)}
          {pendingTasks.map(t => <TaskLine key={t.id} task={t} />)}
          {completedTasks.map(t => <TaskLine key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}

function TaskLine({ task }: { task: Task }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6,
      padding: '2px 0', fontSize: 10,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 3,
        backgroundColor: STATUS_DOT[task.status] ?? '#6b7280',
      }} />
      <span style={{
        color: task.status === 'completed' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)',
        textDecoration: task.status === 'completed' ? 'line-through' : 'none',
        lineHeight: 1.3,
      }}>
        {task.description}
      </span>
    </div>
  );
}

export function ActivePlansWidget() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const handleClose = useWidgetClose();
  const maxVisible = useRef(getMaxVisible()).current;
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.listPlans(20, 'active');
      setPlans(data);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (planId: string) => {
    try {
      await api.deletePlan(planId);
      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Max content height based on configurable maxVisible (each "slot" ~80px)
  const maxContentHeight = maxVisible * 80;

  // Resize Tauri window: grows with content up to max, then scrollbar kicks in
  useEffect(() => {
    if (loading) return;
    const resize = () => {
      const contentHeight = contentRef.current?.scrollHeight ?? EMPTY_HEIGHT;
      const clampedContent = Math.min(contentHeight, maxContentHeight);
      const minHeight = HEADER_HEIGHT + PADDING_HEIGHT + 40;
      const finalHeight = Math.max(minHeight, HEADER_HEIGHT + PADDING_HEIGHT + clampedContent);
      import('@tauri-apps/api/window').then(({ getCurrentWindow, LogicalSize }) => {
        getCurrentWindow().setSize(new LogicalSize(MIN_WIDTH, finalHeight));
      }).catch(() => {});
    };
    const timer = setTimeout(resize, 60);
    return () => clearTimeout(timer);
  }, [plans, loading, expandedPlan, maxContentHeight]);

  return (
    <div className="widget-shell">
      <div className="widget-drag-region" data-tauri-drag-region>
        <span className="widget-title" data-tauri-drag-region>Active Plans</span>
        <button className="widget-close" onClick={handleClose} title="Close"><X size={13} /></button>
      </div>

      <div ref={contentRef} className="widget-content" style={{ overflowY: 'auto', maxHeight: maxContentHeight }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 20 }}>
            <div style={{
              width: 20, height: 20,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        ) : plans.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '20px 0',
            color: 'rgba(255, 255, 255, 0.3)', fontSize: 12,
          }}>
            No active plans
          </div>
        ) : (
          plans.map(plan => (
            <PlanRow
              key={plan.id}
              plan={plan}
              onDelete={handleDelete}
              expanded={expandedPlan === plan.id}
              onToggle={() => setExpandedPlan(prev => prev === plan.id ? null : plan.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
