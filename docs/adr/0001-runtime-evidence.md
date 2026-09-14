# ADR 0001 — Claims de LLM versus evidência

Respostas de modelo são não confiáveis para fatos operacionais. `ToolRequest` não contém verificação; apenas `ToolExecutionGateway` emite `ToolResult verified=true`. Gates determinísticos têm precedência sobre self-report.
