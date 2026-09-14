import { cn } from "@/lib/utils";
import type {
  AgentStatus,
  MissionStatus,
  TaskStatus,
  ApprovalStatus,
  ProviderHealth,
  RiskLevel,
  CommandStatus,
} from "@/types/domain";

const AGENT: Record<AgentStatus, string> = {
  IDLE: "bg-status-idle/15 text-status-idle border-status-idle/30",
  WALKING: "bg-status-walking/15 text-status-walking border-status-walking/30",
  THINKING: "bg-status-thinking/15 text-status-thinking border-status-thinking/30",
  WORKING: "bg-status-working/15 text-status-working border-status-working/30",
  WAITING: "bg-status-waiting/15 text-status-waiting border-status-waiting/30",
  DELEGATING: "bg-status-delegating/15 text-status-delegating border-status-delegating/30",
  REVIEWING: "bg-status-reviewing/15 text-status-reviewing border-status-reviewing/30",
  MEETING: "bg-status-meeting/15 text-status-meeting border-status-meeting/30",
  NEEDS_APPROVAL:
    "bg-status-needs-approval/15 text-status-needs-approval border-status-needs-approval/30",
  ERROR: "bg-status-error/15 text-status-error border-status-error/30",
  OFFLINE: "bg-status-offline/15 text-status-offline border-status-offline/30",
  PAUSED: "bg-status-paused/15 text-status-paused border-status-paused/30",
};

const GENERIC: Record<string, string> = {
  // mission
  DRAFT: "bg-muted text-muted-foreground border-border",
  PLANNING: "bg-status-thinking/15 text-status-thinking border-status-thinking/30",
  RUNNING: "bg-status-working/15 text-status-working border-status-working/30",
  WAITING_APPROVAL:
    "bg-status-needs-approval/15 text-status-needs-approval border-status-needs-approval/30",
  REVIEWING: "bg-status-reviewing/15 text-status-reviewing border-status-reviewing/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  FAILED: "bg-destructive/15 text-destructive border-destructive/30",
  STOPPED: "bg-warning/15 text-warning border-warning/30",
  // tasks
  queued: "bg-muted text-muted-foreground border-border",
  running: "bg-status-working/15 text-status-working border-status-working/30",
  completed: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  waiting: "bg-status-waiting/15 text-status-waiting border-status-waiting/30",
  blocked: "bg-warning/15 text-warning border-warning/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  // approvals
  PENDING: "bg-status-needs-approval/15 text-status-needs-approval border-status-needs-approval/30",
  APPROVED: "bg-success/15 text-success border-success/30",
  DENIED: "bg-destructive/15 text-destructive border-destructive/30",
  MODIFIED: "bg-info/15 text-info border-info/30",
  EXPIRED: "bg-muted text-muted-foreground border-border",
  // provider health
  UNKNOWN: "bg-muted text-muted-foreground border-border",
  CONNECTED: "bg-success/15 text-success border-success/30",
  TIMEOUT: "bg-warning/15 text-warning border-warning/30",
  UNAUTHORIZED: "bg-destructive/15 text-destructive border-destructive/30",
  DISABLED: "bg-muted text-muted-foreground border-border",
  DEGRADED: "bg-warning/15 text-warning border-warning/30",
  UNCONFIGURED: "bg-muted text-muted-foreground border-border",
  ERROR: "bg-destructive/15 text-destructive border-destructive/30",
  SIMULATION: "bg-simulation/15 text-simulation border-simulation/30",
  REAL: "bg-success/15 text-success border-success/30",
  // risk
  LOW: "bg-success/15 text-success border-success/30",
  MEDIUM: "bg-info/15 text-info border-info/30",
  HIGH: "bg-warning/15 text-warning border-warning/30",
  CRITICAL: "bg-destructive/15 text-destructive border-destructive/30",
  // commands
  ACCEPTED: "bg-info/15 text-info border-info/30",
  BLOCKED: "bg-warning/15 text-warning border-warning/30",
  NEEDS_CLARIFICATION: "bg-warning/15 text-warning border-warning/30",
  REQUEST_PERMISSION:
    "bg-status-needs-approval/15 text-status-needs-approval border-status-needs-approval/30",
  REQUEST_SCOPE_EXTENSION:
    "bg-status-needs-approval/15 text-status-needs-approval border-status-needs-approval/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

type AnyStatus =
  | AgentStatus
  | MissionStatus
  | TaskStatus
  | ApprovalStatus
  | ProviderHealth
  | RiskLevel
  | CommandStatus
  | string;

const LABELS: Record<string, string> = {
  IDLE: "Ocioso",
  WALKING: "Caminhando",
  THINKING: "Pensando",
  WORKING: "Trabalhando",
  WAITING: "Aguardando",
  DELEGATING: "Delegando",
  REVIEWING: "Revisando",
  MEETING: "Em reunião",
  NEEDS_APPROVAL: "Exige aprovação",
  ERROR: "Erro",
  OFFLINE: "Desconectado",
  PAUSED: "Pausado",
  DRAFT: "Rascunho",
  PLANNING: "Planejando",
  RUNNING: "Em execução",
  WAITING_APPROVAL: "Aguardando aprovação",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  STOPPED: "Interrompido",
  queued: "Na fila",
  running: "Em execução",
  completed: "Concluída",
  failed: "Falhou",
  waiting: "Aguardando",
  blocked: "Bloqueada",
  cancelled: "Cancelada",
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  DENIED: "Negado",
  MODIFIED: "Modificado",
  EXPIRED: "Expirado",
  UNKNOWN: "Desconhecido",
  CONNECTED: "Conectado",
  TIMEOUT: "Tempo esgotado",
  UNAUTHORIZED: "Não autorizado",
  DISABLED: "Desativado",
  DEGRADED: "Instável",
  UNCONFIGURED: "Não configurado",
  SIMULATION: "Simulação",
  REAL: "Real",
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
  CRITICAL: "Crítico",
  ACCEPTED: "Aceito",
  BLOCKED: "Bloqueado",
  NEEDS_CLARIFICATION: "Precisa de esclarecimento",
  REQUEST_PERMISSION: "Solicita permissão",
  REQUEST_SCOPE_EXTENSION: "Solicita ampliação de escopo",
  CANCELLED: "Cancelado",
};

export function StatusBadge({
  status,
  className,
  pulse,
}: {
  status: AnyStatus;
  className?: string;
  pulse?: boolean;
}) {
  const cls =
    (AGENT as Record<string, string>)[status] ??
    GENERIC[status] ??
    "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        cls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", pulse && "animate-pulse-soft")} />
      {LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}
