export type RouteMeta = { id: string; path: string; label: string; group: string; sidebar?: boolean; palette?: boolean; hidden?: boolean; pattern?: RegExp };

export const destinations = {
  knowledge: '/', plans: '/plans', curation: '/curation', insights: '/insights/knowledge',
  settings: '/settings/general', agents: '/integrations/agents', providers: '/integrations/providers',
  system: '/system/health', widgets: '/integrations/widgets',
} as const;

export const routeGroups = [
  { id: 'work', label: 'Work', routes: ['knowledge', 'plans', 'curation'] },
  { id: 'insights', label: 'Insights', routes: ['insights'] },
  { id: 'integrations', label: 'Integrations', routes: ['agents', 'providers', 'widgets'] },
  { id: 'settings', label: 'Settings', routes: ['settings', 'system'] },
] as const;

export const applicationRoutes: RouteMeta[] = [
  { id: 'knowledge', path: '/', label: 'Knowledge', group: 'work', sidebar: true },
  { id: 'knowledge-home', path: '/knowledge', label: 'Knowledge', group: 'work' },
  { id: 'knowledge-detail', path: '/knowledge/:id', label: 'Knowledge detail', group: 'work', pattern: /^\/knowledge\/[^/]+$/ },
  { id: 'tags', path: '/knowledge/tags', label: 'Tags', group: 'work' },
  { id: 'plans', path: '/plans', label: 'Plans', group: 'work', sidebar: true },
  { id: 'plan-detail', path: '/plans/:id', label: 'Plan detail', group: 'work', pattern: /^\/plans\/[^/]+$/ },
  { id: 'curation', path: '/curation', label: 'Curation', group: 'work', sidebar: true },
  ...['history', 'trash'].map((part) => ({ id: `curation-${part}`, path: `/curation/${part}`, label: `Curation ${part}`, group: 'work' })),
  { id: 'insights', path: '/insights', label: 'Insights', group: 'insights' },
  ...['knowledge', 'plans', 'tokens'].map((part) => ({ id: `insights-${part}`, path: `/insights/${part}`, label: `Insights ${part}`, group: 'insights', sidebar: part === 'knowledge' })),
  ...['agents', 'providers', 'widgets'].map((part) => ({ id: part, path: `/integrations/${part}`, label: part, group: 'integrations', sidebar: part !== 'widgets' })),
  ...['general', 'models', 'curation', 'telemetry', 'advanced'].map((part) => ({ id: `settings-${part}`, path: `/settings/${part}`, label: `Settings ${part}`, group: 'settings', sidebar: false })),
  { id: 'settings', path: '/settings', label: 'Settings', group: 'settings' },
  ...['health', 'about'].map((part) => ({ id: `system-${part}`, path: `/system/${part}`, label: `System ${part}`, group: 'settings' })),
  { id: 'design', path: '/_design', label: 'Design preview', group: 'internal', hidden: true },
  { id: 'design-gallery', path: '/_design/gallery', label: 'Design gallery', group: 'internal', hidden: true },
  { id: 'design-knowledge', path: '/_design/k/:id', label: 'Design knowledge', group: 'internal', hidden: true, pattern: /^\/_design\/k\/[^/]+$/ },
];

export const compatibilityRedirects: Record<string, string> = {
  '/stats': '/insights/knowledge', '/stats/plans': '/insights/plans', '/tokens': '/insights/tokens',
  '/providers': '/integrations/providers', '/widgets': '/integrations/widgets', '/settings': '/settings/general',
};

export function getRouteMeta(pathname: string): RouteMeta | undefined {
  return applicationRoutes.find((route) => route.path === pathname || route.pattern?.test(pathname));
}
