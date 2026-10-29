# Plano v2.6: Performance, Curadoria Automática, Testes, Limpeza e Nova UI

> **Status:** proposto · **Criado:** 2026-10-28 · **Atualizado:** 2026-10-28 · **Base:** v2.5.2 → **alvo v2.6.0**
> **Dono:** mantenedor · **Execução:** por fases, um PR por fase (ou por item grande)
>
> Agentes: para executar uma fase, use a skill `cognistore-phase` (`.claude/skills/cognistore-phase/`).
> Marque os checkboxes deste arquivo conforme concluir e registre desvios na seção "Diário de execução" no fim.

---

## 1. Problema

1. **Lentidão e travamentos** em máquinas com banco grande (~70 MB, meses de uso).
2. **O conhecimento só cresce.** Duplicatas, entradas "SUPERSEDED", fatos obsoletos e tags inconsistentes se acumulam. O ciclo de limpeza atual (`cleanup_reports`) é 100% manual, vem **desligado** (`cleanupEnabled: false`) e um relatório aberto e ignorado bloqueia o ciclo.
3. A LLM local (Ollama) é usada só para embeddings e para o *preview* de merge. Queremos que ela (e o agente que roda o CogniStore) **mantenha a base sozinha**: mesclar, atualizar, rebaixar e apagar conhecimento velho, com segurança e com desfazer.
4. **O app já tem consumidores em produção** (outras máquinas, MCP server via npm, Claude Code/Copilot/OpenCode configurados). Toda mudança precisa **atualizar corretamente** a partir de qualquer versão anterior, sem perder dados nem quebrar agentes.
5. **Cobertura de testes insuficiente para liberar com confiança**: não há medição de cobertura no CI, não há testes de componentes da UI, nem matriz de upgrade/compatibilidade entre versões.
6. **UI datada e código morto**: ícones em emoji, tema só escuro, sem paleta de comandos, sem estados vazios/skeletons; arquivos, exports e dependências que não são mais usados.

## 1.1 Escopo da v2.6

**Decisão (2026-10-28, mantenedor): tudo entra na v2.6.0** — Fases 0, T, L, 1, U, 2, 3 e 4, fechando com a Fase R. Para reduzir risco num release grande:
- trabalhar em PRs pequenos contra um branch de integração `release/2.6` (um PR por item/tela), com `pnpm verify` verde em cada um;
- a curadoria automática sai na 2.6.0 com autonomia padrão **`suggest`**; `auto-safe` vira padrão numa 2.6.x depois de 2 semanas sem falso positivo (R.6);
- builds de pré-release (`2.6.0-beta.N`) instalados nas suas máquinas antes do release final.

## 1.2 Contrato de compatibilidade (vale para TODAS as fases)

Consumidores atuais e o que cada um exige:

| Consumidor | Risco | Regra |
|---|---|---|
| Bancos existentes em outras máquinas (qualquer versão ≥ 0.8.0, incluindo o caminho legado 1.3.0 `consumption_*`) | Migration falhar ou perder dado | Upgrade testado a partir de **fixture de cada versão de schema** (Fase T.3). Migrations idempotentes e transacionais. Backup automático do `.db` antes de migrar no fluxo de upgrade. |
| MCP server publicado no npm (`@cognistore/mcp-server`), pinado por `mcp-entry` | **MCP novo roda as `EMBEDDED_MIGRATIONS` e migra o banco antes do app atualizar**; MCP antigo abre banco novo | Migrations só aditivas; colunas novas com default; código novo tolera ausência das tabelas novas; código antigo ignora colunas novas. Matriz testada (T.4). |
| Agentes (Claude Code, Copilot, OpenCode) — configs, hooks, skills, instruções injetadas | Quebrar injeção/remoção, duplicar hooks, skill com ferramenta inexistente | Snapshot tests da injeção por plataforma + teste de idempotência (rodar setup 2×) + teste de simetria uninstall (T.5). |
| Ferramentas MCP (nomes, parâmetros, formato de resposta) | Agente/skill antiga chamar ferramenta que mudou | **Nenhuma ferramenta removida ou renomeada na 2.6**; parâmetros só adicionados (opcionais); respostas só ganham campos. Contrato congelado em teste (T.6). |
| API HTTP do sidecar (dashboard, widgets Tauri) | Widget/janela antiga chamando rota que mudou | Rotas novas em vez de quebrar as antigas; remover rota só após 1 versão com aviso. |
| Auto-update Tauri (`plugin-updater`) | Update quebrar o fluxo de atualização seguinte | Testar update 2.5.2 → 2.6.0 → 2.6.1 (dry-run) antes de publicar. |

## 2. Diagnóstico (medido em 2026-10-28 no banco de uma máquina de desenvolvimento, 42 MB)

### 2.1 Para onde vão os bytes

| Objeto | Tamanho | Observação |
|---|---|---|
| `token_usage` + 3 índices + autoindex | **~20,4 MB (48%)** | 60.874 linhas desde mai/2026, ~22k/mês no pico. Não é conhecimento. |
| `knowledge_entries` | 4,6 MB | 1.476 entradas, conteúdo médio 1,7 KB, máx 11 KB |
| `knowledge_fts_content` | 4,1 MB | **Cópia integral** de title/content/tags (FTS5 não usa `content=`) |
| `knowledge_fts_data` | 2,3 MB | índice invertido |
| `plan_tasks` + `plans` + `plan_relations` | ~3,4 MB | 124 planos (110 concluídos) |
| `operations_log` + 2 índices | ~1,7 MB | 19k linhas; um INSERT por leitura/escrita |
| embeddings (vec0, 256 dims) | ~3,2 MB | conhecimento + planos |
| `scan_state` | ~0,6 MB | 1.748 arquivos JSONL rastreados |

**Conclusão:** em um banco de "70 MB", provavelmente **metade ou mais é telemetria** (`token_usage`, `operations_log`), não conhecimento. Confirmar com `scripts/diagnose-db.mjs` na máquina de 70 MB (Fase 0).

### 2.2 Por que trava (não só "está grande")

O sidecar Fastify usa **better-sqlite3 (síncrono)**. Toda query longa congela o servidor inteiro (UI, API, widgets). Pontos encontrados:

| # | Ponto | Arquivo | Por que pesa |
|---|---|---|---|
| P1 | Detecção de duplicatas | `knowledge.repository.ts` → `collectDuplicatePairs` | `listAll()` carrega **todo o conteúdo** de todas as entradas; depois faz **1 KNN por entrada** (vec0 é força bruta) ⇒ O(N²) na thread principal. Roda a cada 6 h (`maybeGenerateReport`) e ao abrir a saúde em Settings (`/api/health/duplicates`). |
| P2 | Scanner de tokens a cada 5 min | `token-usage/adapters/claude-code.ts`, `scanner.ts` | `readdirSync`/`statSync` em ~1.700 arquivos + `readSync`, tudo síncrono; `upsertScanState` um por arquivo **fora de transação** (1 commit + fsync cada). |
| P3 | Escrita em toda leitura | `knowledge.service.ts` → `search()` | `logOp('read')` faz INSERT **síncrono no caminho da resposta**; `markRead` é UPDATE em `setImmediate` — continua na mesma thread, então sob contenção bloqueia até `busy_timeout` (5 s). |
| P4 | Vários processos no mesmo arquivo | MCP server (1 por sessão de agente) + sidecar | Cada leitura de agente gera escrita (P3) ⇒ disputa de lock de escrita entre N processos ⇒ esperas de até 5 s = "travadas". |
| P5 | `importKnowledge`, `reembedAll`, export | `knowledge.service.ts`, `server/index.ts` | `listAll()` com conteúdo completo em memória. |
| P6 | Dashboard de tokens | `token-usage.repository.ts` | `GROUP BY date(occurred_at)` sobre a tabela crua inteira — cresce para sempre. |
| P7 | PRAGMAs | `db/client.ts` | Só WAL/busy_timeout/FK. Sem `synchronous=NORMAL`, `cache_size`, `mmap_size`, `temp_store`, `PRAGMA optimize`, `journal_size_limit`. WAL chegou a 4,5 MB. |

### 2.3 Qualidade do conhecimento (mesmo banco)

