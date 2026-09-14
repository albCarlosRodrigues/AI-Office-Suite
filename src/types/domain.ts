import type { Database } from "@/integrations/supabase/types";

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Inserts<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];

export type Organization = Tables<"organizations">;
export type OrganizationSettings = Tables<"organization_settings">;
export type Department = Tables<"departments">;
export type Agent = Tables<"agents">;
export type AgentProvider = Tables<"agent_providers">;
export type Workstation = Tables<"workstations">;
export type OfficeZone = Tables<"office_zones">;
export type OfficeMap = Tables<"office_maps">;
export type Mission = Tables<"missions">;
export type Task = Tables<"tasks">;
export type Command = Tables<"commands">;
export type CommandResult = Tables<"command_results">;
export type MissionEvent = Tables<"mission_events">;
export type ApprovalRequest = Tables<"approval_requests">;
export type AuditLog = Tables<"audit_logs">;
export type CostRecord = Tables<"cost_records">;
export type Meeting = Tables<"meetings">;
export type AgentRun = Tables<"agent_runs">;
export type ToolCall = Tables<"tool_calls">;
export type AgentPermission = Tables<"agent_permissions">;
export type MissionPermission = Tables<"mission_permissions">;

export type AgentStatus = Enums<"agent_status">;
export type MissionStatus = Enums<"mission_status">;
export type TaskStatus = Enums<"task_status">;
export type CommandStatus = Enums<"command_status">;
export type ApprovalStatus = Enums<"approval_status">;
export type RiskLevel = Enums<"risk_level">;
export type ProviderType = Enums<"provider_type">;
export type ProviderHealth = Enums<"provider_health">;
export type AgentKind = Enums<"agent_kind">;
export type ExecutionMode = Enums<"execution_mode">;
export type ApprovalScope = Enums<"approval_scope">;

export const AGENT_STATUSES: AgentStatus[] = [
  "IDLE",
  "WALKING",
  "THINKING",
  "WORKING",
  "WAITING",
  "DELEGATING",
  "REVIEWING",
  "MEETING",
  "NEEDS_APPROVAL",
  "ERROR",
  "OFFLINE",
  "PAUSED",
];

export const AUTONOMY_LEVELS = [
  { level: 0, name: "Manual", description: "Toda ação exige aprovação humana explícita." },
  {
    level: 1,
    name: "Restrita",
    description: "Executa somente o comando recebido. Ferramentas sensíveis exigem aprovação.",
  },
  {
    level: 2,
    name: "Delegada",
    description: "Pode organizar etapas próprias dentro do escopo delegado.",
  },
  { level: 3, name: "Gestor", description: "Pode planejar, dividir e delegar trabalho." },
  {
    level: 4,
    name: "Executiva",
    description: "Pode iniciar missões e coordenar gestores, respeitando as políticas humanas.",
  },
] as const;

export const DEPARTMENT_KINDS = [
  "Executive",
  "Engineering",
  "Research",
  "QA",
  "Design",
  "Product",
  "Security",
  "Marketing",
  "Operations",
] as const;

export const ZONE_KINDS = [
  "executive_office",
  "engineering",
  "qa",
  "research",
  "design",
  "operations",
  "product",
  "meeting_room",
  "server_room",
  "break_room",
  "reception",
  "corridor",
  "security",
  "marketing",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export type EvidenceType =
  | "code_diff"
  | "command_output"
  | "file_reference"
  | "test_result"
  | "web_reference"
  | "screenshot"
  | "text"
  | "json";
export interface Evidence {
  type: EvidenceType;
  title: string;
  content: string;
  simulated?: boolean;
}

export type WorkerResponseStatus =
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED"
  | "BLOCKED"
  | "NEEDS_CLARIFICATION"
  | "REQUEST_PERMISSION"
  | "REQUEST_SCOPE_EXTENSION";

export interface ScopeExtensionRequest {
  requestedAction: string;
  reason: string;
  risk: RiskLevel;
  requiredPermissions: string[];
}

export interface OrgPolicy {
  id: string;
  rule: string;
  enforced: boolean;
}

export interface FurnitureItem {
  kind: string;
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  height?: number;
}

export interface OfficeMapLayers {
  furniture?: FurnitureItem[];
}

export interface ZoneProperties {
  door?: { x: number; y: number };
  door2?: { x: number; y: number };
  floor?: string;
  wall?: string;
  seats?: [number, number][];
}
