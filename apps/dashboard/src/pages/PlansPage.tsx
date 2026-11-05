import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownHeadings } from '../lib/markdownHeadings.js';
// Subpath import on purpose: the package root barrel pulls zod in, which the
// browser bundle has no other reason to carry.
import { PLAN_STATUS_VALUES, type PlanStatus } from '@cognistore/shared/constants';
import { api, ApiError } from '../api/client.js';
import { useInfiniteList, PAGE_SIZE } from '../hooks/useInfiniteScroll.js';
import { useTransientMessage } from '../hooks/useTransientMessage.js';
import { PLAN_TEMPLATES, type PlanTemplate } from '../data/planTemplates.js';
import { usePlansRoute } from '../plans/usePlansRoute.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { toast } from 'sonner';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Circle, FileText, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.js';

const STATUS_COLORS: Record<string, string> = {
  draft: 'hsl(var(--muted-foreground))',
  active: 'hsl(var(--primary))',
  completed: 'hsl(var(--chart-2))',
  archived: 'hsl(var(--chart-4))',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'hsl(var(--destructive))',
  medium: 'hsl(var(--chart-4))',
  low: 'hsl(var(--muted-foreground))',
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
  planFilePath?: string | null;
  parentPlanId?: string | null;
  rootPlanId?: string | null;
  createdAt: string;
  updatedAt: string;
  taskCount?: number;
  completedTasks?: number;
}

interface PlanChainEntry {
  id: string;
  title: string;
  status: string;
  scope: string;
  parentPlanId: string | null;
  /** Precomputed server-side — the UI never walks parent pointers itself. */
  depth: number;
  isCurrent: boolean;
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
    return <Check className="size-4 text-primary" aria-label="Completed" />;
  }
  if (status === 'in_progress') {
    return <LoaderCircle className="size-3.5 animate-spin text-primary" aria-label="In progress" />;
  }
  // pending
  return <Circle className="size-3.5 text-muted-foreground" aria-label="Pending" />;
}

/* ── Progress Bar ── */

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const barColor = pct === 100 ? '#22c55e' : pct > 50 ? 'var(--accent)' : '#6b7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div role="progressbar" aria-label={`Task progress: ${completed} of ${total} complete`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} style={{ flex: 1, height: 6, backgroundColor: 'hsl(var(--muted))', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? 'hsl(var(--primary))' : barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span className="font-mono text-xs text-muted-foreground" style={{ whiteSpace: 'nowrap' }}>
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

/** Marks a plan that continues another one, and jumps to that origin. Shown on
 *  the list cards so lineage is visible without opening the plan. */
function OriginChip({ parentPlanId, onOpenParent }: { parentPlanId: string; onOpenParent: (planId: string) => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpenParent(parentPlanId); }}
      title={t('plans.chain.origin')}
      style={{
        padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
        border: 'none', cursor: 'pointer', flexShrink: 0,
        // `var(--accent)22` does NOT work — var() substitutes a whole token, so
        // the trailing alpha digits make the declaration invalid and it is
        // dropped. (Several older spots in this file have that bug.)
        backgroundColor: 'color-mix(in srgb, var(--accent) 13%, transparent)',
        color: 'var(--accent)',
      }}
    >
      ↳ {t('plans.chain.continuation')}
    </button>
  );
}

