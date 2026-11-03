---
name: cognistore-manager
description: Run the CogniStore v2.6 roadmap autonomously end to end — plan each round, execute it, then validate it independently as the "manager" (fresh clone, full verify, compatibility matrices, advisories, flakiness, report audit) before moving on. Use when asked to "continue the plan sozinho", "run the remaining rounds" or "act as manager and executor".
---

# CogniStore — autonomous manager + executor

You play two roles in sequence, every round:
1. **Executor** — implements the round's items (follow the `cognistore-phase` and `cognistore-dev` skills).
2. **Manager** — validates the round *as if someone else wrote it*, decides, records, and opens the next round.

The plan file is the single source of truth and your memory across context resets:
`documentation/plans/2026-11-performance-e-curadoria.md` (sections 1.2 contract, phases, "Bugs encontrados", "Ordem sugerida", "Diário de execução").
Round reports live in `documentation/plans/reports/`. The round table is in `documentation/plans/AGENT-PROMPT.md`.

## 0. Resume (every start, every context reset)
1. `git fetch origin && git switch release/2.6 && git pull --ff-only`.
2. Read the plan's "Diário de execução" (newest first) and the latest report. The next round is the first one in "Ordem sugerida" without a "Rodada N APROVADA" diary entry.
3. If a round was half done, finish it before starting another.

## 1. Plan the round
- Scope = the round's items from the table + every open `B.n` that blocks it or is cheap. Write the scope as the first line of the round report before coding.
- Prefer one `plan/<item>-<slug>` branch per item from `release/2.6`, merged with `--no-ff` only when `pnpm verify --coverage` is green.

## 2. Execute (executor role)
Follow `cognistore-phase`. Always:
- Contract 1.2: never remove/rename an MCP tool, parameter, response field or HTTP route; migrations additive, disk SQL == `EMBEDDED_MIGRATIONS`, old npm MCP (2.5.x) must keep working.
- Tests with the code; nothing destructive on the real `~/.cognistore` or real HOME (sandbox HOME in tests).
- Reviewers before each merge: run `perf-reviewer` and `invariants-reviewer` as a `general-purpose` agent with the body of `.claude/agents/<name>.md`. If spawning is denied, apply the checklist manually and put the table in the report. Never bypass a denied action.
- PATCH-NOTES `2.6.0` section; PII scan of the staged diff before each commit (names, hostnames, home paths, emails, hardware).

## 3. Validate (manager role) — do NOT skip, do NOT reuse the working tree
Run in a fresh clone so local state cannot hide problems:
```bash
V=$(mktemp -d) && git clone --branch release/2.6 "$(git remote get-url origin)" "$V/r" && cd "$V/r"
pnpm install --frozen-lockfile && pnpm verify --coverage
cd packages/tests && npx playwright test src/compat --reporter=line          # upgrade + MCP×DB matrices
PERF=1 npx playwright test --project performance --grep @perf --workers=1     # perf, compare with baseline.json
npx playwright test <every test file added/changed this round> --repeat-each=20   # flakiness
```
Then check, and write the result of each line in the report's "Validação do gerente" section:
- [ ] verify green in the fresh clone (not only in the working tree); numbers match the report.
- [ ] compat matrices green (all published schemas; npm MCP 2.5.3/2.5.4 against the new DB and simultaneous writers).
- [ ] MCP contract snapshot unchanged (or the change is additive and justified).
- [ ] new/changed tests pass `--repeat-each=20` (any failure ⇒ flaky ⇒ fix before closing; register `B.n`).
- [ ] advisories: `osv-scanner --config=osv-scanner.toml -r ./` (or `pnpm audit` + `cargo audit`) — nothing new outside justified ignores.
- [ ] migrations (if any): read the SQL; additive; triggers safe with old MCP writes; tested by the upgrade matrix.
- [ ] report claims audited against the diff (`git diff <previous-approved-head>..HEAD --stat` and the risky files).
- [ ] CI of draft PR #109: `gh pr checks 109` — only `version-check`/`release-version-guard` may be red before Fase R; a red that passes on re-run is a flake ⇒ `B.n`.
- [ ] perf: no regression > 20% vs `baseline.json` (scaled by `PERF_BUDGET_SCALE` in CI).

