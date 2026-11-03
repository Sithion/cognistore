import { lazy, Suspense } from 'react';

const DesignWorkspace = lazy(() => import('@/design/DesignWorkspace'));

export function DesignPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading design preview…</div>}><DesignWorkspace /></Suspense>;
}
