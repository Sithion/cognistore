import { useId, type ReactNode } from 'react';

export const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-56';

export function SettingsCard({ title, description, children, footer, tone = 'default' }: { title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; tone?: 'default' | 'danger' }) {
  const id = useId();
  const danger = tone === 'danger';
  return <section aria-labelledby={id} className={'mt-6 rounded-xl border bg-card shadow-sm ' + (danger ? 'border-destructive/60' : 'border-border')}>
    <div className="px-5 pt-5">
      <h2 id={id} className={'text-sm font-semibold' + (danger ? ' text-destructive' : '')}>{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
    <div className="divide-y divide-border px-5">{children}</div>
    {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3">{footer}</div>}
  </section>;
}

export function SettingsRow({ label, description, htmlFor, children }: { label: ReactNode; description?: ReactNode; htmlFor?: string; children?: ReactNode }) {
  return <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
    <div className="min-w-0 sm:max-w-[60%]">
      {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label> : <span className="text-sm font-medium">{label}</span>}
      {description && <p id={htmlFor ? `${htmlFor}-desc` : undefined} className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
    <div className="flex items-center gap-2 sm:shrink-0">{children}</div>
  </div>;
}
