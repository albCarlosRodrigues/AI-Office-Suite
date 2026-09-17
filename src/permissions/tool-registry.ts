import type { RiskLevel } from "@/types/domain";

export type ToolApprovalMode = "NONE" | "CONDITIONAL" | "ALWAYS";
export type ToolExecutionBackend = "LOCAL" | "GITHUB" | "DATABASE" | "PROVIDER" | "EXTERNAL";
export type ToolDataAccess = "NONE" | "READ" | "WRITE" | "EXTERNAL_EFFECT";
export const CAPABILITIES = [
  "repository_read",
  "repository_write",
  "shell",
  "github",
  "testing",
  "browser",
  "filesystem",
  "code_analysis",
  "browse_web",
  "database",
  "deploy",
  "comms",
  "delegate_tasks",
  "approve_tasks",
  "manage_agents",
] as const;
export type ToolCapability = (typeof CAPABILITIES)[number];

const CAPABILITY_BY_TOOL_ID: Record<string, ToolCapability> = {
  repository_read: "repository_read",
  filesystem_read: "filesystem",
  repository_write: "repository_write",
  filesystem_write: "filesystem",
  code_analysis: "code_analysis",
  git_status: "repository_read",
  git_diff: "repository_read",
  git_diff_check: "repository_read",
  git_apply: "repository_write",
  shell: "shell",
  testing: "testing",
  typecheck: "testing",
  lint: "testing",
  build: "testing",
  github_issue_read: "github",
  github_pr_create: "github",
  git_commit: "repository_write",
  browser: "browser",
  web_search: "browse_web",
  filesystem: "filesystem",
  database_query: "database",
  database_write: "database",
  deploy_staging: "deploy",
  deploy_production: "deploy",
  send_email: "comms",
};

/**
 * Canonical tool metadata shared by planning and authorization.
 * Runtime handlers remain server-only, but their security metadata must come from here.
 */
export interface ToolDef {
  id: string;
  capability: ToolCapability;
  /** Primary permission for UI/audit; requiredPermissions remains authoritative. */
  permission: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredPermissions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  aliases: string[];
  approval: ToolApprovalMode;
  backend: ToolExecutionBackend;
  dataAccess: ToolDataAccess;
  /** Enabling a broader tool can expose these safer/specialized derived tools. */
  enabledBy: string[];
}

const tool = (
  definition: Omit<ToolDef, "aliases" | "enabledBy" | "capability" | "permission"> & {
    aliases?: string[];
    enabledBy?: string[];
  },
): ToolDef => {
  const capability = CAPABILITY_BY_TOOL_ID[definition.id];
  const permission = definition.requiredPermissions[0];
  if (!capability) throw new Error(`TOOL_REGISTRY_MISSING_CAPABILITY:${definition.id}`);
  if (!permission) throw new Error(`TOOL_REGISTRY_MISSING_PERMISSION:${definition.id}`);
  return { aliases: [], enabledBy: [], capability, permission, ...definition };
};

