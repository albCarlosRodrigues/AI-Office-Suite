# ADR 0009 — Transactional outbox

## Decisão

Persistir eventos no mesmo transaction boundary da mudança de aggregate. Consumers deduplicam usando
`(consumer,eventId)`.

## Consequência

Dispatch pode ser refeito com segurança. Efeitos externos do consumer continuam obrigados a usar sua
própria idempotency key.