- Similaridade de embedding entre pares: **≥0,92: 6 pares** · ≥0,90: 22 · **≥0,85: 222 pares envolvendo 319 entradas (22% da base)**.
  ⇒ Duplicata *quase idêntica* é rara; o problema real é **sobreposição semântica** ("A e B dizem quase a mesma coisa", "B substitui A"). Isso exige **julgamento de LLM** em clusters, não um limiar mais baixo.
- 8 entradas com `SUPERSEDED`/`DEPRECATED` no título — agentes marcam em vez de apagar, porque não há ferramenta para "substituir".
- 24 entradas com tag `deprecated` paradas; 16 com `keep`.
- Leituras rastreadas: 149 nunca lidas, 149 lidas 1×, 666 de 2–9×, 512 com 10+ — o sinal de uso é bom e pode alimentar o score de obsolescência.
- Nos números absolutos deste banco, as queries isoladas são rápidas (`listAll` com conteúdo: 20 ms; agregação diária de tokens: 19 ms). **As travadas vêm do somatório**: O(N²) do scan de duplicatas, scanner síncrono e disputa de lock de escrita entre processos (P1–P4), que crescem com o banco e com o número de sessões de agente abertas.
- Relatório de limpeza aberto desde **2026-08-10** com 1 candidato pendente; detecção "não lida" só ativa em **2027-02-06**.

## 3. Objetivos e metas mensuráveis

| Meta | Alvo |
|---|---|
| Event-loop lag do sidecar (p99) | < 50 ms em uso normal; nenhum bloqueio > 250 ms |
| `getKnowledge` (MCP) p95, base com 10k entradas | < 150 ms (excluindo tempo do embedding) |
| Nenhum caminho de leitura faz escrita síncrona | 0 |
| Crescimento de telemetria | limitado (retenção + rollup) |
| Base de conhecimento | encolhe ou estabiliza com uso contínuo; toda ação de curadoria tem log + desfazer por 30 dias |
| Cobertura de testes | medida no CI; `core` ≥ 85% linhas; 100% das rotas HTTP e ferramentas MCP com teste; upgrade testado de todas as versões de schema |
| Release | `pnpm verify` único, verde, obrigatório antes de publicar |
| UI | tema claro/escuro, zero violações sérias de acessibilidade, regressão visual estável |

## 4. Princípios

1. **Nada pesado na thread do sidecar.** Jobs longos vão para `worker_threads` com conexão própria, ou rodam em fatias com `await setImmediate` entre lotes.
2. **Leitura não escreve no caminho da resposta.** Sinais de uso vão para buffer em memória e são gravados em lote.
3. **Curadoria é reversível.** Soft-delete + log de ações com snapshot "antes" + undo. Purga definitiva só depois da janela de retenção.
4. **Autonomia em níveis.** Determinístico e óbvio → automático. LLM confiante → automático com undo. Exclusão por idade/abandono → revisão (até o sinal ser confiável).
5. **Compatibilidade primeiro** (seção 1.2): nada que consumidores atuais usam é removido ou renomeado sem um ciclo de depreciação e teste de matriz.
6. **Regras do repositório continuam valendo**: migration `.sql` + cópia em `EMBEDDED_MIGRATIONS` (teste de paridade), `PATCH-NOTES.md`, simetria setup/uninstall, templates de skill para as 3 plataformas.

---

## Fase 0 — Diagnóstico e baseline (curta)

Objetivo: medir antes de mexer e ter um banco grande reprodutível para testes.

- [ ] 0.1 Rodar `node scripts/diagnose-db.mjs` na máquina de 70 MB e colar a saída no "Diário de execução". — **pendente: rodar no PC de 70 MB** (rodado em uma máquina de desenvolvimento, 41 MB; saída resumida no diário 2026-10-28).
- [x] 0.2 Instrumentar o sidecar: `perf_hooks.monitorEventLoopDelay()` com log a cada 5 min (p50/p99/max) e log de "slow op" para qualquer operação de repositório > 100 ms (wrapper simples em volta de `sqlite.prepare(...).all/get/run` nos pontos P1–P6).
- [x] 0.3 Gerador de fixture em `packages/tests/src/performance/fixtures/` : 10k entradas (conteúdo 0,5–10 KB), embeddings aleatórios normalizados, 200k linhas de `token_usage`, 50k de `operations_log`, ~5% de clusters de quase-duplicatas.
- [x] 0.4 Testes `@perf` com orçamento: busca, listagem paginada, stats, detecção de duplicatas, scan de tokens. Registrar o baseline (antes das fases 1+).
- [ ] 0.5 Medir contenção real: com 3 sessões de agente abertas (3 MCP servers) + dashboard, registrar quantas vezes `SQLITE_BUSY`/espera > 100 ms acontece (log no wrapper do 0.2). — **harness pronto (`contention.perf.test.ts`); medição real pendente** com 3 sessões + dashboard no PC de 70 MB (ler as linhas `[perf]` de `~/.cognistore/cognistore.log`).

**Pronto quando:** baseline numérico registrado e fixture rodando no CI (`pnpm --filter @cognistore/tests test:perf`).

## Fase 1 — Performance: parar de travar

### 1A. Ganhos rápidos (baixo risco)
- [x] 1A.1 PRAGMAs em `createDbClient`: `synchronous=NORMAL` (seguro com WAL), `cache_size=-32000`, `mmap_size=268435456`, `temp_store=MEMORY`, `journal_size_limit=67108864`, `wal_autocheckpoint` padrão; `PRAGMA optimize` no fechamento e na manutenção de 6 h. Aplicar igual no MCP server (mesmo `createDbClient`). — **Rodada 2** (7b4b5b6, merge a4e2cf2).
- [x] 1A.2 `logOp`: trocar INSERT por leitura por **contador em memória** com flush em lote (a cada 30 s / no shutdown) direto em `operations_daily`. Avaliar remover `operations_log` cru (o rollup diário já existe). — **Rodada 2**: contador em memória por (op, segundo), flush a cada 30 s numa transação, `operations_log` cru mantido (remoção exige migration → Rodada 5); stats com os mesmos números (teste).
- [x] 1A.3 `markRead`: acumular ids num buffer e gravar em **uma transação** a cada N segundos; usar `busy_timeout` curto (ex. 250 ms) só para essa escrita e descartar se ocupado (sinal best-effort). — **Rodada 2** (`markReadBatch`, 10 s, 250 ms).
- [x] 1A.4 Scanner de tokens: `upsertScanState` em lote dentro de **uma transação**; pular arquivos cujo `mtime`/tamanho não mudou *antes* de abrir; trocar `*Sync` por `fs/promises`; intervalo adaptativo (5 min com atividade, 30 min ocioso). — **Rodada 2** (+ erro de leitura no meio não avança o `scan_state`).
- [x] 1A.5 **PRIORIDADE (achado da Rodada 1):** a página de Settings chama `/api/health/duplicates` no `useEffect` de montagem (`SettingsPage.tsx` ~l.977) → **abrir Settings congela o app inteiro** (~41–44 s com 10k entradas). Com `cleanupEnabled=false` (padrão), esse é o caminho que dispara o scan na máquina do mantenedor — não o timer de 6 h. Correção: carregar duplicatas só sob demanda (botão "Verificar duplicatas"), cachear o resultado por `MAX(updated_at)` + contagem, e a rota responder do cache quando válido. Teste e2e: abrir Settings não chama a rota. — **Rodada 2** (79a9615 + 49a3995, merge ea1dd1e; e2e com Chromium prova 0 chamadas ao montar). Índice em `updated_at` → Rodada 5.
- [x] 1A.7 Instrumentação opt-in no MCP server (`COGNISTORE_PERF=1`, mesmo `instrumentDatabase` do 0.2, linhas `[perf]` em stderr/arquivo) para medir o lado das sessões de agente (pergunta 2 da Rodada 1). — **Rodada 2**.
- [x] 1A.6 Resolver o relatório de limpeza "zumbi": auto-fechar relatórios abertos > 2× intervalo **também quando `cleanupEnabled=false`** (hoje a função retorna antes). — **Rodada 2**.

