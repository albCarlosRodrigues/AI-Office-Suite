# Ledger de requisitos

| ID                                     | Estado  | Evidência                                                                                   |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| REQ-001 tool claims exigem runtime     | PASS    | provider contract test + ToolExecutionGateway                                               |
| REQ-002 claim retorna MissionLease     | PASS    | migration + mission lease test                                                              |
| REQ-003 max steps atômico              | PASS    | claim SQL/local incrementa e limita antes do trabalho                                       |
| REQ-004 review inválido não aprova     | PASS    | schema Zod + provider contract test                                                         |
| REQ-005 retry preserva contrato        | PASS    | engine + contracts test                                                                     |
| REQ-006 DAG válido                     | PASS    | DAG validator tests                                                                         |
| REQ-007 deadlock explícito             | PASS    | detector integrado ao engine                                                                |
| REQ-008 timeout/retry HTTP             | PASS    | transporte + testes 401/429/5xx policy                                                      |
| REQ-009 tool gateway seguro            | PARTIAL | gateway/guards; handlers reais pendentes                                                    |
| REQ-010 secret vault nativo            | TODO    | integração de plataforma pendente                                                           |
| REQ-011 model router e budgets         | PARTIAL | serviços/testes; scheduler ainda não conectado                                              |
| REQ-012 parallel DAG scheduler         | TODO    | DAG pronto; execução permanece serial                                                       |
| REQ-013 observabilidade completa       | PARTIAL | IDs existentes; métricas ampliadas pendentes                                                |
| REQ-S2-001 SecretStore Windows DPAPI   | PASS    | DPAPI real round-trip + vault tests                                                         |
| REQ-S2-002 migração de secrets legados | PASS    | migração idempotente, recoverable e fail-closed testada                                     |
| REQ-S2-003 handlers reais              | PASS    | filesystem, repository, shell, git e quality gates                                          |
| REQ-S2-004 scheduler central           | PASS    | scheduler integrado ao worker + testes                                                      |
| REQ-S2-005 backpressure/rate limit     | PASS    | semáforos globais/chaveados + token buckets RPM/TPM                                         |
| REQ-S2-006 DAG paralelo                | PASS    | ready resolver, concorrência e ordering testados                                            |
| REQ-S2-007 backend registry            | PASS    | health, primary/fallback e denial sem fallback                                              |
| REQ-S2-008 backend real                | PASS    | LocalToolExecutionBackend                                                                   |
| REQ-S2-009 E2E com evidência real      | PASS    | filesystem + shell em workspace temporário real                                             |
| REQ-S2-010 cobertura                   | PASS    | 51.21% statements, 33.96% branches, 50.17% functions, 52.64% lines; baseline CI 50/30/50/50 |

## Reavaliação sem apagar o histórico da slice 1

Os estados originais de REQ-009 a REQ-013 acima registram o encerramento da primeira slice. Na
segunda slice, REQ-S2-003, REQ-S2-001, REQ-S2-004/005/006 e a persistência de métricas completam,
respectivamente, aqueles itens antes parciais ou pendentes.

## Terceira vertical slice

| ID                                        | Estado  | Evidência                                                                           |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| REQ-S3-001 Durable ToolRequest queue      | PASS    | durable-services + restart E2E                                                      |
| REQ-S3-002 ToolWorker                     | PASS    | tool real executada por worker autônomo limitado                                    |
| REQ-S3-003 Tool lease/fencing             | PASS    | claim/heartbeat/stale token/reclaim concorrente                                     |
| REQ-S3-004 Idempotency store              | PASS    | lifecycle persistente + crash-after-effect E2E                                      |
| REQ-S3-005 Resumable approvals            | PASS    | snapshot exato + restart approval E2E                                               |
| REQ-S3-006 Startup recovery               | PASS    | recovery matrix e crash-point tests                                                 |
| REQ-S3-007 Durable budget reservations    | PASS    | concorrência, expiração e reconcile único                                           |
| REQ-S3-008 Automatic cheaper-tier routing | PASS    | downgrade E2E; tier caro recebe zero calls                                          |
| REQ-S3-009 Durable rate limiting          | PASS    | RPM/TPM e Retry-After entre instâncias                                              |
| REQ-S3-010 Automatic task resume          | PASS    | worker wake + gates + mission completion E2E                                        |
| REQ-S3-011 Transactional outbox           | PASS    | eventos gravados nas transições críticas                                            |
| REQ-S3-012 Event deduplication            | PASS    | processed `(consumer,eventId)` testado                                              |
| REQ-S3-013 Durable cancellation           | PARTIAL | cancelamento/fencing persistem; sinalização distribuída de providers ainda pendente |
| REQ-S3-014 Runtime health                 | PARTIAL | queue/leases/approvals/stuck/rate/kill switch; backend/circuit detail pendente      |
| REQ-S3-015 Dead-letter handling           | PASS    | retry bounded + exponential backoff/jitter                                          |
| REQ-S3-016 Restart E2E                    | PASS    | nova instância executa filesystem_write e conclui missão                            |
| REQ-S3-017 Approval restart E2E           | PASS    | mesma approval/request retomada após restart                                        |
| REQ-S3-018 Side-effect crash E2E          | PASS    | write executada uma vez; effect probe recupera                                      |
| REQ-S3-019 Budget downgrade E2E           | PASS    | T3 recusado, T1 capaz reservado/invocado                                            |
| REQ-S3-020 Metrics persistence            | PARTIAL | novas métricas duráveis; fallback/escalation ainda não instrumentados               |

