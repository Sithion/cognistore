import { useTranslation } from 'react-i18next';

export const settingsCopy = {
  en: {
    appearance: 'Appearance', appearanceDesc: 'Language and theme of the dashboard.',
    language: 'Language', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    updates: 'Updates',
    models: 'Models', modelsDesc: 'Local Ollama models used by cleanup and search.',
    mergeModel: 'Cleanup merge model',
    mergeModelDesc: 'Downloaded on demand when previewing a consolidation. Uninstall uses this reference to remove the managed model.',
    embeddingModel: 'Embedding model', embeddingModelDesc: 'Install or repair the configured embedding model.',
    installModel: 'Install model', installing: 'Installing…', modelReady: 'Embedding model ready.', modelFailed: 'Model setup failed.',
    reports: 'Reports', reportsDesc: 'Periodic cleanup reports about stale and duplicate knowledge.',
    autoCuration: 'Automatic curation', autoCurationDesc: 'How the local model curates knowledge in the background.',
    save: 'Save', saving: 'Saving…', saved: 'Saved.', saveFailed: 'Could not save settings. Please try again.',
    loadFailed: 'Could not load settings.', retry: 'Retry', loading: 'Loading settings…',
    tokenHistory: 'Token history', tokenHistoryDesc: 'How long raw token usage records are kept.',
    retentionLabel: 'Raw token history (days)',
    retentionHelp: 'Default: 90 days. Set 0 to keep raw history indefinitely. Daily rollups are retained. Previously pruned raw history cannot be recovered; shortening retention can permanently prune older records.',
    retentionInvalid: 'Enter an integer between 0 and 36500.',
    retentionSaveFailed: 'Could not save retention. Please try again.',
  },
  es: {
    appearance: 'Apariencia', appearanceDesc: 'Idioma y tema del panel.',
    language: 'Idioma', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Oscuro',
    updates: 'Actualizaciones',
    models: 'Modelos', modelsDesc: 'Modelos locales de Ollama usados por la limpieza y la búsqueda.',
    mergeModel: 'Modelo de fusión de limpieza',
    mergeModelDesc: 'Se descarga cuando previsualizas una consolidación. La desinstalación usa esta referencia para eliminar el modelo administrado.',
    embeddingModel: 'Modelo de embeddings', embeddingModelDesc: 'Instala o repara el modelo de embeddings configurado.',
    installModel: 'Instalar modelo', installing: 'Instalando…', modelReady: 'Modelo de embeddings listo.', modelFailed: 'Falló la configuración del modelo.',
    reports: 'Informes', reportsDesc: 'Informes periódicos de limpieza sobre conocimiento obsoleto y duplicado.',
    autoCuration: 'Curación automática', autoCurationDesc: 'Cómo el modelo local cura el conocimiento en segundo plano.',
    save: 'Guardar', saving: 'Guardando…', saved: 'Guardado.', saveFailed: 'No se pudo guardar la configuración. Inténtalo de nuevo.',
    loadFailed: 'No se pudo cargar la configuración.', retry: 'Reintentar', loading: 'Cargando configuración…',
    tokenHistory: 'Historial de tokens', tokenHistoryDesc: 'Cuánto tiempo se conservan los registros de uso de tokens.',
    retentionLabel: 'Historial bruto de tokens (días)',
    retentionHelp: 'Predeterminado: 90 días. Usa 0 para conservar el historial bruto indefinidamente. Los resúmenes diarios se conservan. El historial eliminado no se puede recuperar; acortar la retención puede eliminar registros antiguos de forma permanente.',
    retentionInvalid: 'Introduce un entero entre 0 y 36500.',
    retentionSaveFailed: 'No se pudo guardar la retención. Inténtalo de nuevo.',
  },
  pt: {
    appearance: 'Aparência', appearanceDesc: 'Idioma e tema do painel.',
    language: 'Idioma', theme: 'Tema', themeSystem: 'Sistema', themeLight: 'Claro', themeDark: 'Escuro',
    updates: 'Atualizações',
    models: 'Modelos', modelsDesc: 'Modelos locais do Ollama usados pela limpeza e pela busca.',
    mergeModel: 'Modelo de mesclagem da limpeza',
    mergeModelDesc: 'Baixado sob demanda ao pré-visualizar uma consolidação. A desinstalação usa esta referência para remover o modelo gerenciado.',
    embeddingModel: 'Modelo de embeddings', embeddingModelDesc: 'Instala ou repara o modelo de embeddings configurado.',
    installModel: 'Instalar modelo', installing: 'Instalando…', modelReady: 'Modelo de embeddings pronto.', modelFailed: 'Falha ao configurar o modelo.',
    reports: 'Relatórios', reportsDesc: 'Relatórios periódicos de limpeza sobre conhecimento obsoleto e duplicado.',
    autoCuration: 'Curadoria automática', autoCurationDesc: 'Como o modelo local faz a curadoria do conhecimento em segundo plano.',
    save: 'Salvar', saving: 'Salvando…', saved: 'Salvo.', saveFailed: 'Não foi possível salvar as configurações. Tente novamente.',
    loadFailed: 'Não foi possível carregar as configurações.', retry: 'Tentar de novo', loading: 'Carregando configurações…',
    tokenHistory: 'Histórico de tokens', tokenHistoryDesc: 'Por quanto tempo os registros brutos de uso de tokens são mantidos.',
    retentionLabel: 'Histórico bruto de tokens (dias)',
    retentionHelp: 'Padrão: 90 dias. Use 0 para manter o histórico bruto indefinidamente. Os resumos diários são mantidos. Histórico já removido não pode ser recuperado; reduzir a retenção pode remover registros antigos de forma permanente.',
    retentionInvalid: 'Informe um inteiro entre 0 e 36500.',
    retentionSaveFailed: 'Não foi possível salvar a retenção. Tente novamente.',
  },
} as const;

export type SettingsCopy = { [K in keyof typeof settingsCopy.en]: string };

export function useSettingsCopy(): SettingsCopy {
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? 'en').split('-')[0] as keyof typeof settingsCopy;
  return settingsCopy[lang] ?? settingsCopy.en;
}