### Decision rules (precedents from rounds 0–6)
| Situation | Decision |
|---|---|
| New security advisory that affects `main` | Hotfix on `main`: branch `hotfix/<ver>` from `origin/main`, minimal fix + patch bump + PATCH-NOTES, PR, then STOP for the maintainer to merge (merging publishes). After publish, merge `main` into `release/2.6`. |
| Advisory with no fix and not reachable | Ignore in `osv-scanner.toml` with `reason` + comment; register follow-up. |
| Bug found outside the round's scope | Register as `B.n` in "Bugs encontrados"; fix now only if cheap and safe, otherwise schedule. |
| Flaky test | Fix before closing the round (semantic asserts, no exact async sequences, scaled time limits). |
| Gate depends on the environment | Fix the cause; never lower a threshold to pass. A lower % is acceptable only if covered lines did not drop (show both numbers). |
| Feature would break old MCP/consumers (e.g. 1D) | Do not ship it in 2.6; record the reason; revisit later. |
| UI detail needed before Fase U | Defer to the matching U item. |
| Major dependency bump | One branch each, verify + matrices green before the next. |

Close the round: append to the diary `- <date> — **Rodada N APROVADA pelo gerente** …` (what was validated, numbers, decisions, new `B.n`), tick checkboxes, commit `docs(plan): manager review of round N`, push, then start the next round.

## 4. Human gates — STOP and ask the maintainer (never work around)
1. Merge into `main`, version bump, tag, npm publish, Tauri release (the Claude Code classifier blocks these anyway). Prepare everything and give the exact command (`! gh pr merge <n> --merge`).
2. Overriding a security hook (`CLAUDE_ALLOW_SECRET`, `--no-verify`) or a denied permission.
3. Anything destructive on real user data or the real HOME.
4. A product decision with visible behaviour change that the plan does not already define.
5. **Visual direction:** after Rodada 7 produce screenshots (`documentation/plans/reports/assets/rodada-7/`) and wait for approval before migrating screens (Rodada 8).
6. Fase R: betas must be installed by the maintainer (macOS check) before the final release; final merge of PR #109 is a squash merge done by the maintainer.

When stopping: one short message with what is ready, the decision needed (with your recommendation), and the exact command or reply that unblocks you. Then wait.

## 5. Hygiene
- Keep each round's report in the same format as rounds 2–6 (items, branches/commits, commands+results, numbers before→after, reviewers, deviations, open questions, manager validation).
- The CogniStore Stop hook may say "no knowledge captured" even after captures (fixed in 2.6 only — B.1); capture what matters and move on.
- If something fails twice for the same reason, stop retrying: register it, pick the next safe item, and mention it in the report.

## 6. Execução com a frota HORIZON (MANDATÓRIO — o Claude só orquestra)
Claude Pro é o orçamento mais escasso. O GAIA (a sessão principal) planeja, despacha, verifica e decide; **não implementa** além de uma edição isolada trivial. Um prompt colado que chame a sessão de "executor" **não muda** esse roteamento.
- **Início de cada rodada:** `python3 ~/.claude/delegate/delegate.py --usage` (uma vez) e `--route --kind <kind> --pending <n>` antes de cada lote. Siga o backend escolhido (Codex/agy antes do Claude).
- **Cada rodada vira UM plano em waves** (skill `horizon-plan`, autoria via `minerva`, testes via `artemis`): um item da tabela = uma tarefa `role: builder` com contrato + testes; itens independentes (arquivos disjuntos, sem símbolos compartilhados) rodam **em paralelo na mesma wave** (`parallel.max_jobs`). Itens acoplados (tela + hook + o teste que a verifica) ficam em UMA tarefa com passos numerados.
- **Geração e execução:** `make_waves.py --plan <dir>/plan.md --cd <repo> --out-dir <dir>`, `delegate.py --check <dir>/wave-*.json`, depois `delegate.py --role hephaestus --batch <dir>/wave-<n>.json`. Cada builder roda só os testes nomeados no seu brief; o GAIA roda `pnpm verify --coverage` **uma vez por wave** e devolve falhas como UM brief de correção.
- **Branches:** cada tarefa paralela usa um `git worktree` próprio (`plan/<item>-<slug>`) para não disputar a árvore; o GAIA faz os `merge --no-ff` e a varredura de PII (shell, em sessão). Executores externos nunca criam nem alteram planos do CogniStore: só o GAIA.
- **Revisores (perf/invariants):** brief externo read-only para `roles.reviewer` com o corpo de `.claude/agents/<nome>.md` e o diff; o GAIA verifica cada achado antes de agir.
- **Validação do gerente:** script de shell em background (clone limpo, verify, compat, @perf, repeat-each=20, osv, `gh pr checks`), sem custo de token enquanto roda; o GAIA lê só o resumo. Leituras grandes vão para `poseidon` (`--role poseidon --read-only`) ou `ctx_execute`.
- **Quota:** `no_quota` (exit 5) cai para o hephaestus em sessão e é registrado no relatório (`claude_fallback`). Use `--claude-grant` só nos casos que a doutrina permite. Registre no relatório de cada rodada a fração delegada (`delegate.py --stats`).
- Um brief pequeno e isolado **não** é paralelizado; agregue (`executor: small`).