Coverage final da slice 3: 64.43% statements, 47.31% branches, 64.84% functions e
66.36% lines. O gate CI foi elevado para 55/40/55/55 sem reduzir o escopo medido.

## Slice final de infraestrutura

| ID                                                 | Estado  | Evidência / bloqueio                                                                            |
| -------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| REQ-S4-001 Distributed cancellation                | PASS    | token durável versionado, polling bus, AbortSignal em provider/tool, fencing e testes           |
| REQ-S4-002 Backend health                          | PASS    | snapshots, latência/erros/429, circuit open/half-open/recovery e seleção saudável               |
| REQ-S4-003 Fallback/escalation metrics             | PASS    | tipos e métricas separadas para fallback, downgrade e escalations                               |
| REQ-S4-004 Postgres contract tests                 | BLOCKED | nenhum `docker`, `supabase` ou `psql` disponível; migration não conta como execução             |
| REQ-S4-005 Postgres concurrency                    | BLOCKED | mesmas ferramentas ausentes; corridas reais não foram fingidas com mocks                        |
| REQ-S4-006 Worker supervisor                       | PASS    | start/stop, health, kill switch, restart limitado, backoff/jitter e crash-loop test             |
| REQ-S4-007 Graceful shutdown                       | PASS    | AbortController e grace period limitado com heartbeat STOPPING/STOPPED                          |
| REQ-S4-008 Backend registry production integration | PASS    | capability/health-aware registry e política de routing por papel/custo                          |
| REQ-S4-009 Codex leader integration                | PARTIAL | papel/roteamento/final review integrados; smoke real sem backend/credencial configurados        |
| REQ-S4-010 Manager role integration                | PASS    | responsabilidade explícita, DAG/delegação e consolidação no E2E                                 |
| REQ-S4-011 Cheap worker routing                    | PASS    | seleção testada de worker capaz barato para execução estreita                                   |
| REQ-S4-012 Hierarchical E2E                        | PASS    | bug real corrigido, npm test real, três tasks, artifacts/evidence e review                      |
| REQ-S4-013 MissionResultEnvelope                   | PASS    | schema compacto completo e validação fail-closed                                                |
| REQ-S4-014 Full tracing                            | PARTIAL | store/exporter e spans hierárquicos; instrumentação de toda chamada legada pendente             |
| REQ-S4-015 Runtime dashboard data                  | PASS    | query única para missões/tasks/workers/backends/approvals/dead letters/recovery/uso             |
| REQ-S4-016 Agent presence integration              | PARTIAL | presença derivada disponível; ligação completa à Office View pendente                           |
| REQ-S4-017 Approval operational flow               | PASS    | snapshot sanitizado, once/mission/persistent explícito, deny e restart testados                 |
| REQ-S4-018 Cost/token visibility                   | PARTIAL | total real, reservas e breakdown provider/model disponíveis; cached/per-agent legados pendentes |
| REQ-S4-019 Security hardening                      | PASS    | SSRF/DNS/redirect, paths/symlink, argv, redaction, replay, fencing e isolamento                 |
| REQ-S4-020 Side-effect strategy                    | PASS    | replay safe, idempotency key, effect probe e unknown/human review                               |
| REQ-S4-021 Load test                               | PASS    | 10 missões × 5 tasks, 10 workers, sem duplicata/stuck/reserva vazada                            |
| REQ-S4-022 Production documentation                | PASS    | guia production-runtime, ADR, README e arquitetura atualizados                                  |

