import i18n from 'i18next';

export const round8Insights = {
  en: { insights: { retention: 'Daily aggregate retention: {{days}}. <settingsLink>Manage retention</settingsLink> · Daily totals persist separately from bounded raw session and heatmap data.', unlimited: 'unlimited', days: '{{count}} days' } },
  es: { insights: { retention: 'Retención de agregados diarios: {{days}}. <settingsLink>Administrar retención</settingsLink> · Los totales diarios se conservan por separado de los datos brutos limitados de sesiones y del mapa de calor.', unlimited: 'ilimitada', days: '{{count}} días' } },
  pt: { insights: { retention: 'Retenção dos agregados diários: {{days}}. <settingsLink>Gerenciar retenção</settingsLink> · Totais diários ficam separados dos dados brutos limitados de sessões e do mapa de calor.', unlimited: 'ilimitada', days: '{{count}} dias' } },
} as const;

export function registerInsightsResources() {
  for (const [language, resource] of Object.entries(round8Insights)) {
    if (!i18n.getResource(language, 'translation', 'insights.retention')) i18n.addResourceBundle(language, 'translation', resource, true, true);
  }
}