export const TOOL_CATALOG: ToolDef[] = [
  tool({
    id: "repository_read",
    name: "Leitura do repositório",
    description: "Lê arquivos do repositório conectado.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { path: "string (file or directory, relative to workspace)" },
    outputSchema: {
      type: '"file" | "directory"',
      path: "string",
      exists: "boolean",
      content: "string?",
      entries: "array?",
      truncated: "boolean?",
    },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
  }),
  tool({
    id: "filesystem_read",
    name: "Leitura de arquivo",
    description: "Lê um arquivo dentro do workspace autorizado.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { path: "string" },
    outputSchema: { content: "string" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["repository_read"],
  }),
  tool({
    id: "repository_write",
    name: "Alteração do repositório",
    description: "Cria/altera arquivos ou aplica patch dentro do workspace.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["repository.write"],
    inputSchema: { path: "string?", content: "string?", patch: "string?" },
    outputSchema: { changeset: "string" },
    approval: "CONDITIONAL",
    backend: "LOCAL",
    dataAccess: "WRITE",
  }),
  tool({
    id: "filesystem_write",
    name: "Escrita de arquivo",
    description: "Escreve um arquivo dentro do workspace autorizado.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["repository.write"],
    inputSchema: { path: "string", content: "string" },
    outputSchema: { afterHash: "string" },
    approval: "CONDITIONAL",
    backend: "LOCAL",
    dataAccess: "WRITE",
    enabledBy: ["repository_write"],
  }),
  tool({
    id: "code_analysis",
    name: "Análise de código",
    description: "Executa análise estática de arquivo ou módulo.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { target: "string" },
    outputSchema: { findings: "array" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
  }),
  tool({
    id: "git_status",
    name: "Git status",
    description: "Consulta o estado do Git sem alterar o repositório.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { cwd: "string?" },
    outputSchema: { stdout: "string" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["repository_read"],
  }),
  tool({
    id: "git_diff",
    name: "Git diff",
    description: "Consulta alterações locais sem alterar o repositório.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { cwd: "string?" },
    outputSchema: { stdout: "string" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["repository_read"],
  }),
  tool({
    id: "git_diff_check",
    name: "Git diff --check",
    description: "Valida whitespace/conflitos de patch sem modificar arquivos.",
    riskLevel: "LOW",
    requiredPermissions: ["repository.read"],
    inputSchema: { cwd: "string?" },
    outputSchema: { stdout: "string", exitCode: "number" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["repository_read"],
  }),
  tool({
    id: "git_apply",
    name: "Aplicar patch Git",
    description: "Aplica patch no workspace autorizado.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["repository.write"],
    inputSchema: { cwd: "string?", patch: "string", timeoutMs: "number?" },
    outputSchema: { stdout: "string", exitCode: "number" },
    aliases: ["apply_patch"],
    approval: "CONDITIONAL",
    backend: "LOCAL",
    dataAccess: "WRITE",
    enabledBy: ["repository_write"],
  }),
  tool({
    id: "shell",
    name: "Terminal",
    description: "Executa comando genérico. Ferramenta break-glass de alto risco.",
    riskLevel: "HIGH",
    requiredPermissions: ["shell.execute"],
    inputSchema: { argv: "string[]", cwd: "string?", timeoutMs: "number?" },
    outputSchema: { stdout: "string", exitCode: "number" },
    approval: "ALWAYS",
    backend: "LOCAL",
    dataAccess: "EXTERNAL_EFFECT",
  }),
  tool({
    id: "testing",
    name: "Executor de testes",
    description: "Executa a suíte de testes do projeto.",
    riskLevel: "LOW",
    requiredPermissions: ["tests.execute"],
    inputSchema: { args: "string[]?", cwd: "string?" },
    outputSchema: { passed: "number", failed: "number" },
    aliases: ["project_run_tests"],
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
  }),
  tool({
    id: "typecheck",
    name: "Typecheck",
    description: "Executa o typecheck do projeto.",
    riskLevel: "LOW",
    requiredPermissions: ["tests.execute"],
    inputSchema: { args: "string[]?", cwd: "string?" },
    outputSchema: { stdout: "string", exitCode: "number" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["testing"],
  }),
  tool({
    id: "lint",
    name: "Lint",
    description: "Executa lint do projeto.",
    riskLevel: "LOW",
    requiredPermissions: ["tests.execute"],
    inputSchema: { args: "string[]?", cwd: "string?" },
    outputSchema: { stdout: "string", exitCode: "number" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["testing"],
  }),
  tool({
    id: "build",
    name: "Build",
    description: "Executa build local do projeto.",
    riskLevel: "LOW",
    requiredPermissions: ["tests.execute"],
    inputSchema: { args: "string[]?", cwd: "string?" },
    outputSchema: { stdout: "string", exitCode: "number" },
    approval: "NONE",
    backend: "LOCAL",
    dataAccess: "READ",
    enabledBy: ["testing"],
  }),
  tool({
    id: "github_issue_read",
    name: "Leitura de issues do GitHub",
    description: "Lê issue e comentários sem permissão de alteração.",
    riskLevel: "LOW",
    requiredPermissions: ["github.issue.read"],
    inputSchema: { repository: "string owner/name", issue: "number" },
    outputSchema: { issue: "object" },
    approval: "NONE",
    backend: "GITHUB",
    dataAccess: "READ",
  }),
  tool({
    id: "github_pr_create",
    name: "Criação de PR no GitHub",
    description: "Cria pull request.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["github.pr.create"],
    inputSchema: { base: "string", head: "string" },
    outputSchema: { url: "string" },
    approval: "CONDITIONAL",
    backend: "GITHUB",
    dataAccess: "EXTERNAL_EFFECT",
  }),
  tool({
    id: "git_commit",
    name: "Commit do Git",
    description: "Registra alterações preparadas.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["git.commit"],
    inputSchema: { message: "string" },
    outputSchema: { commit: "string" },
    approval: "CONDITIONAL",
    backend: "LOCAL",
    dataAccess: "WRITE",
  }),
  tool({
    id: "browser",
    name: "Navegador",
    description: "Abre páginas e captura conteúdo.",
    riskLevel: "LOW",
    requiredPermissions: ["web.browse"],
    inputSchema: { url: "string" },
    outputSchema: { text: "string" },
    approval: "NONE",
    backend: "EXTERNAL",
    dataAccess: "READ",
  }),
  tool({
    id: "web_search",
    name: "Pesquisa na web",
    description: "Pesquisa referências na web.",
    riskLevel: "LOW",
    requiredPermissions: ["web.browse"],
    inputSchema: { query: "string" },
    outputSchema: { results: "array" },
    aliases: ["browse_web"],
    approval: "NONE",
    backend: "EXTERNAL",
    dataAccess: "READ",
  }),
  tool({
    id: "filesystem",
    name: "Sistema de arquivos",
    description: "Compatibilidade para operações antigas de filesystem.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["repository.read", "repository.write"],
    inputSchema: { op: "string" },
    outputSchema: { ok: "boolean" },
    approval: "CONDITIONAL",
    backend: "LOCAL",
    dataAccess: "WRITE",
  }),
  tool({
    id: "database_query",
    name: "Consulta ao banco",
    description: "Executa consulta somente leitura.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["database.read"],
    inputSchema: { sql: "string" },
    outputSchema: { rows: "array" },
    approval: "CONDITIONAL",
    backend: "DATABASE",
    dataAccess: "READ",
  }),
  tool({
    id: "database_write",
    name: "Alteração do banco",
    description: "Executa alteração de dados.",
    riskLevel: "HIGH",
    requiredPermissions: ["database.write"],
    inputSchema: { sql: "string" },
    outputSchema: { affected: "number" },
    approval: "ALWAYS",
    backend: "DATABASE",
    dataAccess: "WRITE",
  }),
  tool({
    id: "deploy_staging",
    name: "Publicação em homologação",
    description: "Publica em staging.",
    riskLevel: "MEDIUM",
    requiredPermissions: ["deploy.staging"],
    inputSchema: { ref: "string" },
    outputSchema: { url: "string" },
    approval: "CONDITIONAL",
    backend: "PROVIDER",
    dataAccess: "EXTERNAL_EFFECT",
  }),
  tool({
    id: "deploy_production",
    name: "Publicação em produção",
    description: "Publica em produção. Sempre exige aprovação humana específica.",
    riskLevel: "CRITICAL",
    requiredPermissions: ["deploy.production"],
    inputSchema: { ref: "string" },
    outputSchema: { url: "string" },
    approval: "ALWAYS",
    backend: "PROVIDER",
    dataAccess: "EXTERNAL_EFFECT",
  }),
  tool({
    id: "send_email",
    name: "Enviar e-mail",
    description: "Envia comunicação externa.",
    riskLevel: "HIGH",
    requiredPermissions: ["email.send"],
    inputSchema: { to: "string", body: "string" },
    outputSchema: { id: "string" },
    approval: "ALWAYS",
    backend: "EXTERNAL",
    dataAccess: "EXTERNAL_EFFECT",
  }),
];

export const TOOL_MAP = Object.fromEntries(TOOL_CATALOG.map((item) => [item.id, item])) as Record<
  string,
  ToolDef
>;

/** Canonical governance registry. UI/runtime consumers resolve tool metadata here. */
export const TOOL_REGISTRY = TOOL_MAP;

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const definition of TOOL_CATALOG) {
  ALIAS_TO_CANONICAL.set(definition.id, definition.id);
  for (const alias of definition.aliases) ALIAS_TO_CANONICAL.set(alias, definition.id);
}

export function canonicalToolId(toolId: string): string {
  return ALIAS_TO_CANONICAL.get(toolId) ?? toolId;
}

export function getToolDefinition(toolId: string): ToolDef | undefined {
  return TOOL_MAP[canonicalToolId(toolId)];
}

export function isKnownTool(toolId: string): boolean {
  return Boolean(getToolDefinition(toolId));
}

/**
 * Expands broad configured tools into safer, specialized operations.
 * Example: repository_read enables git_status/git_diff, avoiding shell fallback.
 */
export function expandEnabledToolIds(toolIds: Iterable<string>): Set<string> {
  const enabled = new Set<string>();
  for (const id of toolIds) enabled.add(canonicalToolId(id));

  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of TOOL_CATALOG) {
      if (enabled.has(definition.id)) continue;
      if (definition.enabledBy.some((parent) => enabled.has(canonicalToolId(parent)))) {
        enabled.add(definition.id);
        changed = true;
      }
    }
  }
  return enabled;
}

export function toolRequiresDurableApproval(toolId: string): boolean {
  return getToolDefinition(toolId)?.approval === "ALWAYS";
}
