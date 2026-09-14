import type { RiskLevel } from "@/types/domain";

/**
 * ToolRegistry — client-safe catalog (no handlers).
 * Handlers live server-side in tools/handlers.server.ts and are resolved by id.
 */
export interface ToolDef {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredPermissions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export const TOOL_CATALOG: ToolDef[] = [
  {
    id: "repository_read",
    name: "Leitura do repositório",
    description: "Lê arquivos do repositório conectado.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { path: "string" },
    outputSchema: { content: "string" },
  },
  {
    id: "repository_write",
    name: "Alteração do repositório",
    description: "Cria ou altera arquivos em uma branch.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["repository.write"],
    inputSchema: { path: "string", diff: "string" },
    outputSchema: { changeset: "string" },
  },
  {
    id: "code_analysis",
    name: "Análise de código",
    description: "Executa análise estática de um arquivo ou módulo.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { target: "string" },
    outputSchema: { findings: "array" },
  },
  {
    id: "shell",
    name: "Terminal",
    description: "Executa um comando no ambiente isolado.",
    riskLevel: "HIGH",
    requiredPermissions: ["shell.execute"],
    inputSchema: { command: "string" },
    outputSchema: { stdout: "string", exitCode: "number" },
  },
  {
    id: "testing",
    name: "Executor de testes",
    description: "Executa todos os testes ou parte deles.",
    riskLevel: "LOW",
    requiredPermissions: ["tests.execute"],
    inputSchema: { pattern: "string?" },
    outputSchema: { passed: "number", failed: "number" },
  },
  {
    id: "github_issue_read",
    name: "Leitura de issues do GitHub",
    description: "Lê issues sem permissão de alteração.",
    riskLevel: "LOW",
    requiredPermissions: ["github.issue.read"],
    inputSchema: { issue: "number" },
    outputSchema: { issue: "object" },
  },
  {
    id: "github_pr_create",
    name: "Criação de PR no GitHub",
    description: "Cria um pull request.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["github.pr.create"],
    inputSchema: { base: "string", head: "string" },
    outputSchema: { url: "string" },
  },
  {
    id: "git_commit",
    name: "Commit do Git",
    description: "Registra as alterações preparadas.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["git.commit"],
    inputSchema: { message: "string" },
    outputSchema: { commit: "string" },
  },
  {
    id: "browser",
    name: "Navegador",
    description: "Abre páginas e captura imagens.",
    riskLevel: "LOW",
    requiredPermissions: ["web.browse"],
    inputSchema: { url: "string" },
    outputSchema: { text: "string" },
  },
  {
    id: "web_search",
    name: "Pesquisa na web",
    description: "Pesquisa referências na web.",
    riskLevel: "LOW",
    requiredPermissions: ["web.browse"],
    inputSchema: { query: "string" },
    outputSchema: { results: "array" },
  },
  {
    id: "filesystem",
    name: "Sistema de arquivos",
    description: "Acessa arquivos no ambiente isolado.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["repository.read", "repository.write"],
    inputSchema: { op: "string" },
    outputSchema: { ok: "boolean" },
  },
  {
    id: "database_query",
    name: "Consulta ao banco",
    description: "Executa SQL somente para leitura.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["database.read"],
    inputSchema: { sql: "string" },
    outputSchema: { rows: "array" },
  },
  {
    id: "database_write",
    name: "Alteração do banco",
    description: "Executa SQL que altera dados.",
    riskLevel: "HIGH",
    requiredPermissions: ["database.write"],
    inputSchema: { sql: "string" },
    outputSchema: { affected: "number" },
  },
  {
    id: "deploy_staging",
    name: "Publicação em homologação",
    description: "Publica no ambiente de homologação.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["deploy.staging"],
    inputSchema: { ref: "string" },
    outputSchema: { url: "string" },
  },
  {
    id: "deploy_production",
    name: "Publicação em produção",
    description: "Publica no ambiente de produção.",
    riskLevel: "CRITICAL",
    requiredPermissions: ["deploy.production"],
    inputSchema: { ref: "string" },
    outputSchema: { url: "string" },
  },
  {
    id: "send_email",
    name: "Enviar e-mail",
    description: "Envia uma mensagem externa por e-mail.",
    riskLevel: "HIGH",
    requiredPermissions: ["email.send"],
    inputSchema: { to: "string", body: "string" },
    outputSchema: { id: "string" },
  },
];

export const TOOL_MAP = Object.fromEntries(TOOL_CATALOG.map((t) => [t.id, t])) as Record<
  string,
  ToolDef
>;
