# Pós-release 2.6.0 — correções e ajustes (plano vivo)

Plano vivo: cada problema que o mantenedor apontar entra aqui, agrupado por área, já com a solução proposta. Nada é aplicado sem o item estar aqui com solução e critério de aceite. Os itens saem de `Aberto` para `Feito` com o commit.

Base: `main` em `c8a1edd` (release 2.6.0 publicada). Regras de sempre: contrato 1.2 (aditivo), sem bump/tag/publish sem o mantenedor, testes herméticos, um PR por grupo.

## Como ler a tabela

Status: `Aberto` (relatado, sem causa confirmada), `Causa confirmada`, `Solução proposta`, `Feito`.

## Grupo A — Instalação local e upgrade (Linux)

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| A.1 | App 2.5.3 instalado abre a janela com "Error receiving data: Connection reset by peer" | `/usr/bin/cognistore-dashboard` é a 2.5.3 (deb de 28/10). O `cognistore.log` mostra o sidecar iniciando e "SDK initialized" às 09:05, e o `systemd-coredump` registra `SIGABRT` do `node dist-server/index.js` às 09:05:41, 4 s depois. O banco real passou de 2.4.1 para 2.4.6 entre a minha cópia (R.2) e agora | Hipótese: o MCP `@cognistore/mcp-server@latest` (2.6.0, via `npx` nas sessões do Claude) migrou o banco compartilhado antes de o app ser atualizado, e o sidecar 2.5.3 aborta contra o esquema novo. **Não reproduzido**: o sidecar instalado rodou 25 s sem falhar numa cópia do banco já migrado (sem HOME real, sem token, sem cliente conectado) | 1) Reproduzir com HOME real somente leitura, token e requisições (/api/stats, /api/knowledge/recent) numa cópia; 2) se confirmar, decidir entre: (a) o MCP novo não migrar sozinho quando o app instalado for mais antigo, (b) o sidecar antigo tolerar a coluna nova (só vale para o futuro: a 2.5.3 já está instalada), (c) instrução de atualizar o app antes do MCP. Contrato 1.2 pede que código antigo continue funcionando com colunas novas | Aberto |
| A.2 | Ordem de upgrade: o pacote npm do MCP atualiza sozinho (`@latest`) antes do app desktop | O `npx @cognistore/mcp-server@latest` está em uso nas sessões do Claude e migrou o banco | Já listado como risco no plano 2.6 ("MCP novo migra banco de app antigo") e coberto pela matriz T.4, que testou o MCP novo contra bancos antigos mas não o **app antigo** contra o banco migrado pelo MCP novo | Adicionar à matriz: app/sidecar da versão N-1 contra banco migrado pela versão N (smoke: abre, /api/health, /api/stats, listagem) | Solução proposta |

## Grupo B — Interface (Configurações e Estatísticas), visto no macOS

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| B.1 | Parte de Configurações "ficou muito ruim" no macOS | Relato do mantenedor, sem captura ainda | A confirmar com capturas (claro/escuro, larguras 1280 e 900) | Pedir captura do Mac da seção ruim e revisar `SettingsPage.tsx` (1241 linhas, várias seções em uma tela) contra o design system U.1; separar seções por rota e usar os componentes shadcn já existentes | Aberto |
| B.2 | A parte de Estatísticas "precisa mudar também" | Relato do mantenedor, sem detalhe do que mudar | Pendente: qual tela (Insights `/insights/*` ou o bloco de estatísticas dentro de Configurações/Sistema) e o que está ruim | Perguntar ao mantenedor o que quer ver; depois propor o desenho | Aberto |

## Grupo C — Navegação e links quebrados

| ID | Sintoma | Evidência | Causa | Solução proposta | Status |
|---|---|---|---|---|---|
| C.1 | O link "← Back to plans" no detalhe de um plano não volta para a lista | `PlansPage.tsx:869` chama `route.backToList()`, que faz `navigate({ pathname: '/plans', search: location.search })` (`plans/usePlansRoute.ts:24`). O `search` atual carrega `?select=<id>`, que o `PlanDetailRedirect` (`App.tsx:38-51`) acrescenta ao abrir o detalhe. Em `/plans?select=<id>` o redirect devolve o usuário para `/plans/<id>` | Causa confirmada **pela leitura do código**; ainda não reproduzida no navegador | `backToList` remove o parâmetro `select` do `search` antes de navegar (mantém `status`, `scope`, `sort`, `page`). Teste de UI: abrir um plano, clicar em "Back to plans" e esperar a URL `/plans` sem `select` e a lista visível. Os usos de `backToList` após excluir/arquivar (`PlansPage.tsx:1132`, `:1159`) herdam a correção | Causa confirmada |
| C.2 | "Alguns links não funcionam" (o mantenedor citou este como exemplo) | Só o C.1 foi investigado | Pendente: a lista dos outros links com problema | Percorrer todos os links e botões de navegação das telas (Home, Planos, Curadoria, Insights, Configurações, Integrações) com um teste de UI que clique em cada um e confira o destino; pedir ao mantenedor os outros casos que ele viu. Já li, sem testar, o `useKnowledgeRoute` (volta com `navigate(-1)` quando há `knowledgeReturn`) e os `navigate('/?edit=...')` e `navigate('/?tag=...')`, que passam por redirects: são os próximos suspeitos do mesmo padrão | Aberto |

## Pendências para fechar o diagnóstico

- A.1: terminar a reprodução (passo 1) antes de propor correção de código.
- C.2: lista dos outros links quebrados que o mantenedor viu.
- B.1/B.2: capturas de tela do Mac (ou o mantenedor descrever o que incomoda) para eu desenhar a correção. As capturas feitas aqui no Linux ainda não foram geradas.

## Registro

- 2026-11-05 — C.1 (link "Back to plans") relatado pelo mantenedor; causa localizada no código (`backToList` mantém `?select=`). Grupo C criado.
- 2026-11-05 — Plano criado a partir de três relatos do mantenedor no mesmo dia (janela com erro no Linux, Configurações e Estatísticas ruins no Mac).