### 1B. Telemetria com retenção
- [ ] 1B.1 Nova tabela `token_usage_daily(day, source, model, project, input, output, cache_read, cache_creation, messages)` + migration; backfill a partir de `token_usage`.
- [ ] 1B.2 Dashboard de tokens lê do rollup; tabela crua só para a janela detalhada (ex. 30 dias, configurável).
- [ ] 1B.3 Job de retenção: apagar `token_usage` > 90 dias (configurável) após garantir rollup; em lotes de 5k com yield.
- [ ] 1B.4 Revisar índices de `token_usage` (3 índices + PK de texto custam 8,6 MB): manter só os usados pelas queries restantes (`EXPLAIN QUERY PLAN`).
- [ ] 1B.5 `auto_vacuum=INCREMENTAL` (exige um `VACUUM` único — fazer no fluxo de upgrade com progresso) + `PRAGMA incremental_vacuum` na manutenção.

### 1C. Tirar o trabalho pesado da thread principal
- [ ] 1C.1 Criar `packages/core/src/jobs/` com um **JobRunner**: fila de concorrência 1, cada job roda em `worker_threads` com conexão better-sqlite3 própria (+ sqlite-vec carregado); progresso via mensagens; cancelável. Garantir que o bundle do sidecar (tsup) inclui o arquivo do worker.
- [ ] 1C.2 *(antecipado para a Rodada 2 em versão interina: cálculo em blocos com `await setImmediate` entre blocos na thread principal — critério: nenhum bloqueio do event loop > 100 ms durante o scan; o worker vem com o 1C.1)* Reescrever detecção de duplicatas: selecionar só metadados (sem `content`), ler **todos os vetores de uma vez** dos chunks do vec0 para um `Float32Array`, similaridade em blocos (matriz × matriz) **dentro do worker**. 10k × 256 dims é trivial em bloco; não fazer 10k consultas KNN. — **Rodada 2: versão interina feita** (scan cooperativo na thread principal a partir dos chunks do vec0, yield a cada ~15 ms, event loop máx. 15,2 ms na base de 10k). O worker continua na 1C.1/Rodada 5.
- [x] 1C.3 Modo incremental: guardar watermark (`cleanup_meta.dup_scan_at`); comparar só entradas alteradas desde então contra a base inteira. — **Rodada 2** (76ef6a6 + bb065cd, merge 0307679): watermark por limiar em `cleanup_meta` (`dup_scan_state:<limiar>`), incremental 62 ms na base de 10k.
- [ ] 1C.4 Mover para o JobRunner: `reembedAll`, `backfillMissingEmbeddings`, export/import grandes, FTS backfill.
- [ ] 1C.5 `importKnowledge`: deduplicar por hash usando uma coluna `content_hash` indexada (ver Fase 2) em vez de `listAll()`.

### 1D. FTS sem cópia
- [ ] 1D.1 Recriar `knowledge_fts` como **external content** (`content='knowledge_entries', content_rowid='rowid'`) com triggers de insert/update/delete — economiza a cópia de ~4 MB e elimina o dual-write manual em `insertFts/updateFts`. Migration + rebuild (`INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')`).
  - Atenção: `tags` é JSON; o trigger precisa indexar o texto achatado (coluna gerada `tags_text` ou função no trigger).

**Pronto quando:** testes `@perf` mostram lag p99 < 50 ms durante scan de duplicatas + scan de tokens simultâneos na fixture de 10k; banco da fixture ≥ 30% menor após retenção + FTS external.

## Fase T — Cobertura de testes: validar TUDO antes de subir

Hoje: 46 arquivos e ~400 testes em `packages/tests` (runner Playwright, integração via SDK/sidecar), mutation testing pontual (Stryker em `core`), **sem cobertura medida no CI** e **sem testes de UI** no `main` (há trabalho local em `apps/dashboard/e2e` e no branch `feature/test-layer-overhaul`, com falhas conhecidas de acessibilidade e deep-link — reaproveitar).

