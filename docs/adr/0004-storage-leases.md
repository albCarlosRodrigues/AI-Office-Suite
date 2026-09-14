# ADR 0004 — Storage, leases e fencing

Claims incrementam o step atomicamente e retornam lease versionado. Somente o owner com fencing token atual pode liberar/confirmar. Planos inválidos são rejeitados antes de inserts parciais.
