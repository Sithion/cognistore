import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      app: { title: 'AI Knowledge Base', subtitle: 'Semantic knowledge management for AI agents' },
      nav: { home: 'Knowledge Base', add: 'Add Knowledge', tags: 'Tags', plans: 'Plans', stats: 'Statistics', statsKnowledge: 'Knowledge', statsPlans: 'Plans', settings: 'Settings' },
      statsTitle: { knowledge: 'Knowledge Statistics', plans: 'Plan Statistics' },
      search: { placeholder: 'Search knowledge semantically...', button: 'Search', noResults: 'No results found.', resultsCount: '{{count}} result(s) found', recent: 'Recent Knowledge', empty: 'No knowledge entries yet. Add some knowledge to get started.' },
      knowledge: { content: 'Content', tags: 'Tags', type: 'Type', scope: 'Scope', source: 'Source', confidence: 'Confidence', expires: 'Expires', agent: 'Agent', version: 'Version', created: 'Created', updated: 'Updated', relatedIds: 'Related' },
      types: { decision: 'Decision', pattern: 'Pattern', fix: 'Fix', constraint: 'Constraint', gotcha: 'Gotcha' },
      actions: { save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete', confirm: 'Confirm', close: 'Close', bulkSelect: 'Bulk Select', export: 'Export', selected: 'selected', selectAll: 'Select All', deselectAll: 'Deselect All' },
      delete: { title: 'Delete Knowledge', message: 'Are you sure you want to delete this entry? This action cannot be undone.' },
      add: { title: 'Add New Knowledge', success: 'Knowledge entry created successfully' },
      edit: { title: 'Edit Knowledge', success: 'Knowledge entry updated successfully' },
      stats: { title: 'Knowledge Statistics', total: 'Total Entries', byType: 'By Type', byScope: 'By Scope', tagCloud: 'Tag Cloud', cleanCache: 'Clean cache', cacheClean: 'Cache clean', cleanTooltip: 'Remove unused embeddings', reads1h: 'Reads (1h)', reads24h: 'Reads (24h)', writes1h: 'Writes (1h)', writes24h: 'Writes (24h)', searches: 'searches', mutations: 'mutations' },
      tags: { title: 'Tags', total: 'tags found', empty: 'No tags found. Add some knowledge first.', showAll: 'Show all', showLess: 'Show less', loading: 'Loading tags...' },
      filters: { type: 'Filter by type', scope: 'Filter by scope', tags: 'Filter by tags', all: 'All', clear: 'Clear filters' },
      monitoring: {
        title: 'Settings', subtitle: 'Infrastructure monitoring and management',
        infraSection: 'Infrastructure Monitoring',
        database: 'Database', ollama: 'Ollama', sqlite: 'SQLite',
        connected: 'Connected', disconnected: 'Disconnected',
        allReady: 'All systems operational', degraded: 'Some services are down', checking: 'Checking services...',
        actions: 'Management',
        repair: 'Repair Infrastructure', repairing: 'Repairing...',
        repairConfirm: 'This will restart Ollama and reinitialize the database. Continue?',
        repairHint: 'Repair restarts Ollama and reinitializes services. Uninstall removes the database, Ollama models, and all configurations permanently.',
        uninstall: 'Uninstall', uninstalling: 'Uninstalling...',
        uninstallConfirm: 'This will remove the database, Ollama models, and all configurations. Continue?',
        uninstallConfirm2: 'Are you absolutely sure? This cannot be undone.',
        uninstallSuccess: 'Data removed successfully. This page will stop working shortly.',
      },
      plans: { title: 'Plans', empty: 'No plans yet.', all: 'All', draft: 'Draft', active: 'Active', completed: 'Completed', archived: 'Archived', input: 'Consulted', output: 'Produced', noRelations: 'No related knowledge entries.', noPlans: 'No related plans.', originPlan: 'Origin Plan', consultedBy: 'Plans That Consulted', tasks: 'Tasks', activePlans: 'Active Plans', noTasks: 'No tasks yet.', progress: 'completed', newPlan: 'New Plan', planTitle: 'Title', planTitlePlaceholder: 'What is this plan about?', planContent: 'Description', planContentPlaceholder: 'Describe the plan goals, approach, and considerations...', tagsPlaceholder: 'tag1, tag2, tag3', addTask: 'Add Task', taskPlaceholder: 'Task', createDraft: 'Create Draft', template: 'Template', delete: 'Delete', confirmDelete: 'Are you sure you want to delete this plan? This action cannot be undone.' },
      update: { section: 'Updates', check: 'Check for updates', checking: 'Checking...', upToDate: 'Up to date', available: 'Update available' },
      settings: { language: 'Language', dataManagement: 'Data Management', exportDesc: 'Export your knowledge and plans for backup or migration.', importDesc: 'Import knowledge or plans from a previous export.' },
      language: { en: 'English', es: 'Spanish', pt: 'Portuguese (BR)' },
    },
  },
  es: {
    translation: {
      app: { title: 'Base de Conocimiento IA', subtitle: 'Gestión semántica de conocimiento para agentes de IA' },
      nav: { home: 'Base de Conocimiento', add: 'Agregar Conocimiento', tags: 'Etiquetas', plans: 'Planes', stats: 'Estadísticas', statsKnowledge: 'Conocimiento', statsPlans: 'Planes', settings: 'Configuración' },
      statsTitle: { knowledge: 'Estadísticas de Conocimiento', plans: 'Estadísticas de Planes' },
      search: { placeholder: 'Buscar conocimiento semánticamente...', button: 'Buscar', noResults: 'No se encontraron resultados.', resultsCount: '{{count}} resultado(s) encontrado(s)', recent: 'Conocimiento Reciente', empty: 'Aún no hay entradas. Agrega conocimiento para comenzar.' },
      knowledge: { content: 'Contenido', tags: 'Etiquetas', type: 'Tipo', scope: 'Ámbito', source: 'Fuente', confidence: 'Confianza', expires: 'Expira', agent: 'Agente', version: 'Versión', created: 'Creado', updated: 'Actualizado', relatedIds: 'Relacionados' },
      types: { decision: 'Decisión', pattern: 'Patrón', fix: 'Corrección', constraint: 'Restricción', gotcha: 'Trampa' },
      actions: { save: 'Guardar', cancel: 'Cancelar', edit: 'Editar', delete: 'Eliminar', confirm: 'Confirmar', close: 'Cerrar', bulkSelect: 'Selección Múltiple', export: 'Exportar', selected: 'seleccionados', selectAll: 'Seleccionar Todo', deselectAll: 'Deseleccionar Todo' },
      delete: { title: 'Eliminar Conocimiento', message: '¿Estás seguro de que quieres eliminar esta entrada? Esta acción no se puede deshacer.' },
      add: { title: 'Agregar Nuevo Conocimiento', success: 'Entrada de conocimiento creada exitosamente' },
      edit: { title: 'Editar Conocimiento', success: 'Entrada de conocimiento actualizada exitosamente' },
      stats: { title: 'Estadísticas de Conocimiento', total: 'Entradas Totales', byType: 'Por Tipo', byScope: 'Por Ámbito', tagCloud: 'Nube de Etiquetas', cleanCache: 'Limpiar caché', cacheClean: 'Caché limpio', cleanTooltip: 'Eliminar embeddings no utilizados', reads1h: 'Lecturas (1h)', reads24h: 'Lecturas (24h)', writes1h: 'Escritas (1h)', writes24h: 'Escritas (24h)', searches: 'búsquedas', mutations: 'mutaciones' },
      tags: { title: 'Etiquetas', total: 'etiquetas encontradas', empty: 'No se encontraron etiquetas. Agrega conocimiento primero.', showAll: 'Ver todas', showLess: 'Ver menos', loading: 'Cargando etiquetas...' },
      filters: { type: 'Filtrar por tipo', scope: 'Filtrar por ámbito', tags: 'Filtrar por etiquetas', all: 'Todos', clear: 'Limpiar filtros' },
      monitoring: {
        title: 'Configuración', subtitle: 'Monitoreo y gestión de infraestructura',
        infraSection: 'Monitoreo de Infraestructura',
        database: 'Base de Datos', ollama: 'Ollama', sqlite: 'SQLite',
        connected: 'Conectado', disconnected: 'Desconectado',
        allReady: 'Todos los sistemas operativos', degraded: 'Algunos servicios están caídos', checking: 'Verificando servicios...',
        actions: 'Gestión',
        repair: 'Reparar Infraestructura', repairing: 'Reparando...',
        repairConfirm: 'Esto reiniciará Ollama y reinicializará la base de datos. ¿Continuar?',
        repairHint: 'Reparar reinicia Ollama y reinicializa los servicios. Desinstalar elimina la base de datos, modelos de Ollama y configuraciones permanentemente.',
        uninstall: 'Desinstalar', uninstalling: 'Desinstalando...',
        uninstallConfirm: 'Esto eliminará la base de datos, modelos de Ollama y configuraciones. ¿Continuar?',
        uninstallConfirm2: '¿Estás absolutamente seguro? Esto no se puede deshacer.',
        uninstallSuccess: 'Monitoreo eliminado exitosamente. Esta página dejará de funcionar en breve.',
      },
      plans: { title: 'Planes', empty: 'Aún no hay planes.', all: 'Todos', draft: 'Borrador', active: 'Activo', completed: 'Completado', archived: 'Archivado', input: 'Consultados', output: 'Producidos', noRelations: 'Sin entradas relacionadas.', noPlans: 'Sin planes relacionados.', originPlan: 'Plan de Origen', consultedBy: 'Planes que Consultaron', tasks: 'Tareas', activePlans: 'Planes Activos', noTasks: 'Sin tareas aún.', progress: 'completadas', newPlan: 'Nuevo Plan', planTitle: 'Título', planTitlePlaceholder: '¿De qué trata este plan?', planContent: 'Descripción', planContentPlaceholder: 'Describe los objetivos, enfoque y consideraciones del plan...', tagsPlaceholder: 'tag1, tag2, tag3', addTask: 'Agregar Tarea', taskPlaceholder: 'Tarea', createDraft: 'Crear Borrador', template: 'Plantilla', delete: 'Eliminar', confirmDelete: '¿Estás seguro de que quieres eliminar este plan? Esta acción no se puede deshacer.' },
      update: { section: 'Actualizaciones', check: 'Buscar actualizaciones', checking: 'Buscando...', upToDate: 'Actualizado', available: 'Actualización disponible' },
      settings: { language: 'Idioma', dataManagement: 'Gestión de Datos', exportDesc: 'Exporta tu conocimiento y planes para respaldo o migración.', importDesc: 'Importa conocimiento o planes de una exportación anterior.' },
      language: { en: 'Inglés', es: 'Español', pt: 'Portugués (BR)' },
    },
  },
  pt: {
    translation: {
      app: { title: 'Base de Conhecimento IA', subtitle: 'Gestão semântica de conhecimento para agentes de IA' },
      nav: { home: 'Base de Conhecimento', add: 'Adicionar Conhecimento', tags: 'Tags', plans: 'Planos', stats: 'Estatísticas', statsKnowledge: 'Conhecimento', statsPlans: 'Planos', settings: 'Configurações' },
      statsTitle: { knowledge: 'Estatísticas de Conhecimento', plans: 'Estatísticas de Planos' },
      search: { placeholder: 'Buscar conhecimento semanticamente...', button: 'Buscar', noResults: 'Nenhum resultado encontrado.', resultsCount: '{{count}} resultado(s) encontrado(s)', recent: 'Conhecimento Recente', empty: 'Nenhuma entrada ainda. Adicione conhecimento para começar.' },
      knowledge: { content: 'Conteúdo', tags: 'Tags', type: 'Tipo', scope: 'Escopo', source: 'Fonte', confidence: 'Confiança', expires: 'Expira', agent: 'Agente', version: 'Versão', created: 'Criado', updated: 'Atualizado', relatedIds: 'Relacionados' },
      types: { decision: 'Decisão', pattern: 'Padrão', fix: 'Correção', constraint: 'Restrição', gotcha: 'Pegadinha' },
      actions: { save: 'Salvar', cancel: 'Cancelar', edit: 'Editar', delete: 'Excluir', confirm: 'Confirmar', close: 'Fechar', bulkSelect: 'Seleção Múltipla', export: 'Exportar', selected: 'selecionados', selectAll: 'Selecionar Tudo', deselectAll: 'Desmarcar Tudo' },
      delete: { title: 'Excluir Conhecimento', message: 'Tem certeza que deseja excluir esta entrada? Esta ação não pode ser desfeita.' },
      add: { title: 'Adicionar Novo Conhecimento', success: 'Entrada de conhecimento criada com sucesso' },
      edit: { title: 'Editar Conhecimento', success: 'Entrada de conhecimento atualizada com sucesso' },
      stats: { title: 'Estatísticas de Conhecimento', total: 'Total de Entradas', byType: 'Por Tipo', byScope: 'Por Escopo', tagCloud: 'Nuvem de Tags', cleanCache: 'Limpar cache', cacheClean: 'Cache limpo', cleanTooltip: 'Remover embeddings não utilizados', reads1h: 'Leituras (1h)', reads24h: 'Leituras (24h)', writes1h: 'Escritas (1h)', writes24h: 'Escritas (24h)', searches: 'buscas', mutations: 'mutações' },
      tags: { title: 'Tags', total: 'tags encontradas', empty: 'Nenhuma tag encontrada. Adicione conhecimento primeiro.', showAll: 'Ver todas', showLess: 'Ver menos', loading: 'Carregando tags...' },
      filters: { type: 'Filtrar por tipo', scope: 'Filtrar por escopo', tags: 'Filtrar por tags', all: 'Todos', clear: 'Limpar filtros' },
      monitoring: {
        title: 'Configurações', subtitle: 'Monitoramento e gerenciamento de infraestrutura',
        infraSection: 'Monitoramento de Infraestrutura',
        database: 'Banco de Dados', ollama: 'Ollama', sqlite: 'SQLite',
        connected: 'Conectado', disconnected: 'Desconectado',
        allReady: 'Todos os sistemas operacionais', degraded: 'Alguns serviços estão fora do ar', checking: 'Verificando serviços...',
        actions: 'Gerenciamento',
        repair: 'Reparar Infraestrutura', repairing: 'Reparando...',
        repairConfirm: 'Isso reiniciará o Ollama e reinicializará o banco de dados. Continuar?',
        repairHint: 'Reparar reinicia o Ollama e reinicializa os serviços. Desinstalar remove o banco de dados, modelos do Ollama e configurações permanentemente.',
        uninstall: 'Desinstalar', uninstalling: 'Desinstalando...',
        uninstallConfirm: 'Isso vai remover o banco de dados, modelos do Ollama e todas as configurações. Continuar?',
        uninstallConfirm2: 'Tem certeza absoluta? Isso não pode ser desfeito.',
        uninstallSuccess: 'Monitoramento removido com sucesso. Esta página vai parar de funcionar em breve.',
      },
      plans: { title: 'Planos', empty: 'Nenhum plano ainda.', all: 'Todos', draft: 'Rascunho', active: 'Ativo', completed: 'Concluído', archived: 'Arquivado', input: 'Consultados', output: 'Produzidos', noRelations: 'Sem entradas relacionadas.', noPlans: 'Sem planos relacionados.', originPlan: 'Plano de Origem', consultedBy: 'Planos que Consultaram', tasks: 'Tarefas', activePlans: 'Planos Ativos', noTasks: 'Sem tarefas ainda.', progress: 'concluídas', newPlan: 'Novo Plano', planTitle: 'Título', planTitlePlaceholder: 'Sobre o que é este plano?', planContent: 'Descrição', planContentPlaceholder: 'Descreva os objetivos, abordagem e considerações do plano...', tagsPlaceholder: 'tag1, tag2, tag3', addTask: 'Adicionar Tarefa', taskPlaceholder: 'Tarefa', createDraft: 'Criar Rascunho', template: 'Modelo', delete: 'Excluir', confirmDelete: 'Tem certeza que deseja excluir este plano? Esta ação não pode ser desfeita.' },
      update: { section: 'Atualizações', check: 'Verificar atualizações', checking: 'Verificando...', upToDate: 'Atualizado', available: 'Atualização disponível' },
      settings: { language: 'Idioma', dataManagement: 'Gerenciamento de Dados', exportDesc: 'Exporte seu conhecimento e planos para backup ou migração.', importDesc: 'Importe conhecimento ou planos de uma exportação anterior.' },
      language: { en: 'Inglês', es: 'Espanhol', pt: 'Português (BR)' },
    },
  },
};

const LANG_KEY = 'ai-knowledge-lang';
const SUPPORTED_LANGS = ['en', 'es', 'pt'];
const savedLang = typeof window !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;

function detectBrowserLang(): string {
  if (typeof navigator === 'undefined') return 'en';
  const browserLang = navigator.language?.split('-')[0];
  return SUPPORTED_LANGS.includes(browserLang) ? browserLang : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: savedLang || detectBrowserLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(LANG_KEY, lng);
});

export default i18n;
