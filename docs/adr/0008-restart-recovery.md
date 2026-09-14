# ADR 0008 — Restart recovery

## Decisão

Executar reconciliação determinística antes de cada passagem autônoma. A recovery matrix define cada
transição; todo reparo gera audit e métrica.

## Consequência

Restart não depende da memória anterior. Estados ambíguos permanecem diagnosticáveis em vez de serem
silenciosamente aprovados.
