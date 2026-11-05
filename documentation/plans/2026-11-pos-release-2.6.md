# Pós-release 2.6.0 — correções e ajustes (plano vivo)

Plano vivo: cada problema que o mantenedor apontar entra aqui, agrupado por área, já com a solução proposta. Nada é aplicado sem o item estar aqui com solução e critério de aceite. Os itens saem de `Aberto` para `Feito` com o commit.

Base: `main` em `c8a1edd` (release 2.6.0 publicada). Regras de sempre: contrato 1.2 (aditivo), sem bump/tag/publish sem o mantenedor, testes herméticos, um PR por grupo.

## Como ler a tabela

Status: `Aberto` (relatado, sem causa confirmada), `Causa confirmada`, `Solução proposta`, `Feito`.

## Varredura com Playwright (2026-11-05)

App rodando com `scripts/local-test.sh web --copy-db` (sidecar da árvore atual, HOME em sandbox, cópia do banco real com 1.644 entradas; o banco real não foi aberto para escrita). Um crawler Playwright visitou 32 rotas, clicou 232 links e 281 botões não destrutivos, registrando erros de console, exceções da página, respostas HTTP ≥ 400, toasts de erro, destino de cada clique e medidas de layout. Depois, fluxos dirigidos (curadoria, detalhe de plano e de conhecimento, chips de estatística, botões de dia em Tokens) e uma passada de layout no WebKit, o motor do macOS. Resultado: nenhum link `<a>` quebrado e nenhuma exceção ao carregar páginas. Os defeitos estão em botões que navegam, em ações da curadoria e no layout, listados abaixo.

## Grupo A — Instalação local e upgrade (Linux)

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| A.1 | App 2.5.3 instalado abre a janela com "Error receiving data: Connection reset by peer" | `/usr/bin/cognistore-dashboard` é a 2.5.3 (deb de 28/10). O `cognistore.log` mostra o sidecar iniciando e "SDK initialized" às 09:05, e o `systemd-coredump` registra `SIGABRT` do `node dist-server/index.js` às 09:05:41, 4 s depois. O banco real passou de 2.4.1 para 2.4.6 entre a minha cópia (R.2) e agora | Hipótese: o MCP `@cognistore/mcp-server@latest` (2.6.0, via `npx`) migrou o banco compartilhado antes de o app ser atualizado. **Não reproduzido**: o sidecar instalado rodou 25 s sem falhar numa cópia do banco já migrado. O runner de migrações antigo ignora versões de esquema desconhecidas (só aplica a própria lista), o que enfraquece a hipótese | 1) Reproduzir com HOME real somente leitura, token e requisições numa cópia; 2) se confirmar, decidir entre: (a) o MCP novo não migrar sozinho quando o app instalado for mais antigo, (b) instrução de atualizar o app antes do MCP | Aberto |
| A.2 | Ordem de upgrade: o pacote npm do MCP atualiza sozinho (`@latest`) antes do app desktop | O `npx @cognistore/mcp-server@latest` está em uso nas sessões do Claude e migrou o banco | A matriz T.4 testou o MCP novo contra bancos antigos, mas não o **app antigo** contra o banco migrado pelo MCP novo | Adicionar à matriz: app/sidecar da versão N-1 contra banco migrado pela versão N (smoke: abre, /api/health, /api/stats, listagem) | Solução proposta |

