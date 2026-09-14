# Production runtime

Este documento descreve a fundação operacional do AI Office Suite. O runtime local está validado; a
paridade PostgreSQL permanece bloqueada até existir um banco efêmero de teste. Por isso, a situação
final desta slice é **INFRASTRUCTURE PARTIAL**, não `READY`.

## Startup e workers

1. Carregue o store operacional e o `DurableRuntimeStore` separado.
2. Execute `RecoveryService` antes de aceitar novas missões.
3. Registre backends e seus perfis no `ProductionBackendRouter`.
4. Registre `MissionWorker`, `ToolWorker`, `OutboxWorker`, `RecoveryWorker` e `HealthWorker` no
   `WorkerSupervisor`.
5. Inicie o supervisor. Heartbeats persistem estado, trabalho atual, falhas e restart count.

O supervisor respeita o kill switch, usa restart limitado com backoff/jitter e marca crash loops como
degradados. No shutdown, para a admissão, propaga `AbortSignal`, espera um grace period limitado e
persiste `STOPPED`. Leases expiradas são recuperadas no próximo startup; fencing impede owners antigos.

## Fluxo do produto

`HierarchicalMissionCoordinator` força a ordem Leader → Manager → Workers → final review. O Leader
define o contrato e decisões globais; o Manager valida/delega o DAG e consolida evidências; workers
executam tarefas estreitas. O router considera papel, capacidade, health, contexto, custo, histórico,
latência e risco. Trabalho premium é reservado para planejamento, escalation e revisão final.

Modelos apenas solicitam ferramentas. `ToolExecutionWorker` faz claim durável, valida policy/approval,
executa pelo gateway, salva artefato/evidência e só então acorda a task. Gates determinísticos, nunca
self-report, estabelecem fatos. O retorno compacto é `MissionResultEnvelope`: critérios, mudanças,
refs de artifacts/evidence, testes, custo/tokens, retries/fallbacks/escalations e review.

## Cancelamento, recovery e efeitos

`CancellationService` persiste tokens versionados por missão, task ou agent run e oferece polling por
uma interface substituível por LISTEN/NOTIFY ou broker. Provider HTTP e processos recebem
`AbortSignal`. Completion revalida missão, task, lease e cancellation version. Cancelar também invalida
approvals pendentes e libera reservas.

Dead letters preservam histórico. O operador pode inspecionar, tentar novamente, cancelar ou resolver;
cada transição produz audit e `recoveryHistory`. `SideEffectStrategy` classifica operações como
`REPLAY_SAFE`, `IDEMPOTENCY_KEY`, `EFFECT_PROBE` ou `NON_RETRYABLE_AFTER_UNKNOWN`. Resultado externo
incerto nunca deve ser repetido cegamente.

## Backends, budgets e limites

Health é persistido sem secrets e considera configuração, credencial disponível, falhas/sucessos,
latência, 429 e circuit `CLOSED/OPEN/HALF_OPEN`. Scheduler/registry não despacham normalmente para
backend indisponível, bloqueado, desabilitado ou rate-limited. Fallback técnico, downgrade econômico,
escalation de raciocínio e humana são métricas diferentes e correlacionadas.

Budget é reservado antes da chamada e reconciliado com uso real ou liberado quando não invocado.
Rate limits RPM/TPM e Retry-After são duráveis. A UI pode consumir `RuntimeOperationsService` para
missões, tasks, workers, backends, approvals, dead letters, recoveries, custo e tokens. Não se calcula
"economia" sem baseline comparável.

## Observabilidade e segurança

`DurableTraceService` persiste `traceId/spanId/parentSpanId` e possui `TraceExporter`, ponto de extensão
para OpenTelemetry, Jaeger, Grafana ou Datadog. Eventos podem correlacionar missão, task, agent,
provider, model e tool call. `RuntimeOperationsService` é a query operacional e a fonte de presença
derivada; animação não é evidência.

As fronteiras são default-deny. Paths passam por canonicalização e bloqueio de symlink escape; shell
usa argv e command guard; secrets são redigidos/DPAPI; approval é ligado ao input hash; fencing e
idempotência rejeitam replay; `NetworkGuard` valida protocolo, porta, DNS, IPs privados e cada redirect;
`assertMissionScope` falha fechado em acesso cruzado.

## Desenvolvimento local e Windows

Requisitos: Node.js 22+, npm e Git. Em PowerShell:

```text
npm install
npm run dev
npm run test
npm run desktop
```

O runtime fica em `AI_OFFICE_RUNTIME_FILE` ou ao lado de `data/ai-office.json`. Não coloque secrets no
JSON; use o SecretStore/DPAPI. No Windows, scripts npm de gates são iniciados pelo Node e `npm-cli.js`,
sem interpolação de shell.

## PostgreSQL/Supabase de teste

Nunca use produção. Prepare Supabase local, container efêmero ou PostgreSQL descartável; aplique todas
as migrations em ordem e configure somente credenciais de teste. Execute contract tests de fresh
migration, RPC claim/complete/reserve/release/reclaim e corridas com conexões independentes. Nesta
máquina, `docker`, `supabase` e `psql` não estão instalados, portanto esses testes estão `BLOCKED`.

## Quality gates

Execute `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run build`,
`git diff --check` e `npm audit`. O teste de carga cobre 10 missões × 5 tasks. O smoke de backend externo
é opcional e só deve rodar quando um backend de teste e credenciais estiverem explicitamente
configurados.

## Backlog pós-infraestrutura

- executar e automatizar contracts/concurrency reais do PostgreSQL;
- conectar o exporter OpenTelemetry e completar spans de command/provider/evidence;
- ligar presença expandida e breakdown de tokens/custos às telas existentes;
- smoke test de Codex/CLI real quando configurado;
- avaliar lazy loading do Phaser sem arriscar o runtime.

## Desktop local-first: PRX/LocalAnt/FreeClaude

Esta integração não depende de Supabase/PostgreSQL. O desktop usa seu arquivo de
dados em userData, SecretStore e runtime durável. Configure workspace e provedor nos
formulários; somente o operador define o workspace, nunca uma resposta de modelo.
Pedidos LocalAnt do gerente exigem aprovação no painel existente, vinculada ao
snapshot durável. Não foi iniciada uma segunda instância de executor ou proxy Python.

A versão candidata é 1.4.0 (anterior 1.3.1). O empacotamento existente continua sendo
electron-builder/NSIS, com appId e armazenamento preservados. A emissão do instalador
final depende dos critérios de aceite; não confundir build web com instalador validado.
O endpoint PRX 9223 estava indisponível. Smoke real de PRX/OpenRouter é opt-in e não
recebe status PASS quando não executado.
