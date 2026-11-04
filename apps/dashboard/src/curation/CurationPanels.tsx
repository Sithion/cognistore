import { useTranslation } from 'react-i18next';
import type { CurationAction, CurationQueueAction, DbHealth } from '../api/client.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';

// Agent-authored text (reasons, titles) is rendered as React text nodes only: never as HTML.
const titleOf = (action: CurationAction, fallback: string) => action.titles.map(title => title ?? fallback).join(' · ') || fallback;

export function PendingPanel({ actions, selected, busy, onToggle, onToggleAll, onApprove, onReject, onBatch }: {
  actions: CurationQueueAction[]; selected: ReadonlySet<string>; busy: boolean;
  onToggle(id: string): void; onToggleAll(): void; onApprove(id: string): void; onReject(id: string): void; onBatch(operation: 'apply' | 'reject'): void;
}) {
  const { t } = useTranslation();
  if (actions.length === 0) return <p data-testid="pending-empty" className="text-sm text-muted-foreground">{t('curationPage.pendingEmpty')}</p>;
  const none = selected.size === 0;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="select-all" checked={selected.size === actions.length} onChange={onToggleAll} aria-label={t('curationPage.selectAll')} />
        <span>{t('curationPage.selectedCount', { count: selected.size })}</span>
      </label>
      <Button size="sm" data-testid="batch-approve" disabled={busy || none} onClick={() => onBatch('apply')}>{t('curationPage.approveSelected')}</Button>
      <Button size="sm" variant="outline" data-testid="batch-reject" disabled={busy || none} onClick={() => onBatch('reject')}>{t('curationPage.rejectSelected')}</Button>
    </div>
    <ul className="space-y-3">{actions.map(action => {
      const title = titleOf(action, t('curationPage.untitled'));
      return <li key={action.id} data-testid="pending-row" className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={selected.has(action.id)} onChange={() => onToggle(action.id)} aria-label={t('curationPage.selectRow', { title })} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t(`curationPage.kind.${action.kind}`, { defaultValue: action.kind })}</Badge>
              {action.confidence !== null && <Badge variant="outline">{t('curationPage.confidence', { value: Math.round(action.confidence * 100) })}</Badge>}
            </div>
            <p className="break-words font-medium">{title}</p>
            {action.reason ? <p className="break-words text-sm text-muted-foreground"><span className="font-medium">{t('curationPage.reasonLabel')}: </span>{action.reason}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" disabled={busy} onClick={() => onApprove(action.id)}>{t('curationPage.approve')}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(action.id)}>{t('curationPage.reject')}</Button>
          </div>
        </div>
      </li>;
    })}</ul>
  </div>;
}

export function AppliedPanel({ actions, now, busy, onUndo }: { actions: CurationAction[]; now: number; busy: boolean; onUndo(id: string): void }) {
  const { t } = useTranslation();
  if (actions.length === 0) return <p data-testid="applied-empty" className="text-sm text-muted-foreground">{t('curationPage.appliedEmpty')}</p>;
  return <ul className="space-y-3">{actions.map(action => {
    const expired = !!action.undoExpiresAt && Date.parse(action.undoExpiresAt) < now;
    return <li key={action.id} data-testid="applied-row" className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <Badge variant="secondary">{t(`curationPage.kind.${action.kind}`, { defaultValue: action.kind })}</Badge>
        <p className="break-words font-medium">{titleOf(action, t('curationPage.untitled'))}</p>
      </div>
      <Button size="sm" variant="outline" disabled={busy || expired} title={expired ? t('curationPage.undoExpired') : undefined} onClick={() => onUndo(action.id)}>{t('curationPage.undo')}</Button>
    </li>;
  })}</ul>;
}

export function TrashPanel({ items, now, busy, onRestore }: {
  items: { id: string; title: string; trashedAt: string | null; expiresAt: string | null }[]; now: number; busy: boolean; onRestore(id: string): void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return <p data-testid="trash-empty" className="text-sm text-muted-foreground">{t('curationPage.trashEmpty')}</p>;
  return <ul className="space-y-3">{items.map(item => {
    const days = item.expiresAt ? Math.max(0, Math.ceil((Date.parse(item.expiresAt) - now) / 86_400_000)) : null;
    return <li key={item.id} data-testid="trash-row" className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">{item.title || t('curationPage.untitled')}</p>
        {days !== null && <p className="text-sm text-muted-foreground">{t('curationPage.daysLeft', { count: days })}</p>}
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onRestore(item.id)}>{t('curationPage.restore')}</Button>
    </li>;
  })}</ul>;
}

const bytes = (n: number) => n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
export function HealthPanel({ health }: { health: DbHealth }) {
  const { t } = useTranslation();
  const lag = health.eventLoopLagMs;
  return <div className="space-y-4" data-testid="health-panel">
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border bg-card p-4"><dt className="text-sm text-muted-foreground">{t('curationPage.health.size')}</dt><dd className="text-lg font-semibold">{bytes(health.sizeBytes)}</dd></div>
      <div className="rounded-lg border bg-card p-4"><dt className="text-sm text-muted-foreground">{t('curationPage.health.telemetryShare')}</dt><dd className="text-lg font-semibold">{Math.round(health.telemetryShare * 100)}%</dd></div>
      <div className="rounded-lg border bg-card p-4"><dt className="text-sm text-muted-foreground">{t('curationPage.health.lastVacuum')}</dt><dd className="text-lg font-semibold">{health.lastVacuumAt ?? t('curationPage.health.never')}</dd></div>
      <div className="rounded-lg border bg-card p-4"><dt className="text-sm text-muted-foreground">{t('curationPage.health.eventLoop')}</dt>
        <dd className="text-lg font-semibold">{t('curationPage.health.p50')} {lag.p50} ms · {t('curationPage.health.p99')} {lag.p99} ms · {t('curationPage.health.max')} {lag.max} ms</dd></div>
    </dl>
    <section><h3 className="mb-2 font-semibold">{t('curationPage.health.tables')}</h3>
      <ul className="divide-y rounded-lg border bg-card">{health.tables.map(table => <li key={table.name} className="flex justify-between px-4 py-2 text-sm"><span>{table.name}</span><span>{t('curationPage.health.rows', { count: table.rows })}</span></li>)}</ul>
    </section>
  </div>;
}