Declaração da slice: **INFRASTRUCTURE PARTIAL**. O requisito crítico M da Definition of Done permanece
bloqueado por ambiente externo; os detalhes estão em `production-runtime.md`. Nenhuma produção foi
acessada e nenhum PASS de PostgreSQL foi inferido da análise estática da migration.

Gates locais finais: 100/100 testes PASS. Coverage: 67.10% statements, 50.27% branches, 67.76%
functions e 69.25% lines — todos acima do baseline da slice 3, embora a meta recomendada de 68% não
tenha sido alcançada em statements/functions. Lint passou com 12 warnings preexistentes; typecheck,
build, diff-check e audit (0 vulnerabilidades) passaram.

## Missão PRX + LocalAnt + FreeClaude — 1.4.0 candidata

| Requisito | Estado | Evidência / limite |
| --- | --- | --- |
| REQ-AGENT-001 Existing Acme Robots agent discovery | PASS | Store desktop consultado; IDs Codex c096348e, GPT 2c10fb31, Claudinho 35fec107 |
| REQ-AGENT-002 GPT Manager hierarchy | PASS | binding idempotente e teste de IDs preservados |
| REQ-AGENT-003 PRX backend | PARTIAL | backend/driver implementados; porta 9223 indisponível |
| REQ-AGENT-004 PRX correlation | PARTIAL | teste de resposta incorreta; driver e persistência de sessão ainda sem E2E |
| REQ-AGENT-005 PRX cancellation | PASS | testes de timeout, aborto e exclusão de escritores |
| REQ-AGENT-006 LocalAnt adapter | PARTIAL | alias para handlers existentes; grep/glob/edit dedicado não implementados |
| REQ-AGENT-007 AI Office policy enforcement over LocalAnt | PASS | testes de deny/approval; solicitações do gerente usam fila durável |
| REQ-AGENT-008 Claudinho existing agent binding | PASS | IDs preservados e associação idempotente |
| REQ-AGENT-009 FreeClaude backend | PASS | transporte Messages nativo validado com modelo gratuito real; blocos thinking separados e respostas incompletas rejeitadas; não depende do proxy Python |
| REQ-AGENT-010 OpenRouter provider | PASS | modelo/timeout/temperatura e teste HTTP falso |
| REQ-AGENT-011 SecretStore OpenRouter | PASS | chave autorizada salva e relida no DPAPI; probe real CONNECTED; ausência de plaintext verificada; backups do store/vault preservados |
| REQ-AGENT-012 Configurable model | PASS | formulário existente; sem modelo fixo para o backend |
| REQ-AGENT-013 Claudinho → GPT escalation | PARTIAL | engine integrado, sem E2E do fluxo completo |
| REQ-AGENT-014 GPT → Claudinho response | PARTIAL | schema e continuação implementados; sem E2E completo |
| REQ-AGENT-015 Codex hierarchy | PARTIAL | vínculo preservado; provedor real do líder não configurado |
| REQ-CHAT-001 Group chat panel | PASS | smoke visual do build em janela ampla: mapa e painel coexistem; participantes visíveis |
| REQ-CHAT-002 Runtime-backed messages | PASS | eventos reais, sem mensagens fixas |
| REQ-CHAT-003 Per-mission chat | PARTIAL | filtro disponível; janela de eventos limitada aos 200 recentes |
| REQ-CHAT-004 Agent message persistence | PARTIAL | usa mission_events existentes; não há novo evento canônico AgentMessage |
| REQ-CHAT-005 Traceable messages | PARTIAL | link de missão e ID de tarefa; links diretos de run/artifact pendentes |
| REQ-OFFICE-001 Walking/reporting | PARTIAL | bridge ampliado; QA de missão completa pendente |
| REQ-OFFICE-002 Path visualization | PARTIAL | pathfinding existente preservado, sem novo smoke visual |
| REQ-OFFICE-003 Runtime state binding | PARTIAL | eventos reais; enum visual expandido completo pendente |
| REQ-E2E-001 Three-agent hierarchy E2E | PARTIAL | teste de adaptadores + efeitos reais em fixture; não cobre missão completa do engine/desktop |

Não considerar esta missão encerrada enquanto os PARTIAL acima não forem resolvidos.
O teste real de ChatGPT no navegador confirmou somente a criação do canal PRX - Geral.
Não equivale a um smoke do PRX backend. Nenhum instalador 1.4.0 foi validado até aqui.
