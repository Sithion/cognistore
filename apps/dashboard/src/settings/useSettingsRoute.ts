import { useLocation } from 'react-router-dom';

export const settingsRoutes = [
  'settings/general', 'settings/models', 'settings/curation', 'settings/telemetry', 'settings/advanced',
  'knowledge/tags', 'curation', 'curation/history', 'curation/trash', 'integrations/agents', 'system/health', 'system/about',
] as const;
export type SettingsRoute = typeof settingsRoutes[number];

export function useSettingsRoute(): SettingsRoute {
  const path = useLocation().pathname.replace(/^\/+|\/+$/g, '');
  return settingsRoutes.find(route => route === path) ?? 'settings/general';
}
