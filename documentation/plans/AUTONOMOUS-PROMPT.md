# Prompt — gerente + executor autônomo (Claude Code)

Cole o bloco abaixo numa sessão do Claude Code aberta na raiz do repositório `cognistore`.

```
Você agora é GERENTE e EXECUTOR do plano v2.6 do CogniStore e vai levá-lo até o fim sozinho, rodada por rodada, parando só nos portões humanos.

## Preparação (uma vez)
1. git fetch origin && git switch release/2.6 && git pull --ff-only
2. cp -r documentation/agent-kit/skills/cognistore-manager .claude/skills/  (e confira que .claude/skills/cognistore-dev, cognistore-phase e .claude/agents/* estão atualizados com documentation/agent-kit/)
3. Commite: "chore(plan): autonomous manager skill" e faça push.
4. Leia, nesta ordem: CLAUDE.md; documentation/plans/2026-11-performance-e-curadoria.md inteiro (seção 1.2, fases, "Bugs encontrados", "Ordem sugerida", "Diário de execução"); documentation/plans/AGENT-PROMPT.md; o relatório mais recente em documentation/plans/reports/; as skills cognistore-manager, cognistore-phase e cognistore-dev.

## Como trabalhar
Siga a skill cognistore-manager. Em cada rodada:
1. Retome pelo diário (a próxima rodada é a primeira sem "Rodada N APROVADA").
2. Planeje o escopo (itens da tabela + B.n abertos que bloqueiam ou são baratos) e escreva-o no topo do relatório.
3. Execute como executor (branches plan/*, testes, revisores, PATCH-NOTES, varredura de PII, merge --no-ff em release/2.6 só com `pnpm verify --coverage` verde).
4. Valide como gerente num CLONE LIMPO (verify completo, matrizes de compatibilidade, @perf vs baseline, --repeat-each=20 nos testes novos/alterados, advisories, auditoria das migrations e do relatório, CI do PR #109). Registre o resultado de cada checagem na seção "Validação do gerente" do relatório.
5. Se algo falhar na validação, volte ao papel de executor, corrija e valide de novo. Não feche a rodada com vermelho.
6. Feche a rodada: diário "Rodada N APROVADA pelo gerente", checkboxes, commit "docs(plan): manager review of round N", push. Siga para a próxima sem esperar.

Rodadas que faltam (detalhes no plano): 7 (B.12, B.13, U.0.2 spike shadcn/ui no Tauri, U.1 sistema de design), 8 (U.2 navegação nova + U.3–U.5 telas + T.8/T.9 testes de UI), 9 (Fase 2 curadoria com autonomia padrão `suggest`), 10 (Fase 3 curadoria pelo agente + Fase 4 página de Curadoria), 11 (Fase R: betas e release 2.6.0).

## Decisões já tomadas (não reabra)
shadcn/ui + Tremor (gráficos), lucide, sonner, cmdk; dark como padrão com tema claro e "seguir o sistema"; navegação conforme U.2; 1D fora da 2.6; retenção do token_usage cru 90 dias com campo na U.4; recharts e react-day-picker atualizados junto com a Fase U; TypeScript 7 depois do release; curadoria sai com `suggest`; squash merge do #109 na Fase R.

## Portões humanos — PARE e peça ao Raphael (nunca contorne)
1. Merge em main, bump, tag, publish npm, release Tauri. Prepare tudo e passe o comando exato (ex.: `! gh pr merge <n> --merge`).
2. Override de hook de segurança (CLAUDE_ALLOW_SECRET, --no-verify) ou permissão negada.
3. Qualquer coisa destrutiva em dados reais ou no HOME real.
4. Decisão de produto com mudança visível que o plano não define.
5. Direção visual: ao fim da Rodada 7, screenshots em documentation/plans/reports/assets/rodada-7/ (claro e escuro, /_design, lista + painel + ⌘K) e ESPERE aprovação antes da Rodada 8.
6. Fase R: betas instalados pelo Raphael (inclui checagem no macOS) antes do release final; o squash merge do #109 é dele.
7. Advisory de segurança que afeta o main: prepare o hotfix (branch a partir de origin/main, PR com checks verdes) e PARE para o merge.

Ao parar: uma mensagem curta com o que está pronto, a decisão necessária (com sua recomendação) e o comando ou resposta exata que te destrava. Depois aguarde. Quando ele responder, retome pelo diário.

## Regras permanentes
Contrato 1.2; sem bump/tag/publish/merge em main sem o Raphael; testes herméticos (HOME sandbox); nada de reduzir limiar para passar; uma major de dependência por branch; registre achados fora do escopo como B.n; se algo falhar duas vezes pelo mesmo motivo, registre, siga para o próximo item seguro e cite no relatório. O plano no repositório é a sua memória: mantenha o diário atualizado a cada rodada para poder retomar após qualquer reinício de contexto.

Comece agora pela Preparação e depois pela Rodada 7.
```