function TaskItem({ task, expandedNotes, onToggleNotes, onUpdateTask, onDeleteTask }: {
  task: PlanTask;
  expandedNotes: boolean;
  onToggleNotes: () => void;
  onUpdateTask?: (taskId: string, updates: Record<string, unknown>) => Promise<void>;
  /** Omitted on read-only surfaces (the active-plan cards), which show no actions. */
  onDeleteTask?: (task: PlanTask) => void;
}) {
  const { t } = useTranslation();
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(task.description);
  const [editingNotes, setEditingNotes] = useState(false);
  const [editNotes, setEditNotes] = useState(task.notes || '');
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);

  const cycleStatus = () => {
    if (!onUpdateTask) return;
    const next = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'completed' : 'pending';
    onUpdateTask(task.id, { status: next });
  };

  const saveDesc = () => {
    setEditingDesc(false);
    if (editDesc.trim() !== task.description && onUpdateTask) {
      onUpdateTask(task.id, { description: editDesc.trim() });
    }
  };

  const saveNotes = () => {
    setEditingNotes(false);
    if (editNotes !== (task.notes || '') && onUpdateTask) {
      onUpdateTask(task.id, { notes: editNotes || null });
    }
  };

  const setPriority = (p: string) => {
    setShowPriorityMenu(false);
    if (p !== task.priority && onUpdateTask) {
      onUpdateTask(task.id, { priority: p });
    }
  };

  return (
    <div
      style={{
        display: 'flex', gap: 8, padding: '8px 10px',
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority] || '#6b7280'}`,
        backgroundColor: 'var(--bg-main)', borderRadius: '0 6px 6px 0',
        position: 'relative',
      }}
    >
      <div style={{ paddingTop: 1, cursor: onUpdateTask ? 'pointer' : 'default' }} onClick={cycleStatus}>
        <TaskStatusIcon status={task.status} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editingDesc && onUpdateTask ? (
          <input
            aria-label="Task description"
            autoFocus
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => { if (e.key === 'Enter') saveDesc(); if (e.key === 'Escape') { setEditDesc(task.description); setEditingDesc(false); } }}
            style={{
              width: '100%', fontSize: 12, padding: '2px 6px', borderRadius: 4,
              border: '1px solid var(--accent)', backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
            }}
          />
        ) : (
          <span
            onClick={(e) => { if (onUpdateTask) { e.stopPropagation(); setEditingDesc(true); setEditDesc(task.description); } }}
            style={{
              fontSize: 12, cursor: onUpdateTask ? 'text' : 'default',
              textDecoration: task.status === 'completed' ? 'line-through' : 'none',
              color: task.status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
            }}>
            {task.description}
          </span>
        )}

        {/* Priority badge (clickable) */}
        {onUpdateTask && (
          <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowPriorityMenu(!showPriorityMenu); }}
              style={{
                padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                backgroundColor: `${PRIORITY_COLORS[task.priority] || '#6b7280'}22`,
                color: PRIORITY_COLORS[task.priority] || '#6b7280',
              }}
            >
              {task.priority}
            </button>
            {showPriorityMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 20,
                backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 6, marginTop: 2, overflow: 'hidden',
              }}>
                {['high', 'medium', 'low'].map(p => (
                  <button key={p} onClick={(e) => { e.stopPropagation(); setPriority(p); }}
                    style={{
                      display: 'block', width: '100%', padding: '4px 12px', textAlign: 'left',
                      background: p === task.priority ? 'var(--accent-muted)' : 'none',
                      border: 'none', color: PRIORITY_COLORS[p], cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}

        {/* Notes */}
        {(task.notes || onUpdateTask) && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleNotes(); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 9, marginLeft: 6, padding: 0 }}
            >
              {expandedNotes ? '▼' : '▶'} {t('plans.notes')}
            </button>
            {expandedNotes && (
              editingNotes && onUpdateTask ? (
                <textarea
                  aria-label={t('plans.notes')}
                  autoFocus
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  onBlur={saveNotes}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setEditNotes(task.notes || ''); setEditingNotes(false); } }}
                  rows={2}
                  style={{
                    width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4, marginTop: 4,
                    border: '1px solid var(--accent)', backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-secondary)', outline: 'none', resize: 'vertical',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
              ) : (
                <p
                  onClick={() => { if (onUpdateTask) { setEditingNotes(true); setEditNotes(task.notes || ''); } }}
                  style={{
                    fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: 4,
                    cursor: onUpdateTask ? 'text' : 'default',
                  }}>
                  {task.notes || (onUpdateTask ? t('plans.addNotes') : '')}
                </p>
              )
            )}
          </>
        )}
      </div>
      {onDeleteTask && (
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
          title={t('plans.deleteTask')}
          aria-label={t('plans.deleteTask')}
          style={{
            width: 24, height: 24, flexShrink: 0, alignSelf: 'flex-start',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#ef4444', border: 'none', borderRadius: 4, cursor: 'pointer',
          }}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ── Main PlansPage ── */

/* ── Create Plan Form ── */

interface NewTask {
  description: string;
  priority: 'high' | 'medium' | 'low';
}

function CreatePlanForm({ onCreated, onCancel }: { onCreated: (planId: string) => void; onCancel: () => void }) {
  const [submitError, setSubmitError] = useTransientMessage(5000);
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [scope, setScope] = useState('global');
  const [newTasks, setNewTasks] = useState<NewTask[]>([{ description: '', priority: 'medium' }]);
  const [saving, setSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('blank');

  const applyTemplate = (tpl: PlanTemplate) => {
    setSelectedTemplate(tpl.id);
    if (tpl.id === 'blank') {
      setTitle('');
      setContent('');
      setTagsInput('');
      setNewTasks([{ description: '', priority: 'medium' }]);
      return;
    }
    setTitle(tpl.titlePattern);
    setContent(tpl.contentStructure);
    setTagsInput(tpl.defaultTags.join(', '));
    setNewTasks(tpl.tasks.length > 0
      ? tpl.tasks.map(t => ({ description: t.description, priority: t.priority }))
      : [{ description: '', priority: 'medium' }]
    );
  };

  const addTask = () => setNewTasks([...newTasks, { description: '', priority: 'medium' }]);

  const removeTask = (index: number) => {
    if (newTasks.length <= 1) return;
    setNewTasks(newTasks.filter((_, i) => i !== index));
  };

  const updateTask = (index: number, field: keyof NewTask, value: string) => {
    setNewTasks(newTasks.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      // The API requires at least one tag, even when the optional UI field is blank.
      if (tags.length === 0) tags.push('plan');
      const tasks = newTasks.filter((t) => t.description.trim()).map((t) => ({
        description: t.description.trim(),
        priority: t.priority,
      }));
      const created = await api.createPlan({ title: title.trim(), content: content.trim(), tags, scope, source: 'dashboard', tasks }) as PlanEntry;
      onCreated(created.id);
    } catch {
      // User-initiated mutation: surface failure under the submit button.
      toast.error(t('errors.saveFailed'));
      setSubmitError(t('errors.saveFailed'));
    }
    setSaving(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border)', backgroundColor: 'var(--bg-input)',
    color: 'var(--text-primary)', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  };

  return (
      <div className="rounded-xl border bg-card p-5 text-card-foreground mb-5">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700 }}>{t('plans.newPlan')}</h1>
        <button aria-label={t('actions.cancel')} onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
      </div>

      {/* Template Selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          {t('plans.template')}
        </label>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {PLAN_TEMPLATES.map((tpl) => (
          <Button variant={selectedTemplate === tpl.id ? 'secondary' : 'outline'} size="sm"
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="shrink-0"
            >
              <span aria-hidden="true">{tpl.icon}</span> {tpl.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="plan-title" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          Title
        </label>
        <Input id="plan-title"
          value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={t('plans.planTitlePlaceholder')}
          className="h-auto py-2.5"
        />
      </div>

      {/* Content */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="plan-content" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          Content
        </label>
        <textarea id="plan-content"
          value={content} onChange={(e) => setContent(e.target.value)}
          placeholder={t('plans.planContentPlaceholder')}
          rows={5}
          className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {/* Scope + Tags row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            {t('knowledge.scope')}
          </label>
          <Input aria-label={t('knowledge.scope')} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="global or workspace:name" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            {t('knowledge.tags')}
          </label>
          <Input
            aria-label={t('knowledge.tags')}
            value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
            placeholder={t('plans.tagsPlaceholder')}
            className="h-auto py-2.5"
          />
        </div>
      </div>

      {/* Tasks */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)' }}>
            {t('plans.tasks')}
          </label>
          <button onClick={addTask} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            border: '1px solid var(--border)', backgroundColor: 'var(--bg-input)',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}>
            + {t('plans.addTask')}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {newTasks.map((task, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                aria-label={`Task ${i + 1} description`}
                value={task.description}
                onChange={(e) => updateTask(i, 'description', e.target.value)}
                placeholder={`${t('plans.taskPlaceholder')} ${i + 1}`}
                className="flex-1"
              />
              <select
                aria-label={`Task ${i + 1} priority`}
                value={task.priority}
                onChange={(e) => updateTask(i, 'priority', e.target.value)}
                style={{ ...inputStyle, width: 100, flex: 'none' }}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              {newTasks.length > 1 && (
                <button aria-label={`Remove task ${i + 1}`} onClick={() => removeTask(i)} style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1,
                }}>×</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          border: '1px solid var(--border)', backgroundColor: 'var(--bg-input)',
          color: 'var(--text-secondary)', cursor: 'pointer',
        }}>
          {t('actions.cancel')}
        </button>
        <Button
          onClick={handleSubmit}
          disabled={saving || !title.trim() || !content.trim()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {submitError && (
        <p style={{ fontSize: 12, color: 'var(--error, #ef4444)', marginTop: 8, textAlign: 'right' }}>{submitError}</p>
      )}
    </div>
  );
}

function ConfirmDialog({ open, onClose, onConfirm, title, message, loading, errorText }: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>;
  title: string; message: string; loading: boolean; errorText?: string | null;
}) {
  const { t } = useTranslation();
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{message}</DialogDescription></DialogHeader>
      {errorText && <p role="alert" className="text-sm text-destructive">{errorText}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={loading}>{t('actions.cancel')}</Button>
        <Button variant="destructive" onClick={() => void onConfirm()} disabled={loading}>{loading ? '…' : t('actions.confirm')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function PlansPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const route = usePlansRoute();
  // Status chips are a multi-select toggle group: an empty selection means "all".
  const statusFilter = route.status;
  const scopeFilter = route.scope;
  const [allScopes, setAllScopes] = useState<string[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanEntry | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [relations, setRelations] = useState<PlanRelation[]>([]);
  const [chain, setChain] = useState<PlanChainEntry[]>([]);
  // The chain walk is bounded, so a long lineage comes back cut off.
  const [chainTruncated, setChainTruncated] = useState(false);
  const [activePlans, setActivePlans] = useState<PlanEntry[]>([]);
  const [activeTasksMap, setActiveTasksMap] = useState<Record<string, PlanTask[]>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Error shown inside the delete/archive ConfirmModal (modal stays open on failure).
  const [mutationError, setMutationError] = useState<string | null>(null);
  // Transient inline error for task updates in the detail view.
  const [taskError, setTaskError] = useTransientMessage(5000);
  // Task pending deletion (kept whole so the confirm can name it).
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<PlanTask | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  // Separate from `mutationError`: that one belongs to the plan delete/archive
  // modals, and sharing it would surface an error in the wrong dialog.
  const [taskMutationError, setTaskMutationError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Snapshot of the whole plan set (status + task aggregates) for the 5s poll below.
  // Seeded on the first tick; the list only resets when this string changes.
  const planSnapshotRef = useRef<string | null>(null);

  // Plan-file preview (collapsible) + open-in-editor. Cached per plan id so the 5s
  // detail poll (which replaces the selectedPlan object) doesn't reset it.
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<{ exists: boolean; content?: string; truncated?: boolean; disallowed?: boolean } | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const filePreviewPlanIdRef = useRef<string | null>(null);

  // Main plans list — infinite scroll, server-side status + scope filters.
  // The selection travels as an array; this sorted+joined form exists ONLY as the
  // effect dependency, so that click ORDER cannot re-create the loader — only the
  // selected SET matters.
  const statusFilterKey = [...statusFilter].sort().join(',');
  const list = useInfiniteList<PlanEntry>(
    (offset) => api.listPlans(PAGE_SIZE, statusFilter, offset, scopeFilter || undefined) as Promise<PlanEntry[]>,
    [statusFilterKey, scopeFilter],
  );

  // Load available scopes for the scope filter dropdown.
  const loadScopes = useCallback(() => {
    return (api.getStats() as Promise<{ byScope: { scope: string }[] }>)
      .then((stats) => setAllScopes(stats.byScope.map((s) => s.scope)))
      .catch(() => {});
  }, []);

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

  useEffect(() => { loadActivePlans(); loadScopes(); }, [loadActivePlans, loadScopes]);

  // Poll every 5s: refresh the active-plans section AND snapshot-detect out-of-band
  // changes to the whole plan set (create/delete/status/task changes from the MCP
  // server, OpenCode, another window, etc.). The main list is otherwise never polled
  // (to avoid thrashing scroll) and only refreshed on filter change / UI mutation — so
  // without this, externally-made changes never appeared until a manual nav reset.
  // Mirrors the Knowledge Base list's snapshot-poll (HomePage.tsx:130-146): the ref is
  // seeded on the first tick (no reset), then list.reset() fires only when the snapshot
  // actually changes. `list.reset` is a stable useCallback (useInfiniteScroll.ts:57).
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      loadActivePlans();
      try {
        const m = await api.getPlanMetrics();
        const p = m.plans, tk = m.tasks;
        const snapshot = `${p.total}:${p.draft}:${p.active}:${p.completed}:${p.archived}:${tk.total}:${tk.pending}:${tk.inProgress}:${tk.completed}`;
        if (planSnapshotRef.current !== null && snapshot !== planSnapshotRef.current) {
          list.reset();
        }
        planSnapshotRef.current = snapshot;
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadActivePlans]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open route detail and retain compatibility with legacy ?select= links.
  useEffect(() => {
    let active = true;
    const selectId = route.id || searchParams.get('select');
    if (selectId && selectedPlan?.id !== selectId) {
      api.getPlan(selectId).then((plan) => {
        if (active && plan) void selectPlan(plan as PlanEntry);
      }).catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 404) {
          toast.error(t('missingPlan.notFound'));
          setSelectedPlan(null);
          navigate('/plans', { replace: true });
        }
      });
    }
    if (!selectId && selectedPlan) setSelectedPlan(null);
    return () => { active = false; };
  }, [route.id, searchParams, navigate, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse + clear the file preview when a DIFFERENT plan is selected (keyed on
  // id, so the 5s poll replacing the object identity does NOT reset it).
  useEffect(() => {
    setFilePreviewOpen(false);
    setFilePreview(null);
    filePreviewPlanIdRef.current = null;
  }, [selectedPlan?.id]);

  const togglePreview = async () => {
    if (!selectedPlan) return;
    const next = !filePreviewOpen;
    setFilePreviewOpen(next);
    if (next && filePreviewPlanIdRef.current !== selectedPlan.id) {
      setFilePreviewLoading(true);
      try {
        const res = await api.getPlanFile(selectedPlan.id);
        setFilePreview(res);
        filePreviewPlanIdRef.current = selectedPlan.id;
      } catch (e) {
        // 403 = path outside the allowed roots — say so instead of the
        // misleading "File not found".
        setFilePreview({ exists: false, disallowed: e instanceof ApiError && e.status === 403 });
      }
      setFilePreviewLoading(false);
    }
  };

  const openPlanInEditor = async () => {
    if (!selectedPlan) return;
    try {
      const r = await api.openPlanFile(selectedPlan.id);
      if (!r.ok) toast.error(r.unsupported ? t('planFile.unsupported') : t('planFile.notFound'));
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 403 ? t('planFile.disallowed') : t('planFile.notFound'));
    }
  };

  // Reset state when nav link clicked for same route
  useEffect(() => {
    if ((location.state as any)?.reset) {
      setSelectedPlan(null);
      setShowCreateForm(false);
      route.setStatuses([]);
      route.setScope('');
      setSearchParams({}, { replace: true });
      window.history.replaceState({}, '');
      list.reset();
    }
  }, [(location.state as any)?.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh selected plan detail (status, tasks, relations)
  const refreshSelectedPlan = useCallback(async (planId: string) => {
    try {
      const [planData, t, r, c] = await Promise.all([
        api.getPlan(planId),
        api.listPlanTasks(planId),
        api.getPlanRelations(planId),
        api.getPlanChain(planId),
      ]);
      if (planData) setSelectedPlan(planData as PlanEntry);
      setTasks(t as PlanTask[]);
      setRelations(r as PlanRelation[]);
      setChain((c?.chain ?? []) as PlanChainEntry[]);
      setChainTruncated(Boolean(c?.truncated));
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
    route.openPlan(plan.id);
    try {
      const [t, r, c] = await Promise.all([
        api.listPlanTasks(plan.id),
        api.getPlanRelations(plan.id),
        api.getPlanChain(plan.id),
      ]);
      setTasks(t as PlanTask[]);
      setRelations(r as PlanRelation[]);
      setChain((c?.chain ?? []) as PlanChainEntry[]);
      setChainTruncated(Boolean(c?.truncated));
    } catch {
      setTasks([]);
      setRelations([]);
      setChain([]);
      setChainTruncated(false);
    }
  };

  // Chain navigation: a chain entry is a narrow projection, so fetch the real
  // plan before switching the detail view to it.
  const selectPlanById = async (planId: string) => {
    try {
      const plan = await api.getPlan(planId);
      if (plan) await selectPlan(plan as PlanEntry);
    } catch { /* silent — the current plan stays selected */ }
  };

  const toggleNotes = (taskId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const handleUpdateTask = async (taskId: string, updates: Record<string, unknown>) => {
    try {
      await api.updatePlanTask(taskId, updates);
      if (selectedPlan) refreshSelectedPlan(selectedPlan.id);
    } catch {
      // User-initiated mutation: surface failure inline near the task list.
      setTaskError(t('errors.saveFailed'));
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTaskTarget || !selectedPlan) return;
    setDeletingTask(true);
    try {
      const res = await api.deletePlanTask(deleteTaskTarget.id);
      if (!res?.deleted) throw new Error('not deleted');
      setTaskMutationError(null);
      setDeleteTaskTarget(null);
      // Deleting the last incomplete task can auto-complete the plan, and the
      // list cards show task counts — refresh all three surfaces.
      refreshSelectedPlan(selectedPlan.id);
      list.reset();
      loadActivePlans();
    } catch {
      // Keep the modal open: the task still exists server-side.
      setTaskMutationError(t('errors.deleteFailed'));
    }
    setDeletingTask(false);
  };

  // Title of the plan this one continues. The chain is the only place a title is
  // available, and it is a bounded walk — a distant parent may be missing from
  // it entirely, so callers fall back to the id.
  const parentTitle = selectedPlan?.parentPlanId
    ? chain.find((n) => n.id === selectedPlan.parentPlanId)?.title ?? null
    : null;

  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const inputRelations = relations.filter((r) => r.relationType === 'input');
  const outputRelations = relations.filter((r) => r.relationType === 'output');
  // No "all" entry: deselecting every chip IS "all".
  const statusFilters = PLAN_STATUS_VALUES;
  // Explicit key map rather than t(`plans.${s}`): a fifth status then fails to
  // compile here instead of silently rendering a raw key in all three locales.
  const STATUS_LABEL_KEY: Record<PlanStatus, string> = {
    draft: 'plans.draft',
    active: 'plans.active',
    completed: 'plans.completed',
    archived: 'plans.archived',
  };
  const toggleStatus = (s: string) => {
    route.setStatuses(statusFilter.includes(s) ? statusFilter.filter((x) => x !== s) : [...statusFilter, s]);
    setSelectedPlan(null);
  };

  // ── Detail View (full page) ──
  if (selectedPlan) {
    return (
      <div data-testid="plan-detail">
        <button
          onClick={() => { setSelectedPlan(null); route.backToList(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 13, padding: 0,
          }}
        >
          ← {t('plans.backToPlans')}
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge status={selectedPlan.status} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selectedPlan.scope}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {selectedPlan.status === 'completed' && (
              <button
                onClick={() => setConfirmArchive(true)}
                style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--text-secondary)', backgroundColor: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                {t('plans.archive')}
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid var(--error, #ef4444)', backgroundColor: 'transparent',
                color: 'var(--error, #ef4444)', cursor: 'pointer',
              }}
            >
              {t('plans.delete')}
            </button>
          </div>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>{selectedPlan.title}</h1>

        {/* Local plan file path (if this plan was authored from a plan-mode file).
            Click to toggle an inline preview; buttons to open in the OS editor / copy. */}
        {selectedPlan.planFilePath && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8,
                fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)',
              }}
            >
              <span
                onClick={togglePreview}
                title={selectedPlan.planFilePath}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, cursor: 'pointer' }}
              >
                <span aria-hidden>{filePreviewOpen ? '▼' : '▶'}</span>
                <span aria-hidden>📄</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedPlan.planFilePath}</span>
              </span>
              <button
                onClick={openPlanInEditor}
                title={t('planFile.openInEditor')}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap' }}
              >
                {t('planFile.openInEditor')}
              </button>
              <button
                onClick={() => { void navigator.clipboard?.writeText(selectedPlan.planFilePath!).catch(() => toast.error(t('planFile.copyFailed'))); }}
                title={t('planFile.copyPath')}
                aria-label={t('planFile.copyPath')}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
              >
                ⧉
              </button>
            </div>
            {filePreviewOpen && (
              <div
                style={{
                  marginTop: 8, padding: 12, backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)', borderRadius: 8, maxHeight: 360, overflow: 'auto',
                  fontSize: 13,
                }}
              >
                {filePreviewLoading ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{t('planFile.preview')}…</p>
                ) : !filePreview?.exists ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {filePreview?.disallowed ? t('planFile.disallowed') : t('planFile.notFound')}
                  </p>
                ) : (
                  <>
                    <Markdown components={{ input: ({ node: _node, ...props }) => <input {...props} aria-label="Task completion" /> }} remarkPlugins={[remarkGfm, [markdownHeadings, { level: 2 }]]}>{filePreview.content || ''}</Markdown>
                    {filePreview.truncated && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>{t('planFile.truncated')}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.tasks')}
            </h2>
            {taskError && (
              <p style={{ fontSize: 12, color: 'var(--error, #ef4444)', marginBottom: 8 }}>{taskError}</p>
            )}
            <ProgressBar completed={completedTasks} total={tasks.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
              {tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  expandedNotes={expandedNotes.has(task.id)}
                  onToggleNotes={() => toggleNotes(task.id)}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={(task) => { setTaskMutationError(null); setDeleteTaskTarget(task); }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="plan-markdown" style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
          <Markdown components={{ input: ({ node: _node, ...props }) => <input {...props} aria-label="Task completion" /> }} remarkPlugins={[remarkGfm, [markdownHeadings, { level: 2 }]]}>{selectedPlan.content}</Markdown>
          <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
            {selectedPlan.tags.map((tag) => (
              <span key={tag} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, backgroundColor: 'var(--bg-input)', color: 'var(--accent)' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Origin — answers "which plan did this one come from?" directly, without
            making the reader parse the chain (which may not even contain the
            parent: the traversal is bounded). */}
        {selectedPlan.parentPlanId && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)',
            padding: '12px 20px', marginBottom: 20,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)' }}>
              {t('plans.chain.origin')}
            </span>
            <button
              onClick={() => selectPlanById(selectedPlan.parentPlanId!)}
              title={parentTitle ?? undefined}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 13, color: 'var(--accent)', textAlign: 'left',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
              }}
            >
              {parentTitle ?? `${selectedPlan.parentPlanId.slice(0, 8)}…`}
            </button>
          </div>
        )}

        {/* Plan chain — hidden for a standalone plan, where the chain is just itself. */}
        {chain.length > 1 && (
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.chain.title')}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {chain.map((node) => (
                <button
                  key={node.id}
                  onClick={() => { if (!node.isCurrent) selectPlanById(node.id); }}
                  disabled={node.isCurrent}
                  title={node.title}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    marginLeft: Math.min(node.depth, 8) * 16,
                    padding: '6px 10px', borderRadius: 6, fontSize: 12,
                    border: '1px solid var(--border)',
                    backgroundColor: node.isCurrent ? 'var(--bg-input)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: node.isCurrent ? 'default' : 'pointer',
                  }}
                >
                  {node.depth === 0 && (
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, backgroundColor: 'var(--accent)22', color: 'var(--accent)' }}>
                      {t('plans.chain.original')}
                    </span>
                  )}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</span>
                  <StatusBadge status={node.status} />
                  {node.isCurrent && (
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{t('plans.chain.current')}</span>
                  )}
                </button>
              ))}
            </div>
            {chainTruncated && (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                {t('plans.chain.truncated')}
              </p>
            )}
          </div>
        )}

        {/* Relations */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.input')}
            </h2>
            {inputRelations.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('plans.noRelations')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {inputRelations.map((rel) => <RelationCard key={rel.entry.id as string} entry={rel.entry} />)}
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {t('plans.output')}
            </h2>
            {outputRelations.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('plans.noRelations')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {outputRelations.map((rel) => <RelationCard key={rel.entry.id as string} entry={rel.entry} />)}
              </div>
            )}
          </div>
        </div>

        {/* Delete Task Confirm Modal */}
        <ConfirmDialog
          open={deleteTaskTarget !== null}
          onClose={() => { setDeleteTaskTarget(null); setTaskMutationError(null); }}
          onConfirm={handleDeleteTask}
          title={t('plans.deleteTask')}
          message={t('plans.confirmDeleteTask', { description: deleteTaskTarget?.description ?? '' })}
          loading={deletingTask}
          errorText={taskMutationError}
        />

        {/* Delete Confirm Modal */}
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => { setConfirmDelete(false); setMutationError(null); }}
          onConfirm={async () => {
            setDeletingPlan(true);
            try {
              await api.deletePlan(selectedPlan.id);
              setMutationError(null);
              setSelectedPlan(null);
              setConfirmDelete(false);
              route.backToList();
              list.reset();
              loadActivePlans();
            } catch {
              // User-initiated mutation: keep the modal open and surface failure
              // (state is NOT cleared — the plan still exists server-side).
              setMutationError(t('errors.deleteFailed'));
            }
            setDeletingPlan(false);
          }}
          title={t('plans.delete')}
          message={t('plans.confirmDelete')}
          loading={deletingPlan}
          errorText={mutationError}
        />

        {/* Archive Confirm Modal */}
        <ConfirmDialog
          open={confirmArchive}
          onClose={() => { setConfirmArchive(false); setMutationError(null); }}
          onConfirm={async () => {
            setArchiving(true);
            try {
              await api.updatePlan(selectedPlan.id, { status: 'archived' });
              setMutationError(null);
              setSelectedPlan(null);
              setConfirmArchive(false);
              route.backToList();
              list.reset();
              loadActivePlans();
            } catch {
              // User-initiated mutation: keep the modal open and surface failure.
              setMutationError(t('errors.actionFailed'));
            }
            setArchiving(false);
          }}
          title={t('plans.archiveTitle')}
          message={t('plans.confirmArchive')}
          loading={archiving}
          errorText={mutationError}
        />
      </div>
    );
  }

  // ── List View ──
  return (
    <div>
      {showCreateForm ? (
        <>
          <button
            onClick={() => setShowCreateForm(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 13, padding: 0,
            }}
          >
            ← {t('plans.title')}
          </button>
          <CreatePlanForm
            onCreated={(planId) => {
              setShowCreateForm(false);
              list.reset();
              void loadActivePlans();
              route.openPlan(planId);
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        </>
      ) : (
        <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('plans.title')}</h1>
      </div>

      {/* ── Active Plans Section ── */}
      {activePlans.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {t('plans.activePlans')}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 12 }}>
            {activePlans.map((plan) => {
              const planTasks = activeTasksMap[plan.id] || [];
              const done = planTasks.filter((t) => t.status === 'completed').length;
              return (
                <div
                  key={plan.id}
                  onClick={() => selectPlan(plan)}
                  style={{
                    backgroundColor: 'var(--bg-card)', borderRadius: 10,
                    borderLeft: '3px solid #3b82f6', border: '1px solid #3b82f644',
                    borderLeftWidth: 3, borderLeftColor: '#3b82f6',
                    padding: 16, cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.title}</h3>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {plan.parentPlanId && <OriginChip parentPlanId={plan.parentPlanId} onOpenParent={selectPlanById} />}
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{plan.scope}</span>
                      <StatusBadge status="active" />
                    </div>
                  </div>
                  {planTasks.length > 0 && (
                    <>
                      <ProgressBar completed={done} total={planTasks.length} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
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

      {/* ── Status + Scope Filters ── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {statusFilters.map((s) => {
          const on = statusFilter.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              aria-pressed={on}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: on ? '1px solid var(--accent)' : '1px solid var(--border)',
                backgroundColor: on ? 'var(--accent)' : 'var(--bg-card)',
                color: on ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {t(STATUS_LABEL_KEY[s])}
            </button>
          );
        })}
        <select
          aria-label="Filter plans by scope"
          value={scopeFilter}
          onChange={(e) => { route.setScope(e.target.value); setSelectedPlan(null); }}
          style={{
            marginLeft: 'auto', padding: '6px 10px', borderRadius: 6,
            backgroundColor: 'var(--bg-input)', border: '1px solid var(--border)',
            color: scopeFilter ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 12,
          }}
        >
          <option value="">{t('plans.allScopes')}</option>
          {allScopes.map((sc) => (
            <option key={sc} value={sc}>{sc}</option>
          ))}
        </select>
        <select aria-label={t('plans.sort', { defaultValue: 'Sort plans' })} value={route.sort} onChange={(e) => route.setSort(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="updated">Recently updated</option>
          <option value="created">Recently created</option>
          <option value="title">Title</option>
        </select>
        <Input aria-label="Page" type="number" min={1} value={route.page} onChange={(e) => route.setPage(Number(e.target.value))} className="w-20 font-mono" />
      </div>

      <div>
        {/* ── Plans List ── */}
        <div>
          {list.items.length === 0 && list.loadingMore ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('plans.loading')}</p>
          ) : list.items.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('plans.empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.items.map((plan) => {
                // List view is reached only after the `if (selectedPlan) return <detail>`
                // early-return, so selectedPlan is always null here — there's no
                // per-card selection state. Progress comes from the list endpoint's
                // own taskCount/completedTasks (previously this read the detail-view
                // `tasks` gated on selectedPlan, so the bar never rendered).
                const total = plan.taskCount ?? 0;
                const done = plan.completedTasks ?? 0;
                return (
                  <div
                    key={plan.id}
                    onClick={() => selectPlan(plan)}
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      padding: 16, cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <StatusBadge status={plan.status} />
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{plan.scope}</span>
                      {plan.parentPlanId && <OriginChip parentPlanId={plan.parentPlanId} onOpenParent={selectPlanById} />}
                    </div>
                    <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                      {plan.title || 'Untitled Plan'}
                    </h2>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {plan.tags.slice(0, 5).map((tag) => (
                        <span key={tag} style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        {new Date(plan.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })}
                        {plan.updatedAt && plan.updatedAt !== plan.createdAt && (
                          <> • updated {new Date(plan.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })}</>
                        )}
                      </span>
                      {total > 0 && <MiniProgress completed={done} total={total} />}
                    </div>
                  </div>
                );
              })}
              {/* Infinite-scroll sentinel + footer */}
              <div ref={list.sentinelRef} style={{ height: 1 }} />
              {list.loadingMore && (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 12, fontSize: 12 }}>{t('list.loadingMore')}</p>
              )}
              {!list.hasMore && list.items.length > PAGE_SIZE && (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 12, fontSize: 12 }}>{t('list.noMore')}</p>
              )}
            </div>
          )}
        </div>

      </div>

      {/* FAB */}
        <Button className="fixed bottom-6 right-6 shadow-lg" onClick={() => setShowCreateForm(true)}><Plus className="size-4" />New plan</Button>
        </>
      )}
    </div>
  );
}

function RelationCard({ entry }: { entry: Record<string, unknown> }) {
  const type = entry.type as string;
  return (
    <a
      href={`/knowledge/${encodeURIComponent(entry.id as string)}`}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        backgroundColor: 'var(--bg-main)', borderRadius: 6, border: '1px solid var(--border)',
        padding: 10, fontSize: 12, cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
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
    </a>
  );
}
