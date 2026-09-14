# ADR 0007 — Exactly-once lógico

## Decisão

A chave combina escopo, tipo da operação, input canônico e ID lógico. Completion persiste um resultRef.
Handlers mutáveis podem implementar effect probes; filesystem_write compara bytes/hash após crash.

## Consequência

Não prometemos exactly-once físico distribuído. Reentrega não duplica o efeito lógico, cobrança ou
resultado aceito.