## Grupo B — Layout e telas (Configurações e Estatísticas)

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| B.1 | Configurações "ficou muito ruim" | Capturas no Chromium e no WebKit: título colado no topo e na barra lateral, abas de seção como links soltos sem indicação da aba ativa, "Theme" sem espaçamento | Em parte é o B.3 (sem margem). A navegação de seções (`SettingsPage.tsx:33-35`) usa `<Link>` com estilo inline e nenhum estado ativo | Corrigir B.3; dar estilo de aba às seções, com a ativa destacada. O redesenho completo da tela fica para depois das capturas do Mac | Parcial: aba ativa destacada (falta commit); redesenho visual pendente |
| B.2 | A lista de tags e escopos das Estatísticas cresce sem limite e estica a tela | Captura do mantenedor; `StatsPage.tsx:58` (`ClickableBars`) renderiza um chip por item, sem limite | Sem limite nem "ver mais" | Mostrar os 8 primeiros e um botão "Ver todos (N)" / "Ver menos" | Feito (falta commit) |
| B.3 | Quase todas as telas sem margem: conteúdo encostado na barra lateral e no topo | Medido em 18 rotas: o título fica a 0 px da borda da área principal em 16 delas | `styles.css:97` aplica o padding em `.shell-main > main`, mas o filho de `.shell-main` é `div[data-testid=route-content]` (`Layout.tsx:36`), então a regra nunca casa. A Curadoria compensava com `p-6` próprio | Mover o padding para `.shell-main > [data-testid="route-content"]` e tirar o `p-6` da Curadoria | Feito (falta commit) |
| B.4 | Espaço em branco gigante no fim do app | WebKit, `/insights/knowledge`: o documento tem 2.172 px de altura numa janela de 800 px (Chromium: 1.601 de 860), com uma segunda barra de rolagem além da área principal | O texto acessível `sr-only` dos gráficos (`ChartPanel.tsx:27`) é `position:absolute` sem ancestral posicionado, então fica posicionado em relação à página inteira e a estica | `position: relative` em `.shell-main` | Feito (falta commit) |

## Grupo C — Navegação

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| C.1 | "← Back to plans" não volta para a lista | **Reproduzido**: após o clique a URL continua `/plans/<id>?select=<id>` | `backToList` (`plans/usePlansRoute.ts:24`) mantém o `?select=<id>`, e o `PlanDetailRedirect` (`App.tsx:38-51`) devolve para o detalhe | Remover `select` do `search` antes de navegar (mantém status, escopo, ordenação e página) | Feito (falta commit) |
| C.2 | "Alguns links não funcionam" | O crawler clicou os 232 links `<a>`: todos chegaram ao destino. Os casos quebrados são botões que navegam: C.1, C.3, C.4 | — | Coberto por C.1, C.3, C.4 | Resolvido na varredura |
| C.3 | No detalhe de um plano, clicar em outro plano da cadeia (Original, Rodadas) não abre esse plano | **Reproduzido**: a URL fica no plano atual | `openPlan` (`usePlansRoute.ts:23`) também carrega o `?select=<atual>`, e o redirect da linha 50 volta para o plano atual | Mesma correção do C.1, no `openPlan` | Feito (falta commit) |
| C.4 | Os chips das Estatísticas (tipo, escopo, agente, plataforma, tag) não filtram nada | **Reproduzido**: todos levam a `/?type=...`, que mostra a Visão geral sem filtro | `StatsPage.tsx:50` navega para `/`; a lista filtrável é `/knowledge`, que já lê esses parâmetros (`HomePage.tsx:103-108`) | Navegar para `/knowledge?<filtro>=<valor>` | Feito (falta commit) |

## Grupo D — Curadoria

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| D.1 | "Ação falhou" ao aprovar ou rejeitar o primeiro item da fila | **Reproduzido**: `POST /api/curation/batch` → 400 "Invalid batch body" para o id `cc4787b0d4234b207e971b026fe57797` | Os flags migrados do cleanup antigo (`2.4.6.sql:92`, `lower(hex(randomblob(16)))`) têm id sem hífens, que o `idPattern` das rotas (`curation-routes.ts:7`) rejeita. Também não têm snapshot nem versões esperadas, então o motor não conseguiria aplicá-los | Migração só de dados `2.6.1.sql` reescreve os ids no formato UUID; aprovar um flag passa a significar "reconhecer" (status aplicado, sem mexer nas entradas) e desfazer volta para pendente | Feito (falta commit) |
| D.2 | **Crítico.** Aprovar uma proposta "complementar" sempre falha, e aprovar um merge grava lixo em `related_ids` | **Reproduzido** numa cópia: `TypeError: related is not iterable`; após um merge, a entrada canônica fica com `related_ids = '[{},{}]'`. No banco real há 0 linhas afetadas (nenhum merge aplicado ainda), mas a auto-aplicação e qualquer usuário da 2.6.0 que aprovar um merge corrompem o campo | `parse()` em `curation-engine.ts:179` devolve `{}` para `null`, e `related_ids` é `NULL` em todas as entradas. As linhas 217 (merge) e 219 (complementar) usam esse retorno como lista | `parseList()` que sempre devolve uma lista de strings, usado nas duas linhas; a migração `2.6.1.sql` limpa valores não-texto de `related_ids` já gravados | Feito (falta commit) |
| D.3 | Falha da curadoria sem diagnóstico | `curation-routes.ts:130-133` engole a exceção (`catch {}`) e responde só `conflict` | Sem log | Registrar a exceção no log do sidecar (`request.log.warn`) | Feito (falta commit) |

