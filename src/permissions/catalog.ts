import type { RiskLevel } from "@/types/domain";

export interface PermissionDef {
  id: string;
  label: string;
  risk: RiskLevel;
  group: "files" | "code" | "git" | "runtime" | "data" | "deploy" | "comms" | "org";
}

export const PERMISSIONS: PermissionDef[] = [
  { id: "repository.read", label: "Ler repositório", risk: "LOW", group: "files" },
  { id: "repository.write", label: "Alterar repositório", risk: "MEDIUM", group: "files" },
  { id: "shell.execute", label: "Executar comandos", risk: "HIGH", group: "runtime" },
  { id: "github.issue.read", label: "Ler issues do GitHub", risk: "LOW", group: "git" },
  { id: "github.pr.create", label: "Criar pull request", risk: "MEDIUM", group: "git" },
  { id: "git.branch.create", label: "Criar branch", risk: "LOW", group: "git" },
  { id: "git.commit", label: "Registrar alteração", risk: "MEDIUM", group: "git" },
  { id: "tests.execute", label: "Executar testes", risk: "LOW", group: "runtime" },
  { id: "web.browse", label: "Navegar na web", risk: "LOW", group: "comms" },
  { id: "database.read", label: "Ler banco de dados", risk: "MEDIUM", group: "data" },
  { id: "database.write", label: "Alterar banco de dados", risk: "HIGH", group: "data" },
  { id: "deploy.staging", label: "Publicar em homologação", risk: "MEDIUM", group: "deploy" },
  { id: "deploy.production", label: "Publicar em produção", risk: "CRITICAL", group: "deploy" },
  { id: "email.send", label: "Enviar e-mail", risk: "HIGH", group: "comms" },
  { id: "manage_agents", label: "Gerenciar agentes", risk: "HIGH", group: "org" },
  { id: "delegate_tasks", label: "Delegar tarefas", risk: "MEDIUM", group: "org" },
  { id: "approve_tasks", label: "Aprovar tarefas", risk: "MEDIUM", group: "org" },
];

export const PERMISSION_MAP = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p])) as Record<
  string,
  PermissionDef
>;

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
  "delegate_tasks",
  "approve_tasks",
  "manage_agents",
] as const;

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
