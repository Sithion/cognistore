import type { ReactNode } from 'react';

export type ChartPanelState = 'loading' | 'ready' | 'empty' | 'error';

export function ChartPanel({
  title, state, children, emptyText = 'No data for this period.', errorText = 'Could not load this chart.',
  onRetry, summary, description,
}: {
  title: string;
  state: ChartPanelState;
  children?: ReactNode;
  emptyText?: string;
  errorText?: string;
  onRetry?: () => void;
  summary?: string;
  description?: string;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm" aria-label={title}>
      <header className="mb-4">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </header>
      {state === 'loading' && <div className="h-44 animate-pulse rounded-md bg-muted" role="status" aria-label="Loading chart" />}
      {state === 'empty' && <p className="py-12 text-center text-sm text-muted-foreground">{emptyText}</p>}
      {state === 'error' && <div data-testid="section-error" role="alert" className="flex flex-col items-center gap-3 py-10 text-sm text-destructive"><p>{errorText}</p>{onRetry && <button type="button" className="rounded-md border px-3 py-1.5 text-foreground" onClick={onRetry}>Retry</button>}</div>}
      {state === 'ready' && <>{summary && <p className="sr-only" aria-live="polite">{summary}</p>}{children}</>}
    </section>
  );
}

export function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <section className="min-w-36 flex-1 rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</section>;
}