## Grupo E — Ações pequenas sem retorno

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| E.1 | "Open in editor" avisa erros com `alert()` nativo | `PlansPage.tsx:723-731` | Diálogos nativos não são confiáveis na webview do Tauri | Trocar por `toast.error` (o `sonner` já está importado) | Feito (falta commit) |
| E.2 | "Copiar caminho" do arquivo do plano gera exceção não tratada quando a área de transferência é negada | `NotAllowedError` capturado como erro da página; `PlansPage.tsx:940` sem `.catch` | Promessa sem tratamento | `.catch` com toast "Não foi possível copiar o caminho." | Feito (falta commit) |

## Grupo F — Testar localmente antes de publicar

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| F.1 | O mantenedor quer testar a versão nova localmente antes de publicar | — | — | `scripts/local-test.sh web [--copy-db]` (sidecar da árvore atual em HOME de sandbox, http://127.0.0.1:3299) e `app [--copy-db]` (bundle Tauri real com HOME de sandbox). Já escrito e usado nesta varredura; falta versionar | Feito (falta commit) |

## Grupo G — Investigação completa (2026-11-05)

Auditoria com Playwright de todos os fluxos que mudam dados, no app local (`scripts/local-test.sh web --copy-db`, cópia do banco real), mais leitura do código. Funcionaram: criar, editar e excluir conhecimento (individual e em lote); criar plano com tarefas, mudar status, prioridade e notas, arquivar e excluir; rejeitar, aprovar e desfazer na curadoria; rodar a curadoria; idioma (en, pt, es) e tema persistem; retenção; checagem de duplicatas; re-deploy e remoção de embeddings órfãos; datas e filtros de Insights; paleta Ctrl+K; navegação lateral, voltar e avançar; redirecionamentos antigos (`/stats`, `/tokens`, `/providers`, `/widgets`); 390 px sem rolagem horizontal; export.

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| G.1 | Importar o próprio backup falha: "Import failed: API error: Payload Too Large" | Export de 1658 entradas e 179 planos gera um JSON de 5,3 MB; `POST /api/import` responde 413 `Request body is too large` | `Fastify({ logger: true })` (`server/index.ts:414`) usa o `bodyLimit` padrão de 1 MiB, inclusive em `/api/import` (`:2248`) | `bodyLimit` próprio na rota `/api/import` (ex.: 64 MiB), sem aumentar o limite global; teste de integração com um arquivo acima de 1 MiB | Feito (falta commit) |
| G.2 | Endereço inexistente mostra a área de conteúdo vazia, sem título nem mensagem | `/not-a-real-route` e `/nope/xyz`: `route-content` vazio | O `<Routes>` interno do `Layout` (`App.tsx:199`) não tem rota `*` | Página "não encontrada" com link para o Knowledge, em en, es e pt | Feito (falta commit) |
| G.3 | Link direto para conhecimento ou plano que não existe abre a lista sem aviso | `/knowledge/<id inexistente>` e `/plans/<id inexistente>`: `GET` 404, sem toast ou mensagem | Os redirecionamentos de detalhe ignoram o 404 | Toast "não encontrado" e remoção do `?edit=` ou `?select=` da URL | Feito (falta commit) |
| G.4 | Sugestões de tags propõem juntar tags diferentes: `modal/modals/models`, `blocking/mocking/locking`, `fallback/callback`, `v0.2.0/v0.8.0`, `phase-13/phase-4`, `adr-0014/adr-0020`, `round-9/round-7` | `/knowledge/tags`; aplicar essas sugestões corromperia as tags | `tagSimilarity` (`knowledge.service.ts:742`) usa Levenshtein normalizado ≥ 0,82, que aceita uma letra trocada e números diferentes. O laço também compara todos os pares de tags dentro da requisição | Só sugerir variantes de forma: separador (`-`, `_`, `.`, espaço), caixa, plural simples (`s`/`es`) e Jaccard de tokens. Nunca sugerir quando a diferença for numérica | Feito (falta commit) |
| G.5 | Os modais de Export e Import não são diálogos acessíveis: Esc não fecha, sem `role="dialog"`, sem foco preso | `SettingsPage.tsx:686` em diante: `div` com estilo inline | Modal feito à mão | Usar o componente `Dialog` já usado no resto do app | Feito (falta commit) |
| G.6 | O formulário de provedor começa em stdio, mas stdio vem desabilitado; Salvar devolve 400 | `POST /api/providers` 400 "enable allowStdioProviders". A mensagem aparece no formulário, mas só depois de preencher tudo. Campos só com placeholder, sem rótulo | `emptyStdio()` é o rascunho padrão (`ProvidersSection.tsx:136`) | Padrão remoto; stdio com aviso antes do preenchimento quando desabilitado; `aria-label` nos campos | Feito (falta commit) |
| G.7 | Settings e Providers usam o mesmo ícone 🔌 na barra lateral | Captura da barra lateral | — | Ícone próprio para Settings (⚙️) | Feito (falta commit) |

Achado durante a verificação de G.1: com o limite de tamanho corrigido, o import do backup real ainda falhava com 400 "String must contain at most 300 character(s)". O schema de import limitava `source` a 300 caracteres, mas a criação aceita 500 (`MAX_SOURCE_LENGTH`); 8 entradas reais passavam de 300. Corrigido no mesmo item (G.1), com teste.

Fora do alcance do navegador (fica para o checklist manual do `scripts/local-test.sh app`): assistente de instalação completo, upgrade, desinstalação, bandeja, janelas de widget, auto-update, keychain e OAuth de provedor, reparar infraestrutura, instalar modelo.

## Não são defeitos

- Tokens zerado: era o filtro de provedor "Copilot" salvo pelo próprio crawler. O filtro é persistido nas configurações.
- O 403 de "Open in editor" no sandbox vem da lista de pastas permitidas: o arquivo do plano está fora do HOME do sandbox.
- Abrir e fechar o detalhe de conhecimento, abas da Curadoria, períodos de Insights e os botões de salvar das Configurações funcionaram.

## Pendências

- A.1: terminar a reprodução antes de propor correção de código.
- B.1/B.2 (redesenho visual): capturas do Mac depois que B.3 e B.4 estiverem corrigidos, porque eles mudam a aparência de todas as telas.

## Registro

- 2026-11-05 — Correções aplicadas (B.1 parcial, B.2–B.4, C.1, C.3, C.4, D.1–D.3, E.1, E.2, migração de dados 2.6.1). `pnpm verify` verde (core 242, dashboard 92, ui 30, integração 647). Re-auditoria com Playwright no app local (cópia do banco real, Chromium e WebKit): 30/30. Falta o commit, com o OK do mantenedor.
- 2026-11-05 — Varredura com Playwright: 32 rotas, 232 links, 281 botões, mais fluxos dirigidos e passada no WebKit. Entraram B.3, B.4, C.3, C.4, D.1–D.3, E.1, E.2 e F.1; C.2 resolvido pela varredura; D.2 é corrupção de dados e vai primeiro.
- 2026-11-05 — C.1 (link "Back to plans") relatado pelo mantenedor; causa localizada no código (`backToList` mantém `?select=`). Grupo C criado.
- 2026-11-05 — Plano criado a partir de três relatos do mantenedor no mesmo dia (janela com erro no Linux, Configurações e Estatísticas ruins no Mac).