- [x] T.1 **Medir cobertura**: coletar V8 coverage dos processos de teste e do sidecar/MCP iniciados pelos testes (`NODE_V8_COVERAGE` + `c8 report`), publicar relatório no CI. Registrar baseline por pacote. — **Rodada 3** (554a334): Vitest + `c8` (sidecar e MCP medidos), tabela no job summary, artefato `coverage`, `coverage-baseline.json`.
- [x] T.2 **Camada unitária rápida** (Vitest, já usado pelo Stryker em `core`): repositório, serviços, `cleanup-merge`, `plan-lineage`, scanner de tokens, settings, auth. Banco em memória/arquivo temporário; embeddings fake. Meta: `core` ≥ 85% linhas / 75% branches. — **Rodada 3** (f5da3d0): 135 testes no core, **94,2% / 77,0%**; `auth`/`settings` 28 testes.
- [x] T.3 **Matriz de upgrade de banco**: fixtures `.db` geradas para cada schema histórico (0.8.0, 0.9.0, 1.3.0-legado, 2.0.0, 2.1.0, 2.3.x, 2.4.0, 2.4.1, 2.5.2) com dados realistas → abrir com o código novo → asserts: nenhuma perda de linha, FTS/embeddings íntegros, busca funcionando, migrations idempotentes (rodar 2×). — **Rodada 3** (ef422ee): 11 fixtures (inclui 0.8.0-via-2.1.0 e 2.5.4 no lugar da 2.5.2); achou e corrigiu o bug de bancos v0.8.0.
- [x] T.4 **Matriz MCP × banco**: (a) MCP npm 2.5.x contra banco 2.6; (b) MCP 2.6 contra banco 2.5.2 (ele migra); (c) app 2.6 + MCP 2.5.x abertos ao mesmo tempo. Smoke: `addKnowledge`, `getKnowledge`, `createPlan`, `updatePlanTask`. — **Rodada 3** (f750816): npm 2.5.3/2.5.4 via npx com sandbox; tabela no relatório.
- [x] T.5 **Setup/uninstall/upgrade de artefatos**: em `HOME` temporário — setup → snapshot de todos os arquivos injetados por plataforma → setup de novo (idempotência) → upgrade de versão (re-deploy) → uninstall → árvore volta ao estado inicial (exceto o que é opt-in). — **Rodada 3** (78c8067), corrige B.1.
- [x] T.6 **Contrato MCP congelado**: snapshot do `listTools` (nomes, schemas de entrada, annotations) e de respostas-exemplo; mudança exige atualizar o snapshot conscientemente. — **Rodada 3** (6e67505): snapshot da v2.5.4, 18 ferramentas.
- [x] T.7 **Testes de API do sidecar**: todas as rotas (auth/CSRF, 4xx/5xx, paginação, limites). Gerar a lista de rotas automaticamente e falhar se uma rota nova não tiver teste. — **Rodada 3** (a3fb60c + b90769c): inventário vindo do Fastify (`COGNISTORE_ROUTE_MANIFEST`); três correções de API.
- [ ] T.8 **Testes de componentes React** (Testing Library + jsdom, já são dependências do pacote de testes): páginas principais, modais, filtros, i18n (todas as chaves em pt e en), estados vazio/erro/carregando.
- [ ] T.9 **E2E de UI** (Playwright contra o sidecar com Ollama fake): fluxos de primeiro uso, busca, CRUD de conhecimento, planos, settings, curadoria; **axe-core** para acessibilidade; **regressão visual** (screenshots por página, tema claro/escuro) para a Fase U.
- [x] T.10 **Performance** (Fase 0.3/0.4) entra no mesmo gate. Até a Fase R: job de CI **só de relatório** (não reprova), com `PERF_BUDGET_SCALE=3` e cache do fixture; na Fase R vira bloqueante. — **Rodada 2**: job `perf` no `ci.yml` (relatório; vira bloqueante na Fase R).
- [x] T.10b Corrigir `e2e/upgrade-progress.test.ts:199` (depende do mtime do `~/.claude.json` **real** — falha com um Claude Code aberto); usar só o HOME sandbox. Também: os testes de `cleanup-*.test.ts` têm erros de tipo e o pacote de testes não entra no `pnpm type-check` → incluir. — **Rodada 2** (+ `packages/tests` no `pnpm type-check`, 93 → 0 erros).
- [x] T.11 **Build/empacotamento** (hoje o Rust só compila no `publish.yml`, ou seja, depois do merge — achado na Rodada 0): job `cargo check --locked` + `cargo test` do `src-tauri` em todo PR, com toolchain fixado (`rust-toolchain.toml`, ≥ 1.90 exigido pelo tauri 2.12). Além disso, CI gera o bundle do sidecar e o AppImage/deb no Linux e roda um smoke (sidecar sobe, `/api/health` responde, worker threads e sqlite-vec carregam a partir do bundle). — **Rodada 2: primeira metade feita** (job `rust`: `cargo check --locked` + `cargo test --locked`, `rust-toolchain.toml` 1.97.0, ubuntu-24.04). **Rodada 3: segunda metade feita** (ff3289a): job `sidecar-bundle` monta o bundle e roda `smoke-sidecar-bundle.mjs` (ready marker, `/api/health`, busca semântica = sqlite-vec). AppImage/deb ficam só no `publish.yml` (decisão em `ci-cd.md` e no relatório da Rodada 3).
- [x] T.12 **Comando único** `pnpm verify` = lint + type-check + unit + integração + matriz de upgrade + contrato MCP + UI + perf + knip. Mesmo comando no CI e no hook de pre-push. — **Rodada 3** (a8ab650): `scripts/verify.mjs` + `.husky/pre-push`; lint pulado (nenhum linter), knip condicional, UI quando T.8/T.9 existirem, perf no job próprio.
- [x] T.12b **Higiene do CI** (inclui: documentar o Trusted Publishing do npm em `ci-cd.md` — feito no PR #108 — e um alerta quando o Publish falhar no main, como o do scan semanal) (avisos vistos na Rodada 0): atualizar `pnpm/action-setup` (roda em Node 20, depreciado); fixar `runs-on: ubuntu-24.04` nos jobs (o `ubuntu-latest` está migrando para Ubuntu 26); preencher `reason` em todos os ignores do `osv-scanner.toml` e remover os que não casam mais (11 RUSTSEC do GTK + GHSA-qwww). — **Rodada 3** (a8ab650): ubuntu-24.04 (release Linux fica no 22.04), action-setup v6.1.0, `alert-on-failure`, 17 ignores removidos e `reason` nos 9 restantes.
- [x] T.13 Limiar de cobertura no CI (falha se cair abaixo do baseline; sobe a cada fase). — **Rodada 3** (554a334): gate de 1 pt sobre o baseline (tirado do CI); reprova também linha não medida, source map não carregado e baseline ausente.

**Pronto quando:** `pnpm verify` verde no CI, cobertura publicada, matriz de upgrade e contrato MCP cobrindo todas as versões publicadas.

## Fase L — Limpeza: remover o que não é mais usado

Análise com `knip` no `main` (2026-10-28). **Atenção a falsos positivos** — vários "não usados" são entradas que o knip não enxerga (HTML de widgets no `vite.config.ts`, `tsup.sidecar.ts` chamado por `bundle-sidecar.mjs`, `compile-instructions.mjs`, plugin do OpenCode copiado pelo `config-manager`, dependências nativas externalizadas no bundle do MCP).

- [ ] L.1 Adicionar `knip.json` com essas entradas declaradas, e rodar `knip` no CI (parte do `pnpm verify`).
- [ ] L.2 Remover código confirmado como morto:
  - `apps/dashboard/src/components/AddKnowledgeModal.tsx` (nenhum import);
  - exports não usados (`auth.ts`, `settings.ts`, `upgrade-progress.ts`, `statsSlice.ts` `REFRESH_OPTIONS/setRefreshInterval`, `fts.ts` `sanitizeFtsQuery` export, constantes `CLEANUP_*`/`MERGE_*` exportadas sem uso externo) — tornar internos ou apagar;
  - membros não usados de enums (`TaskStatus`) — **só se não fizerem parte do contrato MCP/SDK**.
- [ ] L.3 Dependências: remover `date-fns` do dashboard (sem import direto; `react-day-picker` traz a própria), `zod` de `core` se confirmado sem uso, `@cognistore/sdk` do pacote de testes se não usado; declarar `sqlite-vec` no pacote de testes (usado sem estar listado).
- [ ] L.4 Banco: migration que remove as tabelas legadas `consumption_samples`/`consumption_ingest_state` (nenhum código lê; existem em instalações que passaram pela 1.3.0) — validar na matriz T.3. Depois da Fase 1B, avaliar remover `operations_log` cru.
- [ ] L.5 Scripts: avaliar `scripts/recover-operations-history.mjs` (recuperação pontual de versão antiga) → mover para `scripts/legacy/` ou apagar; manter `repair-embeddings.mjs` (documentado em `recovery.md`).
- [ ] L.6 Repositório: `assets/logo-icon-backup.jpg`, `screenshot.png` da v2.1.2 (atualizar com a nova UI), `PATCH-NOTES.md` (141 KB) → manter só 2.x recente e mover o resto para `documentation/patch-notes-archive.md`; `README.md` e `CLAUDE.md` com versão/arquitetura atualizadas.
- [ ] L.7 (pode apagar já `packages/core/packages/` e `packages/core/reports/` — sobras do Stryker, autorizado pelo gerente na Rodada 1) Lixo local que não deve existir no repo/disco de dev: `packages/core/packages/core/.stryker-tmp`, `reports/`, `coverage/`, `playwright-report/`, `test-results/` — garantir `.gitignore` e um `pnpm clean` que limpe tudo. — **Rodada 2: parcial** (`packages/core/packages/`, `packages/core/reports/` e `stryker.log` apagados, no `.gitignore`; f3907a3, merge ac61193). Resto (`pnpm clean` etc.) aberto.
- [x] L.0 **Hotfix v2.5.3 (CI de segurança)** — o scan OSV semanal falhava desde 2026-09-07 (8 execuções) sem ninguém ver. Patch em `documentation/plans/patches/` (Rodada 0): fastify 5.12, MCP SDK 1.32, react-router 7.18.5, zod 4.6.6 com API `zod/v3`, overrides transitivos, rustls/tokio/updater/tauri 2.12; issue automática quando o scan agendado falha; `bump-version.sh` portável. PR #107 validado (af03f8b + 82e9f14 — `block-buffer` 0.10 ignorado com justificativa); 6 checks verdes (run 40725120414). Pendente: merge do mantenedor (publica a 2.5.3).
- [ ] L.8 Atualização de dependências (o hotfix 2.5.3 já cobriu o lote de segurança; aqui fica o resto + majors). Incluir `keyring` 3 → 4 / zbus 6 para remover os ignores RUSTSEC-2026-0370/0371/0372:
  - **Lote seguro (minor/patch)**: fastify 5.12, @fastify/*, react/react-dom 19.3, react-router 7.18.5, RTK 2.13, react-redux 9.3, tailwind 4.3, tauri api/cli/plugins 2.12+/updater 2.14, @modelcontextprotocol/sdk 1.32, playwright 1.64, turbo 2.11, drizzle-orm 0.45.4, sqlite-vec 0.1.9, tsx.
  - **Majors, um PR cada, com a suíte da Fase T**: vite 6→8 + @vitejs/plugin-react 6; recharts 2→3 (API mudou — junto com a Fase U); i18next 26 + react-i18next 17; react-day-picker 10; better-sqlite3 13 (ABI nativa — testar bundle Tauri e MCP via npx em Node 24); zod 4 (afeta schemas das ferramentas MCP — validar contrato T.6); tsup 9; TypeScript 7 (compilador nativo — só depois de tudo verde, pode ficar para 2.7).

**Pronto quando:** `knip` sem achados não justificados, dependências atualizadas com `pnpm verify` verde, nenhuma regressão na matriz de compatibilidade.

## Fase U — Nova UI (v2.6)

Pesquisa de referência (out/2026): dashboards de ferramentas de dev convergem para *dark-first* com tema claro de qualidade, tokens semânticos, "minimal chrome" (bordas de 1px, menos sombra, densidade maior), números em fonte mono, sidebar recolhível com estado persistido, gráficos interativos com drill-down, uma única cor de destaque reservando cor para status, e widgets modulares. Também: paleta de comandos (⌘K) como entrada principal, latência percebida baixa (skeletons, otimismo), transições suaves — React 19.3 estabilizou `<ViewTransition>` — e efeitos nativos de janela no Tauri (vibrancy/mica, titlebar customizada).

### U.0 Biblioteca de UI — **decidido: shadcn/ui + Tremor (gráficos)**

Restrições: React 19 + Vite + Tailwind v4 já no projeto, webview Tauri (WebKitGTK no Linux), dark-first, acessível, sem SSR.

| # | Opção | Base | Exemplos / templates |
|---|---|---|---|
| 1 | **shadcn/ui** (+ Tremor para gráficos) — *recomendada* | Tailwind v4 + Radix ou Base UI, código copiado para o repo | ui.shadcn.com/examples/dashboard · shadcn-admin (Vite) · tauri-ui |
| 2 | **HeroUI v3** | Tailwind v4 + React Aria | heroui.com (layouts Dashboard/Mail/CRM — templates completos no Pro) |
| 3 | **Mantine v9** | CSS nativo (sem Tailwind), 120+ componentes + hooks | mantine.dev · ui.mantine.dev |
| 4 | **Tremor** (só dashboards/gráficos) | Tailwind + Radix + recharts | tremor.so · blocks.tremor.so/templates |
| 5 | **daisyUI** | Plugin Tailwind, classes semânticas + temas | daisyui.com |
| 6 | **React Aria Components** | Adobe, sem estilo, a11y mais forte; estilizar com Tailwind | react-spectrum.adobe.com/react-aria |
| 7 | **Park UI / Ark UI** | Panda CSS (trocaria o Tailwind) | park-ui.com |

- [x] U.0.1 Escolha: **shadcn/ui** (Tailwind v4, componentes copiados para `apps/dashboard/src/components/ui/`, primitivos Radix) + **Tremor** para gráficos (Estatísticas/Tokens), ícones **lucide**, toasts **sonner**, ⌘K **cmdk**. Referência de layout: shadcn-admin (Vite, sidebar, busca global).
  - Configurar `components.json` do shadcn apontando para o alias do Vite; tokens do shadcn (`--background`, `--foreground`, `--primary`…) mapeados para os tokens semânticos da U.1, tema escuro como padrão.
  - Tremor (componentes copiados, estilo shadcn) roda sobre recharts: decidir a versão do recharts (2.15 atual vs 3) junto com o item L.8 antes de migrar as telas de gráficos.
- [ ] U.0.2 Spike de 1 dia: sidebar + ⌘K + lista + painel de detalhe na lib escolhida, rodando dentro do Tauri no Linux e no macOS (checar WebKitGTK: selects, popovers, blur).

### U.1 Sistema de design
- [ ] Tokens semânticos em CSS (`--surface-*`, `--text-*`, `--border-*`, `--accent`, `--status-*`) via `@theme` do Tailwind v4; **tema claro + escuro + "seguir o sistema"** (hoje só escuro), sem flash ao abrir.
- [ ] Primitivos acessíveis da biblioteca escolhida em U.0 (Dialog, Dropdown, Tooltip, Tabs, Toast, Command/⌘K, Sheet/Drawer, Table) — substituir os componentes próprios equivalentes (`ConfirmModal`, `KnowledgeModal`, `DateRangePicker`, etc.).
- [ ] Ícones: trocar emojis (🧠📋🔋🔌📊🧩) por um set consistente (lucide).
- [ ] Tipografia: Inter (UI) + mono para números/ids/código; escala de tamanhos única.
- [ ] Storybook-lite ou página interna `/_design` com todos os componentes nos dois temas (base para a regressão visual T.9).

### U.2 Navegação e arquitetura de informação (revisão completa — pedido do mantenedor)

**Objetivo:** chegar a qualquer coisa do app em ≤ 2 cliques ou 1 atalho, e toda tela/entrada/plano/seção ter URL própria (link, voltar/avançar, abrir de outro lugar).

**Hoje (v2.5.2), problemas encontrados:**
- Sidebar plana com 7 itens e emojis; Estatísticas tem sub-rotas (`/stats`, `/stats/plans`) mas Tokens é outra página isolada; Providers solto.
- **Settings é uma página longa que esconde funções importantes**: sugestões de tags, saúde/duplicatas e limpeza (cleanup) vivem lá, sem rota própria.
- Entradas e planos **não têm URL** — abrem em modal via `/?edit=<id>` e `/plans?select=<id>`; o botão voltar não fecha o modal; não dá para linkar.
- Filtros só parcialmente na URL (`?tag`, `?agent`, `?platform`); sem breadcrumbs; sem atalhos; scope/workspace (conceito central) não tem seletor global.
- Setup e Upgrade são telas fora do roteador (ok), mas não há como reabrir "status do setup/agentes" depois.

**Nova estrutura (sidebar agrupada, recolhível, ícones lucide, badges de pendência):**

| Grupo | Item | Rota | Conteúdo |
|---|---|---|---|
| — | Início | `/` | Visão geral: busca, entradas recentes, planos ativos, pendências de curadoria, status (Ollama, banco, jobs) |
| Conhecimento | Base | `/knowledge` · `/knowledge/:id` | Lista + painel de detalhe roteado (fecha com Voltar/Esc) |
| | Tags | `/knowledge/tags` | Nuvem/lista de tags, renomear/mesclar, sugestões (sai de Settings) |
| | Curadoria | `/curation` · `/curation/history` · `/curation/trash` | Fila, histórico com desfazer, lixeira (absorve "limpeza" e "duplicatas" de Settings) — badge com pendentes |
| Trabalho | Planos | `/plans` · `/plans/:id` | Lista/kanban + detalhe com tarefas e cadeia (lineage) |
| Insights | Visão geral | `/insights` | Abas roteadas: `/insights/knowledge`, `/insights/plans`, `/insights/tokens` (Tokens entra aqui) |
| Integrações | Agentes | `/integrations/agents` | **Novo**: status por plataforma (Claude Code, Copilot, OpenCode) — configs/hooks/skills injetados, versão do MCP, botão re-deploy |
| | Providers | `/integrations/providers` | Provedores externos |
| | Widgets | `/integrations/widgets` | (só Tauri) |
| Sistema (rodapé) | Configurações | `/settings/:section` | Seções roteadas: geral, modelos, curadoria, telemetria/retenção, avançado |
| | Saúde do banco | `/system/health` | Tamanho por tabela, % telemetria, jobs, lag do event loop (Fase 4.3) |
| | Sobre / Atualizações | `/system/about` | Versão, changelog, update |

**Navegação transversal:**
- [ ] U.2.1 Novo roteamento com rotas aninhadas (react-router 7) + **redirects de compatibilidade** de todas as URLs antigas (`/?edit=`, `/plans?select=`, `/stats`, `/stats/plans`, `/tokens`, `/providers`, `/widgets`) — widgets/janelas Tauri e links salvos continuam funcionando (contrato 1.2).
- [ ] U.2.2 Sidebar agrupada (shadcn `Sidebar`), recolhível com estado persistido, badges (curadoria pendente, jobs rodando), item ativo correto em sub-rotas.
- [ ] U.2.3 **Paleta ⌘K/Ctrl+K** indexando: todas as rotas e seções de Settings, ações ("novo conhecimento", "novo plano", "rodar curadoria", "reindexar", "trocar tema"), busca semântica de entradas e planos, tags e scopes. Resultados recentes no topo.
- [ ] U.2.4 **Atalhos de teclado** estilo `g` + letra (`g k` Base, `g p` Planos, `g c` Curadoria, `g i` Insights, `g s` Settings), `/` foca a busca, `n` novo, `Esc` fecha painel, `?` mostra a folha de atalhos.
- [ ] U.2.5 **Seletor global de scope/workspace** no cabeçalho (todos / global / workspace:X), refletido na URL (`?scope=`) e aplicado em Base, Planos, Insights e Curadoria.
- [ ] U.2.6 Breadcrumbs no cabeçalho + título da janela por rota; painel de detalhe com navegação anterior/próximo na lista atual.
- [ ] U.2.7 **Links cruzados em todo lugar**: entrada ↔ planos que a usaram/criaram; plano ↔ entradas; tag → Base filtrada; gráfico de Insights → lista filtrada; item de curadoria → entradas envolvidas; chip de agente/plataforma → filtro.
- [ ] U.2.8 Estado de filtros, ordenação, aba e página **sempre na URL** (compartilhável, sobrevive a reload).
- [ ] U.2.9 Estados vazios que ensinam o caminho (ex.: "nenhum plano — crie pelo agente ou ⌘K → Novo plano").
- [ ] U.2.10 Testes: e2e percorre **todas as rotas** pela sidebar, pela ⌘K e por atalho; teste que falha se existir rota sem item de navegação ou comando na paleta (sem páginas órfãs); teste de todos os redirects antigos; axe nos landmarks (`nav`, `main`, `aside`).
- [ ] U.2.11 Barra de status no rodapé: Ollama, tamanho do banco, jobs em execução com progresso (clicável → Saúde do banco).
- [ ] U.2.12 Transições de rota com `<ViewTransition>` (React 19.3), respeitando `prefers-reduced-motion`; titlebar integrada + vibrancy no macOS/mica no Windows (fallback sólido no Linux).

### U.3 Base de conhecimento (tela principal)
- [ ] Lista mais densa com alternância **cartão / lista compacta**; seleção múltipla para ações em lote.
- [ ] **Painel de detalhe lateral roteado** (`/knowledge/:id`, em vez de modal): markdown com destaque de código, metadados (leituras, versão, origem, planos ligados), entradas relacionadas/similares, histórico de curadoria, ações (editar, marcar `keep`, substituir, apagar).
- [ ] Filtros como chips combináveis (tipo, scope, tags, plataforma, status), salvos na URL.
- [ ] Skeletons, estados vazios úteis, toasts com "desfazer".
- [ ] Opcional: visão em grafo de relações (`related_ids`, planos ↔ conhecimento, clusters de similaridade).

### U.4 Demais telas
- [ ] Estatísticas e Tokens: migrar para recharts 3 (L.8), gráficos com tooltip/drill-down, sparklines, números mono, presets de período.
- [ ] Planos: linha do tempo da cadeia (lineage), progresso das tarefas, kanban opcional.
- [ ] Settings reorganizado em seções roteadas (`/settings/:section`: Geral, Modelos, Curadoria, Telemetria/retenção, Avançado); Tags, Curadoria e Saúde do banco saem de Settings para as rotas da U.2.
- [ ] Setup/primeiro uso e Upgrade com progresso claro e mensagens de erro acionáveis.
- [ ] Widgets Tauri com o mesmo sistema de design.

### U.5 Qualidade
- [ ] Acessibilidade: zero violações `axe` sérias, navegação completa por teclado, foco visível, contraste AA nos dois temas.
- [ ] i18n pt/en completo (teste T.8 falha em chave faltando).
- [ ] Orçamento de performance da UI: bundle inicial, tempo até lista renderizada com 10k entradas (virtualização da lista).

**Pronto quando:** todas as telas no novo sistema, regressão visual aprovada nos 2 temas, axe limpo, screenshot/README atualizados.

## Fase 2 — Motor de curadoria (core, roda com LLM local)

Substitui o "relatório a cada 10 dias com aprovação manual de tudo" por um **pipeline contínuo, auditável e reversível**. Reaproveita `cleanup-merge.ts` (validação de draft, tags derivadas) e `llm-merge.ts`.

### 2.1 Modelo de dados (migration nova)
- [ ] `knowledge_entries`: `status TEXT NOT NULL DEFAULT 'active'` (`active` | `superseded` | `archived` | `trashed`), `superseded_by TEXT`, `content_hash TEXT` (indexado), `curated_at TEXT`, `trashed_at TEXT`.
- [ ] Busca, listagem, stats, KNN e FTS filtram `status='active'` (índice parcial).
- [ ] `curation_runs(id, started_at, finished_at, trigger, model, budget, stats JSON)`.
- [ ] `curation_actions(id, run_id, kind, entry_ids JSON, result_entry_id, reason, confidence, actor ('local-llm'|'agent:<platform>'|'user'|'rule'), before_snapshot JSON, status ('applied'|'undone'|'proposed'|'rejected'), created_at)`.
- [ ] Purga: `trashed` há > 30 dias (configurável) é apagado de verdade (e embeddings/FTS/relations).
- [ ] Migrar entradas existentes: título `[SUPERSEDED by X]` → `status='superseded', superseded_by=X`; tag `deprecated` → candidata de regra.

### 2.2 Pipeline (um job do JobRunner, com orçamento de tempo e de itens)
1. **Regras determinísticas (auto):** hash de conteúdo idêntico → mantém o mais novo; `expires_at` vencido → trash; `superseded` há > 14 dias → trash; tag `deprecated` há > N dias sem leitura → trash.
2. **Clusterização:** similaridade ≥ 0,85 (configurável) dentro do mesmo `scope` (+ `global`), componentes conexos, tamanho máx. 8 (quebrar clusters gigantes).
3. **Juiz LLM por cluster** (saída JSON validada por schema — usar `format` com JSON Schema do Ollama):
   - `duplicate` → merge (usa `buildMergeDraft`);
   - `supersedes` → mantém o novo, marca o velho `superseded`;
   - `complementary` → só liga via `related_ids`;
   - `distinct` → marca o par como "julgado" (não reavaliar até um dos dois mudar).
   Cada veredito traz `confidence` e `reason`.
4. **Envelhecimento:** score de obsolescência = f(idade desde `updated_at`, `last_read_at`, `read_count`, `confidence_score`, tipo — `gotcha`/`fix` de workspace envelhecem mais rápido que `decision`/`constraint`, atividade recente do mesmo scope). Acima do limiar → LLM recebe a entrada + 3 vizinhas mais novas do mesmo scope e responde `still_valid` | `outdated` | `unsure`.
5. **Reestruturação leve:** normalização de tags (LLM propõe mapa de sinônimos → aplica via `renameTag` existente), títulos ruins (vazios/genéricos) reescritos.

### 2.3 Política de autonomia (settings `curationAutonomy`: `off` | `suggest` | `auto-safe` | `auto`)
| Ação | `suggest` | `auto-safe` (padrão) | `auto` |
|---|---|---|---|
| Regras determinísticas | proposta | **aplica** | aplica |
| Merge/supersede com confiança ≥ 0,85 | proposta | **aplica (undo 30 d)** | aplica |
| Merge/supersede com confiança < 0,85 | proposta | proposta | aplica se ≥ 0,7 |
| Obsoleto por idade | proposta | proposta | aplica (trash) |
| Normalização de tags | proposta | proposta | aplica |

Entradas com tag `keep` e `type='system'` nunca são tocadas. Tudo vira linha em `curation_actions`.

### 2.4 Quando roda
- [ ] Agendador no sidecar: quando **ocioso** (sem chamadas MCP/API há 10 min) e no máximo 1×/dia, ou manual.
- [ ] Orçamento por execução: ex. 15 min ou 50 clusters; retoma de onde parou.
- [ ] Ollama: `keep_alive` curto (ex. `2m`) para descarregar o modelo depois; nunca roda se Ollama indisponível (regras determinísticas rodam mesmo assim).
- [ ] Modelo: `llama3.2:3b` é fraco para julgar. Tornar configurável e recomendar um 7–8B instruct (ex. `qwen2.5:7b-instruct`) quando houver RAM; manter 3B como fallback. Avaliar com um conjunto de pares rotulados (2.6).

### 2.5 Prevenção na escrita (o melhor "cleanup" é não duplicar)
- [ ] `addKnowledge`: antes de inserir, buscar vizinhos ≥ 0,88 no mesmo scope. Se houver, **não bloquear**, mas retornar `similarExisting: [{id,title,similarity}]` + `hint: "considere updateKnowledge(id) em vez de criar"`.
- [ ] Novo parâmetro `supersedes?: string[]` em `addKnowledge`/`updateKnowledge` → marca as antigas como `superseded` atomicamente.

### 2.6 Qualidade
- [ ] Conjunto de avaliação: ~60 pares rotulados à mão do banco real (duplicate/supersedes/complementary/distinct). Teste mede acurácia do juiz por modelo; meta ≥ 85% em `auto-safe` sem falso "duplicate".
- [ ] Testes e2e: merge aplica e desfaz; supersede; purge; política de autonomia; `keep` respeitado; job interrompido retoma.

## Fase 3 — Curadoria pelo agente (skills + MCP)

O agente que já está usando o CogniStore tem um modelo muito melhor que o local. Ele vira o "segundo nível" da curadoria.

- [ ] 3.1 Ferramentas MCP novas:
  - `getCurationQueue({ scope?, limit })` — clusters/propostas pendentes com conteúdo resumido.
  - `resolveCuration({ itemId, decision, mergedTitle?, mergedContent?, reason })` — aplica via o mesmo caminho validado da Fase 2 (`actor='agent:<platform>'`).
  - `supersedeKnowledge({ oldIds, newId, reason })`.
  - Permissões: `resolveCuration` entra na lista de ferramentas destrutivas em `~/.claude/settings.json` (como `deleteKnowledge`) — o usuário decide se permite.
- [ ] 3.2 Skill nova `cognistore-maintain` (templates `claude-code`, `copilot`, `opencode`): processa até 10 itens da fila no scope atual, regras claras de quando fazer merge vs supersede vs manter, nunca apagar `keep`/`system`, sempre registrar `reason`.
- [ ] 3.3 Atualizar `cognistore-capture`: "busque antes de adicionar; se existe, `updateKnowledge`; se substitui, use `supersedes`; nunca prefixe título com SUPERSEDED".
- [ ] 3.4 Atualizar `cognistore-query`: ignorar/descartar resultados `superseded`; reportar contradições encontradas via `resolveCuration` com `decision:'flag'`.
- [ ] 3.5 Hook `Stop`/`session-end`: se fila do scope atual > 5 itens e última manutenção do agente > 24 h, sugerir rodar `/cognistore-maintain` (no máx. 1×/dia).
- [ ] 3.6 Simetria setup/uninstall: nova pasta de skill copiada no setup e removida no uninstall (atualizar tabela do `CLAUDE.md` + testes de config).

## Fase 4 — UI e agendamento

- [ ] 4.1 Página "Curadoria" no dashboard (no sistema de design da Fase U) (substitui o banner do relatório): última execução, ações aplicadas com **Desfazer**, propostas pendentes (aprovar/rejeitar em lote), lixeira com restaurar.
- [ ] 4.2 Settings: autonomia, modelo, limiar de cluster, janela de retenção (lixeira, `token_usage`), horário/ociosidade.
- [ ] 4.3 Saúde do banco: tamanho por tabela, % telemetria, último VACUUM, lag do event loop (da Fase 0).
- [ ] 4.4 Migrar `cleanup_reports/candidates` existentes para `curation_actions` (status `proposed`) e remover o fluxo antigo.
- [ ] 4.5 i18n (pt/en) para tudo acima.

## Bugs encontrados durante a execução

- [x] B.1 **Hook de Stop do CogniStore dá falso negativo**: na Rodada 1 o agente gravou 5 entradas (`addKnowledge`) e concluiu as tarefas do plano, mas o hook final ainda disse "Session ending — no knowledge captured". O marcador de captura (`post-add-knowledge-marker.sh` / `stop-reminder.sh`, `_common.sh`) não está sendo reconhecido — provavelmente sessão/escopo do marcador ou chamada em lote. Reproduzir com teste de hook (T.5) e corrigir; ruído assim treina o agente a ignorar o lembrete. — **Rodada 3** (78c8067): o marcador nunca era registrado para `addKnowledge`; registrado e coberto pelo teste de hooks do T.5.
- [ ] B.2 Classificador do modo automático do Claude Code bloqueia o spawn de subagentes (`invariants-reviewer`) e `gh pr merge`. Não contornar. Nas rodadas: rodar os revisores como agente `general-purpose` com o corpo do arquivo do agente (como foi feito com o perf-reviewer); merges em `main` são sempre do mantenedor.
- [x] B.3 **Bancos criados pela v0.8.0 não abriam desde a 2.3.2** (`no such table: operations_log`): os runners a partir da 0.9.0 marcavam o schema base 0.8.0 como aplicado sem criar as tabelas que ele ganhou depois. Agora o schema base é reaplicado (`IF NOT EXISTS`) a cada abertura. — **Rodada 3** (ef422ee), coberto pelas fixtures 0.8.0 e 0.8.0-via-2.1.0 do T.3.
- [ ] B.4 O `secret-guard` local bloqueia commits que incluem `packages/tests/src/sidecar-helpers.ts` (falso positivo na constante placeholder `TEST_TOKEN`). Isso impede aumentar o tempo de espera do `stopSidecar` antes do SIGKILL, que hoje pode perder dumps de cobertura do sidecar. Precisa de uma entrada de allowlist na configuração do secret-guard (decisão do mantenedor). Não contornar.
- [ ] B.5 Teste de integração não hermético: na máquina de desenvolvimento, algum teste sobe o scanner de tokens do Claude Code contra o HOME real e lê os logs de `~/.claude/projects` (só leitura; o resultado vai para o banco de teste). Visto pela cobertura: `adapters/claude-code.ts` 149/152 linhas localmente contra 53/152 no CI. Achar o teste e dar a ele um HOME sandbox.

## Fase R — Release gate (v2.6.0)

- [ ] R.1 `pnpm verify` verde no CI (inclui `@perf` com orçamento — falha se regredir > 20%).
- [ ] R.2 Teste de upgrade real: cópia dos bancos das máquinas do usuário (42 MB e 70 MB) + fixtures T.3 → app novo → diagnóstico (`scripts/diagnose-db.mjs`) antes/depois.
- [ ] R.3 Auto-update Tauri 2.5.2 → 2.6.0 testado em Linux e macOS; MCP via `npx` na versão pinada.
- [ ] R.4 Bump de versão sincronizado (`pnpm bump 2.6.0` — package.json, Cargo.toml; `check-release-version.mjs`).
- [ ] R.5 Docs: `database.md`, `architecture.md`, `mcp-server.md`, `api-reference.md`, `frontend.md`, README (screenshots novos), `PATCH-NOTES.md`.
- [ ] R.6 Ligar `auto-safe` da curadoria por padrão só depois de 2 semanas em `suggest` no uso real sem falso positivo.

---

## Ordem sugerida e tamanho (tudo no marco v2.6.0)

Reordenado após a Rodada 1: o congelamento tem causa concreta e barata de atacar (1A.5 + duplicatas), então a performance rápida vem antes da rede completa de testes — ela não toca schema nem contrato MCP, e o harness `@perf` já existe para provar o ganho.

| Rodada | Fase | Depende de |
|---|---|---|
| 0 ✅ | Hotfix 2.5.3 | — |
| 1 ✅ | Setup + Fase 0 | — |
| 2 | **Perf rápida:** 1A (todos), 1C.2 interino + 1C.3, T.11 (job Rust), T.10 (perf só relatório), T.10b, L.7 parcial | 0 |
| 3 | Fase T (backend/compatibilidade: T.1–T.9, T.12, T.12b, T.13) | 2 |
| 4 | Fase L (L.1–L.6) | 3 |
| 5 | 1B (telemetria) + 1C.1/1C.4/1C.5 (JobRunner/worker) + 1D (FTS external) | 3 |
| 6 | L.8 dependências (lote seguro, depois majors) | 3 |
| 7 | U.0.2 + U.1 (spike shadcn/ui + sistema de design) | — |
| 8 | U.2–U.5 + T.8/T.9 (navegação, telas, testes de UI) | 6, 7 |
| 9 | 2 — motor de curadoria (`suggest`) | 5 |
| 10 | 3 + 4 — curadoria pelo agente + página de Curadoria | 9, 8 |
| 11 | R — betas `2.6.0-beta.N` → release 2.6.0 | tudo |

## Riscos

- **Merge errado apaga informação** → soft-delete + snapshot + undo + autonomia `suggest` no início + fallback determinístico sem perda.
- **Worker + sqlite-vec no bundle Tauri** → validar empacotamento cedo (spike na 1C.1).
- **VACUUM em banco grande demora** → só no upgrade, com barra de progresso, e pulável.
- **MCP server publicado no npm** roda versões antigas contra o mesmo banco → migrations aditivas; código antigo deve continuar funcionando com colunas novas (default `active`). Versões antigas não filtram `superseded` — aceitável durante a transição.
- **Modelo local fraco** → juiz só age sozinho acima de confiança alta; o resto vai para fila (agente/usuário).
- **Atualização de majors (vite 8, recharts 3, zod 4, better-sqlite3 13, TS 7)** quebra build/empacotamento → um PR por major, só com a suíte T verde; TS 7 pode ficar para 2.7.
- **Redesign grande demais para um PR** → sistema de design (U.1) primeiro, depois uma tela por PR, com regressão visual.
- **MCP novo migra banco de app antigo** → matriz T.4 obrigatória antes de publicar o pacote npm.

## Diário de execução

> Agentes: anote aqui data, fase/item, PR/commit, números medidos e qualquer desvio do plano.

- 2026-10-29 — **Rodada 3 — Fase T (backend/compatibilidade)** (relatório `reports/2026-10-29-rodada-3.md`). T.5 (d1329bc), T.6 (df0144b), T.3 (9d8b696), T.4 (6a98ed9), T.7 (b51bb56), T.2 (6bedc88), T.1 + T.13 (141ca7a), T.11 segunda metade (a808e18), T.12 + T.12b (a8d1327). `pnpm verify --coverage` verde: 500 passed/1 skipped, core unit 94,2%/77,0%. Bugs achados e corrigidos: bancos v0.8.0 não abriam (desde 2.3.2), import sem `source`, 400/404 na API, instruções compiladas desatualizadas, cache do turbo sem `dist-server`. Sem migration. Pendentes: grace do `stopSidecar` (bloqueado pelo secret-guard), baseline de cobertura regravado do 1º CI (teste não hermético B.5), `sidecar-bundle` na proteção do branch, PII no histórico do git.
- 2026-10-28 — **Rodada 2 APROVADA pelo gerente.** Reproduzido de forma independente em `release/2.6` (2b775cd): build, type-check (9 tarefas, com o pacote de testes), lint ok; 442 testes (441 + browser, 1 skipped); `test:perf` 14/14 numa máquina mais lenta: duplicatas 44,3 s → **7,4 s**, maior bloqueio do event loop no scan **28,7 ms** (< 100 ms), equivalência 139 = 139 grupos. Revisados: flush no `exit` do MCP, PRAGMAs, remoção de métodos internos do repositório (core não é publicado). osv-scan do PR #109: `zip` 9.0.0 (GHSA-m665-v7pm-7grj, crítico, usado pelo updater do Tauri) e `@hono/node-server` 2.0.12 (GHSA-rmxm-3fg6-px4f) — afetam o `main` → **hotfix 2.5.4** preparado pelo gerente (patch 0003: zip 9.1.3 + libc 0.2.191, override hono >=2.1.3; cargo check, cargo audit, build e 406 testes ok). Depois do merge da 2.5.4, mergear `main` em `release/2.6`. Pendente do relatório: commit da limpeza local (`getEmbeddingById`, `architecture.md`) — aprovado.
- 2026-10-28 — **Rodada 2 — Perf rápida** (relatório `reports/2026-10-28-rodada-2.md`). L.7 parcial (ac61193), 1A.5 (ea1dd1e), 1C.2 interino + 1C.3 (0307679), 1A.1–1A.4/1A.6/1A.7 (a4e2cf2), T.11 parte 1 + T.10 + T.10b (75cd720). Base de 10k: duplicatas 40.867 → 3.720 ms, event loop máx. 15,2 ms durante o scan, incremental 62 ms; agregados 180d 1.710 → 972 ms; stats 21,1 → 3,9 ms. Suíte 441 passed/1 skipped; `test:perf` 14/14. Sem migration; dívida do índice em `updated_at` → Rodada 5 (com as migrations do 1B). Invariants-reviewer feito manualmente (spawn negado pelo classificador).
- 2026-10-28 — **Rodada 1 APROVADA pelo gerente.** Reproduzido de forma independente no `release/2.6` (bcf4d38): build/type-check/lint ok, 416 passed/1 skipped, `test:perf` 10/10 (duplicatas 44,3 s, agregados 180d 2,3 s). Instrumentação revisada (wrapper de prepare/exec/transaction, sem valores de parâmetros, idempotente). Achado do gerente: Settings dispara o scan de duplicatas ao montar → 1A.5 priorizado; ordem das rodadas revista (Perf rápida antes da Fase T). Publish da 2.5.3 confirmado: npm 2.5.3 e GitHub Release v2.5.3 "Latest" com binários macOS/Linux (primeiro build Rust do tauri 2.12 passou). Respostas: 0.1/0.5 no PC de 70 MB não bloqueiam (dependem do mantenedor); perf no CI só relatório até a Fase R; pode apagar sobras do Stryker; job Rust entra na Rodada 2. Bugs B.1/B.2 registrados.
- 2026-10-28 — **Rodada Setup + Fase 0** (relatório `reports/2026-10-28-fase-0.md`). Setup 31a4756; 0.2 mergeado em ea05075; 0.3–0.5 em 99ac761 (`release/2.6`). 0.1 em uma máquina de desenvolvimento: 41,09 MB + WAL 4,31 MB, telemetria 54,7% (token_usage 12,63 MB = 30,8%), 1.497 entradas, 62.942 token_usage, 19.737 operations_log, 1.765 scan_state; listAll c/ conteúdo 13 ms, agregado diário de tokens 19 ms. Baseline @perf (fixture 10k/200k/50k, desktop x86_64 de 8 núcleos, Node 24, `pnpm test:perf`): busca 11,9 ms; listRecent 0,3 / 6,3 ms (offset 5000); stats 21 ms; agregados de tokens 30d 278 ms / **180d 1.710 ms**; **duplicatas 40,9 s** (abaixo do ponto de parada de 120 s → 10k mantido); scan de tokens completo 1.084 ms / incremental 31 ms. Contenção (3 processos × 15 s + sidecar): ~2.300 buscas, p99 ≤ 46 ms, **0 SQLITE_BUSY, 0 escritas lentas** — não reproduz nesta máquina. Desvio: `@perf` saiu do `pnpm test` padrão (só `test:perf`, 1 worker) por recomendação do perf-reviewer.
- 2026-10-28 — Plano criado a partir de análise do código (v2.5.2) e do banco de uma máquina de desenvolvimento (42 MB, 1.476 entradas).
- 2026-10-28 — PR #107 mergeado (8f36bf3). Publish falhou em publish-mcp (NPM_TOKEN expirado, E404) — 2.5.3 não publicada. Correção: npm Trusted Publishing (OIDC), PR #108 (e1e9516) revisado pelo gerente: `id-token: write` no job, sem NODE_AUTH_TOKEN, guarda npm ≥ 11.5.1. Trusted Publisher precisa de 1 publish até 2026-10-30 18:20 UTC.
- 2026-10-28 — Pedido do mantenedor: revisão completa da navegação na refatoração de UI → U.2 reescrita (nova arquitetura de informação, rotas para tudo, ⌘K, atalhos, seletor de scope, redirects de compatibilidade).
- 2026-10-28 — Rodada 0 APROVADA pelo gerente: árvore de 82e9f14 idêntica aos patches validados; CI 6/6 verde; Rust verificado pelo gerente (`cargo check --locked`, rustc 1.97, Linux) — macOS só no publish. Aguardando merge.
- 2026-10-28 — Rodada 0: PR #107 aberto (commit af03f8b, árvore idêntica ao patch validado). osv-scan do PR ainda falha — aguardando log para identificar o advisory restante.
- 2026-10-28 — CI: scan OSV semanal falhando desde 09-07 (advisories em fastify, MCP SDK, zod, proxy-addr, shell-quote, rustls, tokio, zip…). Hotfix 2.5.3 preparado e validado pelo gerente (Rodada 0).
- 2026-10-28 — Biblioteca de UI escolhida: shadcn/ui + Tremor (U.0.1).
- 2026-10-28 — Decisões: tudo no marco 2.6.0 (curadoria com padrão `suggest`); pode adotar biblioteca de UI — opções listadas em U.0.
- 2026-10-28 — Ampliado para a v2.6: contrato de compatibilidade, Fase T (testes), Fase L (limpeza, `knip` + `pnpm outdated` no `main` 9442afc), Fase U (nova UI, pesquisa de tendências) e Fase R (release gate). Fase 5 antiga absorvida pela R.
