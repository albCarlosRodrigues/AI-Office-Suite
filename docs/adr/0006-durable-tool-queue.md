# ADR 0006 — Durable tool queue

## Decisão

Usar entrega at-least-once com claim transacional, lease renovável e fencing versionado. O store local
usa lockfile + rename atômico; Supabase usa row lock com `SKIP LOCKED`.

## Consequência

Workers podem morrer e requests podem reaparecer. Apenas o owner do token/versão atual conclui a
operação, e retries são limitados antes de DEAD_LETTER.
