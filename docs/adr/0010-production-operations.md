# ADR 0010 — Operações e hierarquia de produção

## Estado

Aceito em 2026-09-14.

## Decisão

O produto usa uma hierarquia configurável de Leader, Manager e Worker. O Leader toma decisões globais
e faz a revisão final; Managers delegam e consolidam dentro da política; workers executam trabalho
estreito. O scheduler controla recursos, o policy engine controla autoridade e somente o ToolExecutor
gera efeitos e evidência operacional.

Cancelamento é um registro durável versionado observado por sinais locais. Health e circuit breaker são
persistidos e participam do routing. O resultado para o Leader é um envelope compacto validado, não o
transcript. Worker supervision, dead-letter operations, tracing exportável e uma query operacional são
interfaces do runtime, não comportamentos de UI.

## Consequências

Self-report não completa missão, resultados tardios não vencem cancelamento/fencing, e operações de
efeito desconhecido exigem probe ou intervenção. A implementação local é a referência executável. A
produção PostgreSQL não é declarada pronta sem contract tests reais em ambiente efêmero.
