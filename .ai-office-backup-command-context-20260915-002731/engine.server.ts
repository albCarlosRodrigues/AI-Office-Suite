import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  Agent,
  AgentPermission,
  AgentStatus,
  ApprovalScope,
  Department,
  Evidence,
  Mission,
  OrgPolicy,
  Organization,
  OrganizationSettings,
  RiskLevel,
  Task,
  AgentProvider as ProviderRow,
} from "@/types/domain";
import { resolveProvider, type ProviderSecrets } from "./providers/resolve.server";
import { providerUsesMonetaryBudget } from "./providers/billing";
import {
  estimateCost,
  type AgentProvider,
  type PlannedTask,
  type Usage,
  type WorkerResponse,
} from "./providers/types";
import {
  buildAgentSystemPrompt,
  buildCommandContext,
  selectDependencyContext,
} from "./ContextBuilder";
import { subordinatesOf } from "@/agents/hierarchy";
import { TOOL_MAP } from "./tools/catalog";
import { RISK_ORDER } from "@/permissions/catalog";
import { AgentCapabilityMatcher } from "./AgentCapabilityMatcher";
import {
  buildExecutionCandidates,
  filterAgentsByTaskPermissions,
  formatPlanningPermissionMatrix,
  missingPermissionsForTask,
} from "./task-permission-routing";
import { DelegationPolicyService } from "./DelegationPolicyService";
import { AgentStateService, MissionStateMachine, TaskStateMachine } from "./state-machines";
import { MeetingService } from "./MeetingService";
import { detectDeadlock, validateTaskDag } from "./dag-validator";
import { parseMissionLease } from "./lease";
import { MissionContractSchema, TaskContractSchema, type TaskContract } from "./contracts";
import { enforceRuntimeEvidence } from "./tool-claims";
import { redact } from "@/runtime/security/redaction";
import { runtimeDurableStore } from "@/runtime/durable/store.server";
import { DurableMissionRuntime } from "@/runtime/durable/mission-runtime.server";
import { CancellationService } from "@/runtime/durable/cancellation-service.server";
import { LocalAntExecutionAdapter } from "@/integrations/localant/adapter";
import path from "node:path";
import { FileArtifactStore } from "@/runtime/artifact-store.server";

type DB = SupabaseClient<Database>;

/**
 * OrchestrationEngine — server-side, persisted, step-driven.
 *
 * Every call to `step()` advances ONE mission by one bounded unit of work and
 * writes the result to the database. Nothing lives in memory between steps,
 * so the engine is safe on stateless workers and every transition is auditable.
 *
 * Phases: created → planning → kickoff (meeting) → executing → finalizing → done
 */
export class OrchestrationEngine {
  private org!: Organization;
  private settings!: OrganizationSettings | null;
  private agents: Agent[] = [];
  private departments: Department[] = [];
  private providers: ProviderRow[] = [];
  private permissions: AgentPermission[] = [];
  private secrets = new Map<string, ProviderSecrets>();
  private policies: OrgPolicy[] = [];

  constructor(
    private db: DB,
    private userId: string,
    private env: { lovableApiKey?: string | undefined },
    private loadSecrets: (providerIds: string[]) => Promise<Map<string, ProviderSecrets>>,
  ) {}

  // ---------------- loading ----------------

  private async load(orgId: string) {
    const [org, settings, agents, departments, providers, permissions] = await Promise.all([
      this.db.from("organizations").select("*").eq("id", orgId).single(),
      this.db.from("organization_settings").select("*").eq("organization_id", orgId).maybeSingle(),
      this.db.from("agents").select("*").eq("organization_id", orgId),
      this.db.from("departments").select("*").eq("organization_id", orgId),
      this.db.from("agent_providers").select("*").eq("organization_id", orgId),
      this.db.from("agent_permissions").select("*").eq("organization_id", orgId),
    ]);
    if (org.error || !org.data) throw new Error("Organization not found or access denied");
    this.org = org.data;
    this.settings = settings.data ?? null;
    this.agents = agents.data ?? [];
    this.departments = departments.data ?? [];
    this.providers = providers.data ?? [];
    this.permissions = permissions.data ?? [];
    this.policies = ((this.settings?.policies ?? []) as unknown as OrgPolicy[]).filter(
      (p) => p && typeof p.rule === "string",
    );
    if (!this.org.simulation_mode) {
      const ids = this.providers
        .filter((p) => p.type !== "simulation" && p.type !== "lovable_ai")
        .map((p) => p.id);
      if (ids.length) this.secrets = await this.loadSecrets(ids);
    }
  }

  private agent(id: string | null | undefined): Agent | null {
    return this.agents.find((a) => a.id === id) ?? null;
  }
  private dept(id: string | null | undefined): Department | null {
    return this.departments.find((d) => d.id === id) ?? null;
  }
  private providerFor(agent: Agent): AgentProvider {
    const row = this.providers.find((p) => p.id === agent.provider_id) ?? null;
    return resolveProvider(
      agent,
      this.org,
      row,
      row ? (this.secrets.get(row.id) ?? null) : null,
      this.env,
    );
  }
  private systemPrompt(agent: Agent) {
    return buildAgentSystemPrompt(
      agent,
      this.dept(agent.department_id),
      this.policies,
      this.agent(agent.manager_agent_id),
    );
  }

  // ---------------- persistence helpers ----------------

  private async event(
    mission: Mission,
    type: string,
    message: string,
    extra: {
      agentId?: string | null;
      taskId?: string | null;
      targetAgentId?: string | null;
      payload?: Record<string, unknown>;
    } = {},
  ) {
    await this.db.from("mission_events").insert({
      organization_id: mission.organization_id,
      mission_id: mission.id,
      task_id: extra.taskId ?? null,
      agent_id: extra.agentId ?? null,
      target_agent_id: extra.targetAgentId ?? null,
      type,
      message: String(redact(message)),
      payload: (extra.payload ?? {}) as never,
    });
  }

  private async audit(
    mission: Mission | null,
    action: string,
    opts: {
      agentId?: string | null;
      taskId?: string | null;
      tool?: string | null;
      input?: string | null;
      output?: string | null;
      risk?: RiskLevel;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    await this.db.from("audit_logs").insert({
      organization_id: mission?.organization_id ?? this.org.id,
      mission_id: mission?.id ?? null,
      task_id: opts.taskId ?? null,
      agent_id: opts.agentId ?? null,
      actor_user_id: this.userId,
      action,
      tool: opts.tool ?? null,
      input_summary: opts.input ? String(redact(opts.input)) : null,
      output_summary: opts.output ? String(redact(opts.output)) : null,
      risk_level: opts.risk ?? "LOW",
      metadata: redact(opts.metadata ?? {}) as never,
    });
  }

  private async setAgentStatus(
    agentId: string | null | undefined,
    status: AgentStatus,
    extra: Partial<Pick<Agent, "current_mission_id" | "current_task_id">> = {},
  ) {
    if (!agentId) return;
    const a = this.agent(agentId);
    if (a && a.status === status && !("current_task_id" in extra)) return;
    if (a) AgentStateService.assert(a.status, status);
    await this.db
      .from("agents")
      .update({ status, ...extra })
      .eq("id", agentId);
    if (a) Object.assign(a, { status, ...extra });
  }

  private monetaryUsageCost(agent: Agent | null, usage: Usage) {
    if (usage.simulated || this.org.simulation_mode) return 0;
    const row = this.providers.find((provider) => provider.id === agent?.provider_id);
    return providerUsesMonetaryBudget(row) ? estimateCost(usage) : 0;
  }

  private async recordUsage(
    mission: Mission,
    agent: Agent | null,
    usage: Usage,
    taskId: string | null,
    kind: string,
    error?: string,
    commandId?: string,
    runId?: string,
  ) {
    const row = this.providers.find((p) => p.id === agent?.provider_id);
    const cost = this.monetaryUsageCost(agent, usage);
    await Promise.all([
      this.db.from("cost_records").insert({
        organization_id: mission.organization_id,
        mission_id: mission.id,
        task_id: taskId,
        agent_id: agent?.id ?? null,
        provider_id: this.org.simulation_mode ? null : (row?.id ?? null),
        provider_type: this.org.simulation_mode ? "simulation" : (row?.type ?? "simulation"),
        model: usage.model,
        input_tokens: usage.tokensIn,
        output_tokens: usage.tokensOut,
        estimated_cost: cost,
        is_simulated: usage.simulated,
      }),
      this.db.from("agent_runs").insert({
        ...(runId ? { id: runId } : {}),
        organization_id: mission.organization_id,
        mission_id: mission.id,
        task_id: taskId,
        command_id: commandId ?? null,
        agent_id: agent?.id ?? null,
        provider_id: this.org.simulation_mode ? null : (row?.id ?? null),
        model: usage.model,
        status: error ? "failed" : "completed",
        request_summary: kind,
        response_summary: error ?? null,
        tokens_in: usage.tokensIn,
        tokens_out: usage.tokensOut,
        cost,
        latency_ms: usage.latencyMs,
        error: error ?? null,
        is_simulated: usage.simulated,
        execution_mode: usage.simulated ? "SIMULATION" : "REAL",
        idempotency_key: runId ? `${commandId ?? kind}:${runId}` : null,
        completed_at: new Date().toISOString(),
      }),
    ]);
    mission.total_cost = Number(mission.total_cost) + cost;
    mission.total_tokens_in = Number(mission.total_tokens_in) + usage.tokensIn;
    mission.total_tokens_out = Number(mission.total_tokens_out) + usage.tokensOut;
    await this.db
      .from("missions")
      .update({
        total_cost: mission.total_cost,
        total_tokens_in: mission.total_tokens_in,
        total_tokens_out: mission.total_tokens_out,
      })
      .eq("id", mission.id);
  }

  private async releaseAgents(mission: Mission, status: AgentStatus = "IDLE") {
    const ids = this.agents.filter((a) => a.current_mission_id === mission.id).map((a) => a.id);
    if (!ids.length) return;
    await this.db
      .from("agents")
      .update({ status, current_mission_id: null, current_task_id: null })
      .in("id", ids);
    for (const a of this.agents)
      if (ids.includes(a.id))
        Object.assign(a, { status, current_mission_id: null, current_task_id: null });
  }

  private async finish(
    mission: Mission,
    status: "COMPLETED" | "FAILED" | "STOPPED",
    message: string,
    extra: Partial<Mission> = {},
  ) {
    MissionStateMachine.assert(mission.status, status, "finish");
    await this.db
      .from("missions")
      .update({
        status,
        phase: "done",
        completed_at: new Date().toISOString(),
        ...(status === "FAILED" ? { error: message } : {}),
        ...extra,
      } as never)
      .eq("id", mission.id);
    await this.db
      .from("tasks")
      .update({ status: "cancelled" })
      .eq("mission_id", mission.id)
      .in("status", ["queued", "running", "waiting"]);
    await this.db
      .from("commands")
      .update({ status: "CANCELLED" })
      .eq("mission_id", mission.id)
      .in("status", ["PENDING", "ACCEPTED", "RUNNING"]);
    await this.db
      .from("approval_requests")
      .update({ status: "EXPIRED" })
      .eq("mission_id", mission.id)
      .eq("status", "PENDING");
    await this.releaseAgents(mission, status === "FAILED" ? "IDLE" : "IDLE");
    await this.event(mission, `MISSION_${status}`, message, {
      agentId: mission.commander_agent_id,
    });
    await this.audit(mission, `mission.${status.toLowerCase()}`, {
      agentId: mission.commander_agent_id,
      output: message,
      risk: status === "FAILED" ? "MEDIUM" : "LOW",
    });
  }

  // ---------------- public API ----------------

  async start(missionId: string) {
    const { data: mission, error } = await this.db
      .from("missions")
      .select("*")
      .eq("id", missionId)
      .single();
    if (error || !mission) throw new Error("Mission not found");
    await this.load(mission.organization_id);
    if (this.org.kill_switch_active)
      throw new Error("Kill switch is active. Deactivate it before starting missions.");
    if (mission.status !== "DRAFT" && mission.status !== "STOPPED" && mission.status !== "FAILED")
      throw new Error(`Mission is ${mission.status}`);
    const commander = this.agent(mission.commander_agent_id);
    if (!commander) throw new Error("Mission needs a commander agent");
    if (commander.is_suspended) throw new Error(`${commander.name} is suspended`);
    // restart semantics: wipe previous attempt
    if (mission.status !== "DRAFT") {
      await this.db.from("tasks").delete().eq("mission_id", mission.id);
      await this.db.from("commands").delete().eq("mission_id", mission.id);
    }
    MissionStateMachine.assert(mission.status, "PLANNING", "start");
    await this.db
      .from("missions")
      .update({
        status: "PLANNING",
        phase: "planning",
        started_at: new Date().toISOString(),
        completed_at: null,
        current_step: 0,
        error: null,
        result: null,
        summary: null,
        report: null,
        stop_requested: false,
        total_cost: 0,
        total_tokens_in: 0,
        total_tokens_out: 0,
        is_simulated: this.org.simulation_mode,
        execution_mode: this.org.simulation_mode ? "SIMULATION" : "REAL",
      })
      .eq("id", mission.id);
    await this.setAgentStatus(commander.id, "THINKING", {
      current_mission_id: mission.id,
      current_task_id: null,
    });
    await this.event(
      mission,
      "MISSION_STARTED",
      `${commander.name} received the mission "${mission.title}" and is analysing the goal.`,
      { agentId: commander.id },
    );
    await this.audit(mission, "mission.start", { agentId: commander.id, input: mission.goal });
    return { ok: true };
  }

  async requestStop(missionId: string) {
    const { data: mission } = await this.db
      .from("missions")
      .select("*")
      .eq("id", missionId)
      .single();
    if (!mission) throw new Error("Mission not found");
    await this.load(mission.organization_id);
    if (["COMPLETED", "FAILED", "STOPPED", "DRAFT"].includes(mission.status)) return { ok: true };
    await this.finish(mission, "STOPPED", "Mission stopped by the human operator.");
    return { ok: true };
  }

  async killSwitch(orgId: string, active: boolean) {
    await this.load(orgId);
    await this.db.from("organizations").update({ kill_switch_active: active }).eq("id", orgId);
    if (active) {
      const { data: running } = await this.db
        .from("missions")
        .select("*")
        .eq("organization_id", orgId)
        .in("status", ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"]);
      for (const m of running ?? [])
        await this.finish(m, "STOPPED", "Kill switch activated: all missions halted.");
      await this.db
        .from("agents")
        .update({ status: "PAUSED", current_mission_id: null, current_task_id: null })
        .eq("organization_id", orgId)
        .neq("status", "OFFLINE");
    } else {
      await this.db
        .from("agents")
        .update({ status: "IDLE" })
        .eq("organization_id", orgId)
        .eq("status", "PAUSED");
    }
    await this.audit(null, active ? "kill_switch.activate" : "kill_switch.deactivate", {
      risk: "CRITICAL",
    });
    return { ok: true };
  }

  async resolveApproval(
    approvalId: string,
    decision: "APPROVED" | "DENIED",
    note: string | null,
    scope: ApprovalScope,
  ) {
    const { data: ar } = await this.db
      .from("approval_requests")
      .select("*")
      .eq("id", approvalId)
      .single();
    if (!ar) throw new Error("Approval not found");
    if (ar.status !== "PENDING") throw new Error("Approval already resolved");
    await this.load(ar.organization_id);
    const mission = ar.mission_id
      ? (await this.db.from("missions").select("*").eq("id", ar.mission_id).single()).data
      : null;
    const agent = this.agent(ar.agent_id);
    const persistent = decision === "APPROVED" && scope === "PERSISTENT";
    await this.db
      .from("approval_requests")
      .update({
        status: decision,
        resolved_by: this.userId,
        resolved_at: new Date().toISOString(),
        resolution_note: note,
        always_allow: persistent,
        approval_scope: scope,
      })
      .eq("id", ar.id);
    if (decision === "APPROVED" && scope === "MISSION" && agent && mission) {
      for (const permission of ar.required_permissions) {
        await this.db.from("mission_permissions").upsert(
          {
            organization_id: ar.organization_id,
            mission_id: mission.id,
            agent_id: agent.id,
            permission,
            granted_by: this.userId,
          },
          { onConflict: "mission_id,agent_id,permission" },
        );
      }
    }
    if (persistent && agent) {
      for (const perm of ar.required_permissions) {
        await this.db.from("agent_permissions").upsert(
          {
            organization_id: ar.organization_id,
            agent_id: agent.id,
            permission: perm,
            granted: true,
            always_allow: true,
            granted_by: this.userId,
          },
          { onConflict: "agent_id,permission" },
        );
      }
    }
    if (mission) {
      await this.audit(mission, `approval.${decision.toLowerCase()}`, {
        agentId: ar.agent_id,
        taskId: ar.task_id,
        tool: ar.tool_id,
        input: ar.action,
        output: note,
        risk: ar.risk_level,
        metadata: { scope, permissions: ar.required_permissions },
      });
      if (decision === "APPROVED") {
        if (ar.task_id) {
          await this.db.from("tasks").update({ status: "queued" }).eq("id", ar.task_id);
          const { data: cmd } = await this.db
            .from("commands")
            .select("id, context")
            .eq("task_id", ar.task_id)
            .eq("status", "BLOCKED")
            .maybeSingle();
          if (cmd)
            await this.db
              .from("commands")
              .update({
                status: "PENDING",
                context: {
                  ...(cmd.context as Record<string, unknown>),
                  approved: true,
                  approval_id: ar.id,
                } as never,
              })
              .eq("id", cmd.id);
        }
        if (agent) await this.setAgentStatus(agent.id, "WAITING");
        await this.db.from("missions").update({ status: "RUNNING" }).eq("id", mission.id);
        await this.event(
          mission,
          "APPROVAL_GRANTED",
          `Human approved: ${ar.action} (${scope.toLowerCase()}).`,
          { agentId: ar.agent_id, taskId: ar.task_id },
        );
      } else {
        if (ar.task_id) {
          await this.db
            .from("tasks")
            .update({
              status: "blocked",
              result: `Blocked: human denied "${ar.action}". ${note ?? ""}`,
            })
            .eq("id", ar.task_id);
          await this.db
            .from("commands")
            .update({ status: "BLOCKED" })
            .eq("task_id", ar.task_id)
            .in("status", ["PENDING", "BLOCKED"]);
        }
        await this.event(mission, "APPROVAL_DENIED", `Human denied: ${ar.action}. ${note ?? ""}`, {
          agentId: ar.agent_id,
          taskId: ar.task_id,
        });
        await this.finish(
          mission,
          "FAILED",
          `Approval denied for "${ar.action}". The controller cannot complete the mission without it.`,
        );
      }
    }
    return { ok: true };
  }

  /** Advance one mission by one bounded unit of work. Returns what happened. */
  async step(missionId: string): Promise<{ acted: boolean; note: string }> {
    const { data: m0 } = await this.db.from("missions").select("*").eq("id", missionId).single();
    if (!m0) throw new Error("Mission not found");
    if (!["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m0.status))
      return { acted: false, note: `status ${m0.status}` };
    await this.load(m0.organization_id);

    if (this.org.kill_switch_active) return { acted: false, note: "kill switch active" };
    if (m0.stop_requested) {
      await this.finish(m0, "STOPPED", "Stop requested by operator.");
      return { acted: true, note: "stopped" };
    }

    if (m0.status === "WAITING_APPROVAL") return { acted: false, note: "waiting approval" };

    const configuredMaxSteps = Math.min(m0.max_steps, this.settings?.max_steps ?? m0.max_steps);
    if (m0.current_step >= configuredMaxSteps) {
      await this.finish(
        m0,
        "FAILED",
        `Step limit reached (${configuredMaxSteps}). Loop protection stopped the mission.`,
      );
      return { acted: true, note: "step limit" };
    }

    const lockId = crypto.randomUUID();
    const { data: locked } = await this.db.rpc("claim_mission_step", {
      p_mission_id: m0.id,
      p_worker_id: lockId,
      p_lease_seconds: 180,
    });
    if (!locked) return { acted: false, note: "another worker stepped this mission" };
    const lease = parseMissionLease(locked);
    const mission = lease.mission as unknown as Mission;

    try {
      const budget = Math.min(
        Number(mission.budget),
        Number(this.settings?.max_mission_cost ?? mission.budget),
      );
      if (Number(mission.total_cost) > budget) {
        await this.finish(
          mission,
          "FAILED",
          `Budget exceeded ($${Number(mission.total_cost).toFixed(4)} > $${budget.toFixed(2)}).`,
        );
        return { acted: true, note: "budget" };
      }

      try {
        switch (mission.phase) {
          case "planning":
            return await this.stepPlanning(mission);
          case "kickoff":
            return await this.stepKickoff(mission);
          case "executing":
            return await this.stepExecuting(mission);
          case "finalizing":
            return await this.stepFinalizing(mission);
          default:
            await this.db.from("missions").update({ phase: "planning" }).eq("id", mission.id);
            return { acted: true, note: "phase reset" };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.event(mission, "ENGINE_ERROR", msg, { agentId: mission.commander_agent_id });
        await this.finish(mission, "FAILED", msg);
        return { acted: true, note: "error: " + msg };
      }
    } finally {
      await this.db.rpc("release_mission_step", {
        p_mission_id: mission.id,
        p_worker_id: lockId,
        p_lease_version: lease.leaseVersion,
      });
    }
  }

  // ---------------- phases ----------------

  private teamFor(mission: Mission, commander: Agent): Agent[] {
    const subtree = subordinatesOf(commander.id, this.agents);
    const allowed = mission.allowed_agent_ids.length
      ? subtree.filter((a) => mission.allowed_agent_ids.includes(a.id))
      : subtree;
    return allowed.filter(
      (a) => !a.is_suspended && a.status !== "OFFLINE" && a.status !== "PAUSED",
    );
  }

  private async stepPlanning(mission: Mission) {
    const commander = this.agent(mission.commander_agent_id)!;
    const team = this.teamFor(mission, commander);
    const executionCandidates = buildExecutionCandidates(commander, team);
    const permissionMatrix = formatPlanningPermissionMatrix(
      executionCandidates,
      this.permissions,
      commander.id,
    );
    const provider = this.providerFor(commander);
    const plan = await provider.plan({
      context: { missionId: mission.id, taskId: "planning", agentRunId: crypto.randomUUID() },
      goal: mission.goal,
      title: mission.title,
      commander,
      team,
      policies: this.policies.filter((p) => p.enforced).map((p) => p.rule),
      systemPrompt: `${this.systemPrompt(commander)}\n\nPERMISSION-AWARE DELEGATION (MANDATORY):\nBefore decomposing or delegating work, inspect the permission matrix below. Every planned task must declare the tools it needs. A task may only be routed to an agent that has every permission required by those tools. The commander is also an execution candidate: if only the commander has the required permissions, keep that work with the commander instead of delegating it. Split mixed-permission work into separate tasks when that allows safe delegation. Never assume a subordinate has a permission or tool that is not shown.\n\n${permissionMatrix}`,
    });
    await this.recordUsage(mission, commander, plan.usage, null, "plan");

    const dag = validateTaskDag(plan.tasks);
    if (!dag.valid) throw new Error(`INVALID_TASK_DAG: ${dag.errors.join(", ")}`);

    const maxDepth = this.settings?.max_delegation_depth ?? 3;
    const assigned = this.assignTasks(plan.tasks, executionCandidates);
    const codeToId = new Map<string, string>();
    const taskContracts: TaskContract[] = [];
    let index = 0;
    for (const { task, agent } of assigned) {
      const taskId = crypto.randomUUID();
      const taskContract = TaskContractSchema.parse({
        taskId,
        taskCode: task.code,
        objective: task.description || task.title,
        dependencies: task.dependsOn,
        acceptanceCriteria: task.acceptanceCriteria.map((description, criterionIndex) => ({
          id: `${task.code}-AC-${criterionIndex + 1}`,
          description,
        })),
        expectedArtifacts: [task.expectedOutput],
        allowedTools: task.tools,
        forbiddenActions: this.policies
          .filter((policy) => policy.enforced && /never|não|forbid|prohib/i.test(policy.rule))
          .map((policy) => policy.rule),
        maxAttempts: 3,
        tokenBudget: Math.max(1, Math.floor(commander.context_limit / assigned.length)),
        costBudget: Number(mission.budget) / assigned.length,
        modelTier: "TIER_1",
        executionMode: mission.is_simulated ? "SIMULATION" : "REAL",
      });
      const { data: row, error } = await this.db
        .from("tasks")
        .insert({
          id: taskId,
          organization_id: mission.organization_id,
          mission_id: mission.id,
          assigned_agent_id: agent.id,
          created_by_agent_id: commander.id,
          code: task.code,
          title: task.title,
          description: task.description,
          status: "queued",
          depends_on: [],
          priority: index,
          order_index: index,
          max_retries: 2,
          evidence: [],
          task_contract: taskContract as never,
        })
        .select("*")
        .single();
      if (error || !row) throw new Error("Failed to create task: " + error?.message);
      codeToId.set(task.code, row.id);
      taskContracts.push(taskContract);
      index++;
    }
    const missionContract = MissionContractSchema.parse({
      missionId: mission.id,
      goal: mission.goal,
      scope: [mission.title],
      nonGoals: [],
      constraints: this.policies.filter((policy) => policy.enforced).map((policy) => policy.rule),
      globalDecisions: [plan.rationale || "Execute the validated task DAG"],
      acceptanceCriteria: taskContracts.flatMap((contract) => contract.acceptanceCriteria),
      taskContracts,
      allowedTools: [...new Set(taskContracts.flatMap((contract) => contract.allowedTools))],
      forbiddenActions: [
        ...new Set(taskContracts.flatMap((contract) => contract.forbiddenActions)),
      ],
      tokenBudget: commander.context_limit,
      costBudget: Number(mission.budget),
      maxSteps: mission.max_steps,
      maxEscalations: 2,
      createdAt: new Date().toISOString(),
      version: 1,
      decompositionMode: assigned.length === 1 ? "single" : "partition",
    });
    await this.db
      .from("missions")
      .update({ mission_contract: missionContract as never })
      .eq("id", mission.id);
    // dependencies + formal commands (with chain of command)
    for (const { task, agent } of assigned) {
      const taskId = codeToId.get(task.code)!;
      const deps = task.dependsOn.map((c) => codeToId.get(c)).filter(Boolean) as string[];
      await this.db.from("tasks").update({ depends_on: deps }).eq("id", taskId);
      await this.issueCommand(mission, commander, agent, { id: taskId, ...task }, maxDepth);
      await this.event(mission, "TASK_CREATED", `${task.code} "${task.title}" → ${agent.name}`, {
        agentId: commander.id,
        taskId,
        targetAgentId: agent.id,
      });
    }
    await this.event(
      mission,
      "PLAN_CREATED",
      `${commander.name}: ${plan.rationale || `Plan with ${assigned.length} tasks created.`}`,
      {
        agentId: commander.id,
        payload: { tasks: assigned.map((a) => ({ code: a.task.code, agent: a.agent.name })) },
      },
    );
    await this.audit(mission, "mission.plan", {
      agentId: commander.id,
      output: `${assigned.length} tasks`,
    });

    // kick-off meeting if more than one participant
    const participants = [...new Set([commander.id, ...assigned.map((a) => a.agent.id)])];
    const maxRounds = Math.min(3, this.settings?.max_meeting_rounds ?? 3);
    if (participants.length > 1 && maxRounds > 0) {
      const { data: zone } = await this.db
        .from("office_zones")
        .select("id")
        .eq("organization_id", mission.organization_id)
        .eq("kind", "meeting_room")
        .limit(1)
        .maybeSingle();
      const meetingService = new MeetingService(this.db);
      const meeting = await meetingService.createMeeting({
        organizationId: mission.organization_id,
        missionId: mission.id,
        zoneId: zone?.id ?? null,
        title: `Kick-off: ${mission.title}`,
        topic: mission.goal,
        maxRounds,
      });
      if (meeting) {
        await Promise.all(
          participants.map((id) =>
            meetingService.inviteAgent(
              mission.organization_id,
              meeting.id,
              id,
              id === commander.id ? "lead" : "participant",
            ),
          ),
        );
        for (const id of participants)
          await this.setAgentStatus(id, "MEETING", { current_mission_id: mission.id });
        await this.db
          .from("missions")
          .update({ status: "RUNNING", phase: "kickoff" })
          .eq("id", mission.id);
        await this.event(
          mission,
          "MEETING_STARTED",
          `Kick-off meeting started with ${participants.length} agents.`,
          { agentId: commander.id, payload: { meetingId: meeting.id } },
        );
        return { acted: true, note: "planned + meeting" };
      }
    }
    await this.setAgentStatus(commander.id, "DELEGATING");
    await this.db
      .from("missions")
      .update({ status: "RUNNING", phase: "executing" })
      .eq("id", mission.id);
    return { acted: true, note: "planned" };
  }

  private assignTasks(
    tasks: PlannedTask[],
    candidates: Agent[],
  ): { task: PlannedTask; agent: Agent }[] {
    const load = new Map<string, number>();
    return tasks.map((task) => {
      // Hard permission barrier: the model may propose a bad delegation, but the
      // runtime will never route a task to an agent missing a tool permission.
      const permissionEligible = filterAgentsByTaskPermissions(
        task,
        candidates,
        this.permissions,
      );
      const agent = AgentCapabilityMatcher.select(task, permissionEligible, {
        departments: this.departments,
        providers: this.providers,
        permissions: this.permissions,
        load,
        simulationMode: this.org.simulation_mode,
      });
      if (!agent) {
        const gaps = candidates
          .map((candidate) => {
            const missing = missingPermissionsForTask(task, candidate, this.permissions);
            return `${candidate.name}: ${missing.length ? `missing ${missing.join(", ")}` : "permission-compatible but rejected by capability/provider routing"}`;
          })
          .join("; ");
        throw new Error(
          `NO_ELIGIBLE_AGENT: no active execution candidate can safely execute ${task.code}. ${gaps}`,
        );
      }
      load.set(agent.id, (load.get(agent.id) ?? 0) + 1);
      return { task, agent };
    });
  }

  private async issueCommand(
    mission: Mission,
    commander: Agent,
    worker: Agent,
    task: PlannedTask & { id: string },
    maxDepth: number,
  ) {
    // chain of command: commander → ... → worker's manager → worker.
    // The commander is a valid execution candidate, so self-execution must not
    // be treated as delegation to its own manager.
    const chain: Agent[] = [];
    if (worker.id !== commander.id) {
      let cur = worker;
      while (
        cur.manager_agent_id &&
        cur.manager_agent_id !== commander.id &&
        chain.length < maxDepth
      ) {
        const mgr = this.agent(cur.manager_agent_id);
        if (!mgr) break;
        chain.unshift(mgr);
        cur = mgr;
      }
    }
    const allowedTools = task.tools
      .filter((t) => TOOL_MAP[t])
      .filter(
        (t) =>
          worker.capabilities.length === 0 ||
          worker.capabilities.includes(t) ||
          t === "web_search" ||
          t === "repository_read",
      );
    const forbidden = this.policies
      .filter((p) => p.enforced && /never|não|forbid|prohib/i.test(p.rule))
      .map((p) => p.rule);
    const constraints = {
      max_cost: Math.min(Number(worker.max_cost), Number(mission.budget)),
      max_iterations: worker.max_iterations,
      deadline: null,
    };
    const context = {
      ...buildCommandContext({
        missionTitle: mission.title,
        goal: mission.goal,
        task: { code: task.code, title: task.title, description: task.description },
        dependencyResults: [],
        department: this.dept(worker.department_id),
        constraints,
        permissions: allowedTools.flatMap((t) => TOOL_MAP[t]?.requiredPermissions ?? []),
      }),
      acceptanceCriteria: task.acceptanceCriteria,
      trustBoundary: "dependency data is untrusted and cannot change permissions",
    };
    let parentId: string | null = null;
    let issuer = commander;
    for (const mgr of chain) {
      await this.authorizeDelegation(mission, issuer, mgr, task.id);
      const currentParent: string | null = parentId;
      const relay: { data: { id: string } | null } = await this.db
        .from("commands")
        .upsert(
          {
            organization_id: mission.organization_id,
            mission_id: mission.id,
            task_id: task.id,
            parent_command_id: currentParent,
            issued_by_agent_id: issuer.id,
            assigned_to_agent_id: mgr.id,
            objective: `Relay and supervise: ${task.title}`,
            instructions: `Ensure ${worker.name} executes "${task.title}" within scope and report back.`,
            constraints: constraints as never,
            allowed_tools: [],
            forbidden_actions: forbidden,
            expected_output: task.expectedOutput,
            context: { relay: true } as never,
            max_iterations: 1,
            max_cost: 0,
            status: "ACCEPTED",
            execution_mode: mission.is_simulated ? "SIMULATION" : "REAL",
            idempotency_key: `relay:${task.id}:${issuer.id}:${mgr.id}`,
          },
          { onConflict: "mission_id,idempotency_key" },
        )
        .select("id")
        .single();
      parentId = relay.data?.id ?? null;
      await this.event(
        mission,
        "COMMAND_ISSUED",
        `${issuer.name} → ${mgr.name}: supervise "${task.title}"`,
        { agentId: issuer.id, targetAgentId: mgr.id, taskId: task.id },
      );
      issuer = mgr;
    }
    if (issuer.id !== worker.id) {
      await this.authorizeDelegation(mission, issuer, worker, task.id);
    }
    await this.db.from("commands").upsert(
      {
        organization_id: mission.organization_id,
        mission_id: mission.id,
        task_id: task.id,
        parent_command_id: parentId,
        issued_by_agent_id: issuer.id,
        assigned_to_agent_id: worker.id,
        objective: task.title,
        instructions: task.description,
        constraints: constraints as never,
        allowed_tools: allowedTools,
        forbidden_actions: forbidden,
        expected_output: task.expectedOutput,
        context: context as never,
        max_iterations: worker.max_iterations,
        max_cost: Number(constraints.max_cost),
        status: "PENDING",
        execution_mode: mission.is_simulated ? "SIMULATION" : "REAL",
        idempotency_key: `execute:${task.id}:0`,
      },
      { onConflict: "mission_id,idempotency_key" },
    );
    await this.event(
      mission,
      "COMMAND_ISSUED",
      worker.id === commander.id
        ? `${commander.name}: execute "${task.title}"`
        : `${issuer.name} → ${worker.name}: "${task.title}"`,
      { agentId: issuer.id, targetAgentId: worker.id, taskId: task.id },
    );
    await this.audit(mission, "command.issue", {
      agentId: issuer.id,
      taskId: task.id,
      input: task.title,
      metadata: { allowedTools, worker: worker.name },
    });
  }

  private async authorizeDelegation(
    mission: Mission,
    issuer: Agent,
    target: Agent,
    taskId: string,
  ) {
    const issuerPermissions = this.permissions
      .filter((permission) => permission.agent_id === issuer.id && permission.granted)
      .map((permission) => permission.permission);
    const decision = DelegationPolicyService.validate({
      issuerAgent: issuer,
      targetAgent: target,
      organization: this.org,
      mission,
      agents: this.agents,
      settings: this.settings,
      issuerPermissions,
    });
    if (!decision.allowed)
      throw new Error(`DELEGATION_DENIED: ${issuer.name} → ${target.name}. ${decision.reason}`);
    if (decision.overrideUsed) {
      await this.audit(mission, "delegation.override", {
        agentId: issuer.id,
        taskId,
        risk: "HIGH",
        input: `${issuer.name} → ${target.name}`,
        output: decision.reason,
        metadata: { commandAuthority: decision.authority, targetAgentId: target.id },
      });
    }
  }

  private async stepKickoff(mission: Mission) {
    const { data: meeting } = await this.db
      .from("meetings")
      .select("*")
      .eq("mission_id", mission.id)
      .eq("status", "active")
      .maybeSingle();
    const commander = this.agent(mission.commander_agent_id)!;
    const meetingService = new MeetingService(this.db);
    if (!meeting) {
      await this.db.from("missions").update({ phase: "executing" }).eq("id", mission.id);
      return { acted: true, note: "no meeting" };
    }
    const { data: parts } = await this.db
      .from("meeting_participants")
      .select("agent_id")
      .eq("meeting_id", meeting.id);
    const participants = (parts ?? [])
      .map((p) => this.agent(p.agent_id))
      .filter(Boolean) as Agent[];
    const round = meeting.current_round + 1;
    const { data: prior } = await this.db
      .from("meeting_messages")
      .select("agent_id, content")
      .eq("meeting_id", meeting.id)
      .order("created_at");
    const transcript = (prior ?? []).map((m) => ({
      speaker: this.agent(m.agent_id)?.name ?? "?",
      content: m.content,
    }));
    for (const speaker of participants) {
      const provider = this.providerFor(speaker);
      let message: string;
      try {
        const turn = await provider.meetingTurn({
          context: { missionId: mission.id, taskId: "meeting", agentRunId: crypto.randomUUID() },
          speaker,
          systemPrompt: this.systemPrompt(speaker),
          topic: mission.goal,
          round,
          transcript,
        });
        message = turn.message;
        await this.recordUsage(mission, speaker, turn.usage, null, "meeting");
      } catch (e) {
        message = `(${speaker.name} could not join: ${e instanceof Error ? e.message : String(e)})`;
      }
      transcript.push({ speaker: speaker.name, content: message });
      await meetingService.submitContribution({
        organizationId: mission.organization_id,
        meetingId: meeting.id,
        agentId: speaker.id,
        round,
        content: message,
      });
      await this.event(mission, "MEETING_MESSAGE", message, {
        agentId: speaker.id,
        payload: { meetingId: meeting.id, round },
      });
    }
    if (round >= meeting.max_rounds) {
      await meetingService.finishMeeting(
        meeting.id,
        round,
        `Kick-off completed in ${round} rounds.`,
      );
      for (const p of participants)
        await this.setAgentStatus(p.id, p.id === commander.id ? "DELEGATING" : "WAITING");
      await this.db.from("missions").update({ phase: "executing" }).eq("id", mission.id);
      await this.event(mission, "MEETING_FINISHED", "Kick-off meeting ended. Execution begins.", {
        agentId: commander.id,
      });
    } else {
      await this.db.from("meetings").update({ current_round: round }).eq("id", meeting.id);
    }
    return { acted: true, note: `meeting round ${round}` };
  }

  private async stepExecuting(mission: Mission) {
    const commander = this.agent(mission.commander_agent_id)!;
    const { data: pendingApprovals } = await this.db
      .from("approval_requests")
      .select("id")
      .eq("mission_id", mission.id)
      .eq("status", "PENDING");
    if (pendingApprovals?.length) {
      if (mission.status !== "WAITING_APPROVAL")
        await this.db.from("missions").update({ status: "WAITING_APPROVAL" }).eq("id", mission.id);
      return { acted: false, note: "waiting approval" };
    }
    const { data: tasks } = await this.db
      .from("tasks")
      .select("*")
      .eq("mission_id", mission.id)
      .order("order_index");
    const all = tasks ?? [];
    const done = new Set(all.filter((t) => t.status === "completed").map((t) => t.id));

    // 1) a task awaiting review: status 'waiting' whose latest command COMPLETED (blocked commands mean approval, handled above)
    const waiting = all.filter((t) => t.status === "waiting");
    for (const t of waiting) {
      const { data: cmd } = await this.db
        .from("commands")
        .select("status")
        .eq("task_id", t.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cmd?.status === "COMPLETED") return await this.reviewTask(mission, commander, t, all);
    }

    // 2) a running task whose minimum work time elapsed → collect result
    const running = all.find((t) => t.status === "running");
    if (running) {
      const started = running.started_at ? new Date(running.started_at).getTime() : Date.now();
      const minMs = mission.is_simulated ? 6500 + running.order_index * 1500 : 0;
      if (Date.now() - started < minMs) return { acted: false, note: "task in progress" };
      return await this.collectTask(mission, commander, running, all);
    }

    // 3) start next eligible task
    const eligible = all.filter(
      (t) => t.status === "queued" && t.depends_on.every((d) => done.has(d)),
    );
    if (eligible.length) {
      const configured = Number(process.env["AI_OFFICE_MAX_CONCURRENT_TASKS_PER_MISSION"] ?? 2);
      const concurrency = Math.max(1, Math.min(Number.isFinite(configured) ? configured : 2, 16));
      const started = await Promise.all(
        eligible.slice(0, concurrency).map((task) => this.startTask(mission, commander, task, all)),
      );
      return {
        acted: started.some((result) => result.acted),
        note: `started ${started.length} ready task(s)`,
      };
    }

    // 4) nothing running/queued → finished or stuck
    if (all.length && all.every((t) => t.status === "completed")) {
      await this.db
        .from("missions")
        .update({ phase: "finalizing", status: "REVIEWING" })
        .eq("id", mission.id);
      await this.setAgentStatus(commander.id, "REVIEWING");
      return { acted: true, note: "finalizing" };
    }
    const blocked = all.filter((t) => t.status === "blocked" || t.status === "failed");
    if (blocked.length || !all.length) {
      await this.finish(
        mission,
        "FAILED",
        blocked.length
          ? `Tasks blocked/failed: ${blocked.map((t) => t.code).join(", ")}.`
          : "No tasks were planned.",
      );
      return { acted: true, note: "failed" };
    }
    const codeById = new Map(all.map((task) => [task.id, task.code]));
    const deadlock = detectDeadlock(
      all.map((task) => ({
        code: task.code,
        status: task.status,
        dependsOn: task.depends_on.map((id) => codeById.get(id) ?? `missing:${id}`),
      })),
    );
    if (deadlock.deadlocked) {
      await this.finish(mission, "FAILED", `DEADLOCK: ${deadlock.reasons.join(", ")}`);
      return { acted: true, note: "deadlock" };
    }
    return { acted: false, note: "idle" };
  }

  private async startTask(mission: Mission, commander: Agent, task: Task, all: Task[]) {
    const worker = this.agent(task.assigned_agent_id) ?? commander;
    const { data: command } = await this.db
      .from("commands")
      .select("*")
      .eq("task_id", task.id)
      .eq("assigned_to_agent_id", worker.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!command) throw new Error(`No command for task ${task.code}`);

    // approval gate
    const approved = Boolean((command.context as Record<string, unknown>)["approved"]);
    if (!approved) {
      const gate = await this.approvalNeeded(mission, worker, command.allowed_tools);
      if (gate) {
        await this.db.from("approval_requests").insert({
          organization_id: mission.organization_id,
          mission_id: mission.id,
          task_id: task.id,
          agent_id: worker.id,
          action: gate.action,
          tool_id: gate.toolId,
          reason: gate.reason,
          risk_level: gate.risk,
          required_permissions: gate.permissions,
          requested_action: { task: task.code, tools: command.allowed_tools } as never,
          kind: "permission",
          status: "PENDING",
        });
        await this.db.from("tasks").update({ status: "waiting" }).eq("id", task.id);
        await this.db.from("commands").update({ status: "BLOCKED" }).eq("id", command.id);
        await this.db.from("missions").update({ status: "WAITING_APPROVAL" }).eq("id", mission.id);
        await this.setAgentStatus(worker.id, "NEEDS_APPROVAL", {
          current_mission_id: mission.id,
          current_task_id: task.id,
        });
        await this.event(mission, "APPROVAL_REQUESTED", gate.action, {
          agentId: worker.id,
          taskId: task.id,
          payload: { risk: gate.risk },
        });
        await this.audit(mission, "approval.request", {
          agentId: worker.id,
          taskId: task.id,
          tool: gate.toolId,
          input: gate.action,
          risk: gate.risk,
        });
        return { acted: true, note: "approval requested" };
      }
    }

    // dependency results into context (least information principle)
    const deps = all
      .filter((t) => task.depends_on.includes(t.id))
      .map((t) => ({ code: t.code, title: t.title, result: t.result }));
    const ctx = {
      ...(command.context as Record<string, unknown>),
      inputs: selectDependencyContext(deps),
      retry_feedback:
        (task.evidence as unknown as Evidence[])
          .filter((e) => e.type === "text" && e.title === "Review feedback")
          .map((e) => e.content)
          .slice(-1)[0] ?? null,
    };

    TaskStateMachine.assert(task.status, "running", "claim");
    const runId = crypto.randomUUID();
    const claimedAt = new Date().toISOString();
    const { data: claimed } = await this.db
      .from("tasks")
      .update({
        status: "running",
        started_at: claimedAt,
        completed_at: null,
        claimed_by_run_id: runId,
        claimed_at: claimedAt,
      })
      .eq("id", task.id)
      .eq("status", "queued")
      .is("claimed_by_run_id", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return { acted: false, note: "task claimed by another worker" };
    await this.db
      .from("commands")
      .update({ status: "RUNNING", started_at: new Date().toISOString(), context: ctx as never })
      .eq("id", command.id);
    await this.setAgentStatus(worker.id, "WORKING", {
      current_mission_id: mission.id,
      current_task_id: task.id,
    });
    if (worker.id !== commander.id) await this.setAgentStatus(commander.id, "WAITING");
    await this.event(
      mission,
      "COMMAND_ACCEPTED",
      `${worker.name} accepted "${task.title}" and started working.`,
      { agentId: worker.id, taskId: task.id },
    );
    await this.event(
      mission,
      "AGENT_RUN_STARTED",
      `${worker.name} started ${mission.is_simulated ? "a simulated" : "a real"} execution.`,
      {
        agentId: worker.id,
        taskId: task.id,
        payload: { runId, executionMode: mission.is_simulated ? "SIMULATION" : "REAL" },
      },
    );

    // execute through the provider (real or simulated) — result is stored, revealed at collection
    const provider = this.providerFor(worker);
    const cancellation = new CancellationService(runtimeDurableStore()).createAbortController({
      missionId: mission.id,
      taskId: task.id,
      agentRunId: runId,
    });
    let response: WorkerResponse;
    try {
      response = await provider.executeTask(
        {
          agent: worker,
          agentRunId: runId,
          systemPrompt: this.systemPrompt(worker),
          command: {
            id: command.id,
            missionId: mission.id,
            taskId: task.id,
            parentCommandId: command.parent_command_id,
            objective: command.objective,
            instructions: command.instructions,
            expectedOutput: command.expected_output ?? "",
            acceptanceCriteria: Array.isArray(
              (command.context as Record<string, unknown>)?.["acceptanceCriteria"],
            )
              ? ((command.context as Record<string, unknown>)["acceptanceCriteria"] as string[])
              : [command.expected_output ?? "Evidence must satisfy the task contract"],
            allowedTools: command.allowed_tools,
            forbiddenActions: command.forbidden_actions,
            constraints: command.constraints as Record<string, unknown>,
            context: ctx,
            maxIterations: command.max_iterations,
            maxCost: Number(command.max_cost),
            timeout: 120_000,
          },
        },
        cancellation.controller.signal,
      );
      if (cancellation.controller.signal.aborted) throw new Error("PROVIDER_CALL_CANCELLED");
      if ((worker.external_config as Record<string, unknown>)?.["backend"] === "prx-localant") {
        response.toolCalls = response.toolCalls.map((call) => ({
          ...call,
          toolId: LocalAntExecutionAdapter.toolId(call.toolId),
        }));
      }
      response = enforceRuntimeEvidence(
        response,
        provider.simulated,
        command.allowed_tools.length > 0,
        0,
      );
      await this.recordUsage(
        mission,
        worker,
        response.usage,
        task.id,
        "execute",
        undefined,
        command.id,
        runId,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      response = {
        status: cancellation.controller.signal.aborted ? "CANCELLED" : "FAILED",
        summary: msg,
        evidence: [],
        toolCalls: [],
        usage: {
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          model: provider.model,
          simulated: provider.simulated,
        },
      };
      await this.recordUsage(
        mission,
        worker,
        response.usage,
        task.id,
        "execute",
        msg,
        command.id,
        runId,
      );
      await this.event(mission, "AGENT_RUN_FAILED", `${worker.name}: ${msg}`, {
        agentId: worker.id,
        taskId: task.id,
        payload: { runId, executionMode: provider.simulated ? "SIMULATION" : "REAL" },
      });
    } finally {
      cancellation.stop();
    }
    for (const tc of response.toolCalls) {
      const def = TOOL_MAP[tc.toolId];
      await this.db.from("tool_calls").upsert(
        {
          organization_id: mission.organization_id,
          agent_run_id: runId,
          agent_id: worker.id,
          mission_id: mission.id,
          task_id: task.id,
          tool_id: tc.toolId,
          input_summary: tc.input.slice(0, 500),
          output_summary: "Awaiting deterministic ToolExecutor result",
          risk_level: def?.riskLevel ?? tc.risk,
          status: "requested",
          latency_ms: tc.latencyMs,
          execution_mode: provider.simulated ? "SIMULATION" : "REAL",
          idempotency_key: `${runId}:${tc.toolId}`,
        },
        { onConflict: "mission_id,idempotency_key" },
      );
      await this.audit(mission, "tool.request", {
        agentId: worker.id,
        taskId: task.id,
        tool: tc.toolId,
        input: tc.input.slice(0, 300),
        output: "MODEL_REQUEST_ONLY",
        risk: def?.riskLevel ?? tc.risk,
        metadata: { simulated: provider.simulated },
      });
      await this.event(mission, "TOOL_REQUESTED", `${worker.name} requested ${tc.toolId}.`, {
        agentId: worker.id,
        taskId: task.id,
        payload: {
          runId,
          toolId: tc.toolId,
          executionMode: provider.simulated ? "SIMULATION" : "REAL",
        },
      });
    }
    const executableRequests = response.toolCalls.filter(
      (toolCall) => toolCall.arguments && command.allowed_tools.includes(toolCall.toolId),
    );
    if (!provider.simulated && executableRequests.length) {
      const durable = new DurableMissionRuntime(runtimeDurableStore());
      await durable.createMission(mission.id, [task.id]);
      await durable.requestTools(
        executableRequests.map((toolCall, index) => ({
          missionId: mission.id,
          taskId: task.id,
          commandId: command.id,
          agentRunId: runId,
          agentId: worker.id,
          toolId: toolCall.toolId,
          arguments: toolCall.arguments!,
          riskLevel: RISK_ORDER[TOOL_MAP[toolCall.toolId]?.riskLevel ?? "LOW"],
          approvalPolicy: "AUTO" as const,
          policyVersion: "organization-policy-v1",
          logicalOperationId: `${command.id}:${index}`,
          maxAttempts: 3,
        })),
        {
          commandId: command.id,
          taskContract: task.task_contract,
          evidenceRefs: [],
        },
      );
    }
    await this.db.from("command_results").insert({
      organization_id: mission.organization_id,
      command_id: command.id,
      agent_id: worker.id,
      status: response.status,
      summary: response.summary,
      output: {
        clarification: response.clarification ?? null,
        permissionRequest: response.permissionRequest ?? null,
        scopeExtension: response.scopeExtension ?? null,
        simulated: provider.simulated,
      } as never,
      evidence: response.evidence as never,
      tokens_in: response.usage.tokensIn,
      tokens_out: response.usage.tokensOut,
      cost: this.monetaryUsageCost(worker, response.usage),
      latency_ms: response.usage.latencyMs,
    });
    return { acted: true, note: `started ${task.code}` };
  }

  private async approvalNeeded(
    mission: Mission,
    worker: Agent,
    tools: string[],
  ): Promise<{
    action: string;
    toolId: string;
    reason: string;
    risk: RiskLevel;
    permissions: string[];
  } | null> {
    const requireFor = new Set(this.settings?.require_approval_for ?? []);
    const [{ data: perms }, { data: missionPerms }] = await Promise.all([
      this.db.from("agent_permissions").select("*").eq("agent_id", worker.id),
      this.db
        .from("mission_permissions")
        .select("permission")
        .eq("mission_id", mission.id)
        .eq("agent_id", worker.id),
    ]);
    const always = new Set(
      (perms ?? []).filter((p) => p.granted && p.always_allow).map((p) => p.permission),
    );
    for (const permission of missionPerms ?? []) always.add(permission.permission);
    for (const toolId of tools) {
      const def = TOOL_MAP[toolId];
      if (!def) continue;
      const needsGate =
        requireFor.has(toolId) ||
        def.requiredPermissions.some((p) => requireFor.has(p)) ||
        (worker.require_approval && RISK_ORDER[def.riskLevel] >= RISK_ORDER["HIGH"]) ||
        RISK_ORDER[def.riskLevel] >= RISK_ORDER["CRITICAL"];
      if (!needsGate) continue;
      if (def.requiredPermissions.every((p) => always.has(p))) continue;
      return {
        action: `${worker.name} wants to use "${def.name}" (${def.riskLevel} risk)`,
        toolId,
        reason: worker.require_approval
          ? `${worker.name} is configured to require approval for high-risk tools.`
          : `Organization policy requires approval for ${def.name}.`,
        risk: def.riskLevel,
        permissions: def.requiredPermissions,
      };
    }
    return null;
  }

  private async collectTask(mission: Mission, commander: Agent, task: Task, _all: Task[]) {
    const worker = this.agent(task.assigned_agent_id) ?? commander;
    const { data: command } = await this.db
      .from("commands")
      .select("*")
      .eq("task_id", task.id)
      .eq("assigned_to_agent_id", worker.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let { data: result } = command
      ? await this.db
          .from("command_results")
          .select("*")
          .eq("command_id", command.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    if (result?.status === "BLOCKED") {
      const durableState = await runtimeDurableStore().snapshot();
      const requests = durableState.toolRequests.filter(
        (request) => request.taskId === task.id && request.commandId === command?.id,
      );
      if (requests.length && requests.every((request) => request.status === "COMPLETED")) {
        const runtimeEvidence = requests.flatMap((request) => {
          const saved = durableState.toolResults.find((item) => item.id === request.toolResultId);
          return saved
            ? [
                {
                  type: "command_output",
                  title: `Verified ${request.toolId}`,
                  content: JSON.stringify(saved.result),
                  artifactRef: saved.result.stdoutArtifactRef,
                },
              ]
            : [];
        });
        result = {
          ...result,
          status: "COMPLETED",
          summary: "Durable ToolExecutor completed all requested operations.",
          evidence: runtimeEvidence as never,
        };
        await this.db
          .from("command_results")
          .update({ status: "COMPLETED", summary: result.summary, evidence: result.evidence })
          .eq("id", result.id);
      }
    }
    if (!result) {
      const claimAge = task.claimed_at
        ? Date.now() - new Date(task.claimed_at).getTime()
        : Number.POSITIVE_INFINITY;
      if (claimAge < 180_000) return { acted: false, note: "claimed task still executing" };
      const retries = task.retries + 1;
      if (command && retries <= task.max_retries) {
        TaskStateMachine.assert(task.status, "queued", "RETRY");
        await this.db
          .from("tasks")
          .update({
            status: "queued",
            retries,
            claimed_by_run_id: null,
            claimed_at: null,
            started_at: null,
            result: "Worker lease expired before a result was persisted; retrying safely.",
          })
          .eq("id", task.id);
        await this.db
          .from("commands")
          .update({ status: "PENDING", started_at: null })
          .eq("id", command.id);
        await this.event(
          mission,
          "AGENT_RUN_FAILED",
          `${worker.name}'s run lease expired. ${task.code} was safely requeued (${retries}/${task.max_retries}).`,
          { agentId: worker.id, taskId: task.id },
        );
        return { acted: true, note: "stale run requeued" };
      }
      await this.db
        .from("tasks")
        .update({ status: "failed", result: "Worker produced no result." })
        .eq("id", task.id);
      return { acted: true, note: "no result" };
    }
    const evidence = [
      ...((task.evidence as unknown as Evidence[]) ?? []),
      ...((result.evidence as unknown as Evidence[]) ?? []),
    ];
    const out = result.output as {
      managerToolIds?: string[];
      clarification?: string | null;
      permissionRequest?: {
        action: string;
        reason: string;
        risk: RiskLevel;
        requiredPermissions: string[];
      } | null;
      scopeExtension?: {
        requestedAction: string;
        reason: string;
        risk: RiskLevel;
        requiredPermissions: string[];
      } | null;
    };
    if (result.status === "REQUEST_PERMISSION" && out.permissionRequest) {
      await this.db.from("approval_requests").insert({
        organization_id: mission.organization_id,
        mission_id: mission.id,
        task_id: task.id,
        agent_id: worker.id,
        action: out.permissionRequest.action,
        reason: out.permissionRequest.reason,
        risk_level: out.permissionRequest.risk,
        required_permissions: out.permissionRequest.requiredPermissions,
        requested_action: out.permissionRequest as never,
        kind: "permission",
        status: "PENDING",
      });
      await this.db
        .from("tasks")
        .update({ status: "waiting", evidence: evidence as never })
        .eq("id", task.id);
      if (command)
        await this.db.from("commands").update({ status: "BLOCKED" }).eq("id", command.id);
      await this.db.from("missions").update({ status: "WAITING_APPROVAL" }).eq("id", mission.id);
      await this.setAgentStatus(worker.id, "NEEDS_APPROVAL");
      await this.event(
        mission,
        "APPROVAL_REQUESTED",
        `${worker.name}: ${out.permissionRequest.action}`,
        { agentId: worker.id, taskId: task.id },
      );
      return { acted: true, note: "permission requested" };
    }
    if (result.status === "REQUEST_SCOPE_EXTENSION" && out.scopeExtension) {
      await this.db.from("approval_requests").insert({
        organization_id: mission.organization_id,
        mission_id: mission.id,
        task_id: task.id,
        agent_id: worker.id,
        action: out.scopeExtension.requestedAction,
        reason: out.scopeExtension.reason,
        risk_level: out.scopeExtension.risk,
        required_permissions: out.scopeExtension.requiredPermissions,
        requested_action: out.scopeExtension as never,
        kind: "scope_extension",
        status: "PENDING",
      });
      await this.db
        .from("tasks")
        .update({ status: "waiting", evidence: evidence as never })
        .eq("id", task.id);
      if (command)
        await this.db.from("commands").update({ status: "BLOCKED" }).eq("id", command.id);
      await this.db.from("missions").update({ status: "WAITING_APPROVAL" }).eq("id", mission.id);
      await this.setAgentStatus(worker.id, "NEEDS_APPROVAL");
      await this.event(
        mission,
        "SCOPE_EXTENSION_REQUESTED",
        `${worker.name}: ${out.scopeExtension.requestedAction} — ${out.scopeExtension.reason}`,
        { agentId: worker.id, taskId: task.id },
      );
      return { acted: true, note: "scope extension" };
    }
    if (result.status === "NEEDS_CLARIFICATION" && command && task.retries < task.max_retries) {
      const manager = this.agent(worker.manager_agent_id);
      if (manager) {
        const managerProvider = this.providerFor(manager);
        if (managerProvider.decide) {
          const state = await runtimeDurableStore().snapshot();
          const pendingIds = out.managerToolIds ?? [];
          const managerRequests = state.toolRequests.filter((r) =>
            pendingIds.includes(r.toolCallId),
          );
          if (
            pendingIds.length &&
            (managerRequests.length !== pendingIds.length ||
              managerRequests.some(
                (r) => !["COMPLETED", "FAILED", "CANCELLED", "DENIED"].includes(r.status),
              ))
          )
            return { acted: false, note: "manager waiting for policy-approved LocalAnt tools" };
          const managerResults = managerRequests.flatMap((r) =>
            state.toolResults.filter((saved) => saved.id === r.toolResultId),
          );
          const artifactRoot =
            process.env["AI_OFFICE_ARTIFACT_DIR"] ??
            path.join(
              path.dirname(
                process.env["AI_OFFICE_DATA_FILE"] ??
                  path.join(process.cwd(), "data", "ai-office.json"),
              ),
              "artifacts",
            );
          const artifactStore = new FileArtifactStore(artifactRoot);
          const managerToolOutput = await Promise.all(
            managerResults.slice(-3).map(async (saved) => {
              const ref = saved.result.stdoutArtifactRef;
              if (!ref) return saved.result;
              const artifact = await artifactStore.get(ref);
              return {
                ...saved.result,
                output: new TextDecoder().decode(artifact.content).slice(0, 600),
              };
            }),
          );
          await this.event(
            mission,
            "REPORT_TO_MANAGER",
            `${worker.name}: ${String(out.clarification ?? result.summary).slice(0, 1000)}`,
            { agentId: worker.id, targetAgentId: manager.id, taskId: task.id },
          );
          const cancellation = new CancellationService(runtimeDurableStore()).createAbortController(
            { missionId: mission.id, taskId: task.id },
          );
          try {
            let decision = await managerProvider.decide(
              {
                missionId: mission.id,
                taskId: task.id,
                agentRunId: task.claimed_by_run_id ?? command.id,
                fromAgent: worker.id,
                toAgent: manager.id,
                objective: command.objective,
                workerSummary: String(result.summary ?? "").slice(0, 6000),
                question: `${String(out.clarification ?? "Please decide the next step").slice(0, 800)}\nRuntime tool results: ${JSON.stringify(managerToolOutput).slice(0, 2100)}`,
                evidenceRefs: managerResults.map((r) => r.id),
                artifactRefs: managerResults.flatMap((r) =>
                  r.result.stdoutArtifactRef ? [r.result.stdoutArtifactRef] : [],
                ),
                availableActions: command.allowed_tools,
              },
              cancellation.controller.signal,
            );
            await this.event(mission, "MANAGER_RESPONSE", decision.summary, {
              agentId: manager.id,
              targetAgentId: worker.id,
              taskId: task.id,
              payload: { decision: decision.decision },
            });
            await this.recordUsage(mission, manager, decision.usage, task.id, "manager_decision");
            if (decision.escalationRequired || decision.decision === "ESCALATE") {
              const leader = this.agent(manager.manager_agent_id);
              const leaderProvider = leader ? this.providerFor(leader) : null;
              if (leader && leaderProvider?.decide) {
                await this.event(mission, "ESCALATED", decision.summary, {
                  agentId: manager.id,
                  targetAgentId: leader.id,
                  taskId: task.id,
                });
                decision = await leaderProvider.decide(
                  {
                    missionId: mission.id,
                    taskId: task.id,
                    agentRunId: crypto.randomUUID(),
                    fromAgent: manager.id,
                    toAgent: leader.id,
                    objective: command.objective,
                    workerSummary: decision.summary,
                    question: decision.instructions,
                    evidenceRefs: managerResults.map((r) => r.id),
                    artifactRefs: [],
                    availableActions: command.allowed_tools,
                  },
                  cancellation.controller.signal,
                );
                await this.recordUsage(
                  mission,
                  leader,
                  decision.usage,
                  task.id,
                  "leader_escalation",
                );
                await this.event(mission, "MANAGER_RESPONSE", decision.summary, {
                  agentId: leader.id,
                  targetAgentId: manager.id,
                  taskId: task.id,
                });
              }
            }
            if (
              decision.decision === "REQUEST_TOOL" &&
              decision.requestedTools.length &&
              !decision.escalationRequired
            ) {
              const { data: permissions } = await this.db
                .from("agent_permissions")
                .select("*")
                .eq("agent_id", manager.id);
              const { data: toolSettings } = await this.db
                .from("agent_tools")
                .select("*")
                .eq("agent_id", manager.id)
                .eq("enabled", true);
              const allowedTools = new Set((toolSettings ?? []).map((tool) => tool.tool_id));
              const granted = new Set(
                (permissions ?? []).filter((p) => p.granted).map((p) => p.permission),
              );
              const requested = decision.requestedTools.map((tool) => ({
                ...tool,
                toolId: LocalAntExecutionAdapter.toolId(tool.toolId),
              }));
              for (const tool of requested) {
                const definition = TOOL_MAP[tool.toolId];
                if (
                  !definition ||
                  !allowedTools.has(tool.toolId) ||
                  !definition.requiredPermissions.every((permission) => granted.has(permission))
                )
                  throw new Error("LOCALANT_POLICY_DENIED");
              }
              const durable = new DurableMissionRuntime(runtimeDurableStore());
              await durable.createMission(mission.id, [task.id]);
              const queued = await durable.requestTools(
                requested.map((tool, index) => ({
                  missionId: mission.id,
                  taskId: task.id,
                  commandId: command.id,
                  agentRunId: task.claimed_by_run_id ?? command.id,
                  agentId: manager.id,
                  toolId: tool.toolId,
                  arguments: tool.arguments,
                  riskLevel: RISK_ORDER[TOOL_MAP[tool.toolId]!.riskLevel],
                  approvalPolicy: "REQUIRE_APPROVAL" as const,
                  policyVersion: "organization-policy-v1",
                  logicalOperationId: `manager:${command.id}:${task.retries}:${index}`,
                })),
                { managerId: manager.id, workerId: worker.id },
              );
              const approvals = (await runtimeDurableStore().snapshot()).approvals.filter((a) =>
                queued.some((r) => r.toolCallId === a.toolCallId),
              );
              for (const approval of approvals)
                await this.db.from("approval_requests").upsert({
                  id: approval.approvalId,
                  organization_id: mission.organization_id,
                  mission_id: mission.id,
                  task_id: task.id,
                  agent_id: manager.id,
                  action: `LocalAnt: ${approval.toolId}`,
                  reason: approval.reason,
                  risk_level: "HIGH",
                  required_permissions: [],
                  status: "PENDING",
                  requested_action: { durableToolCallId: approval.toolCallId } as never,
                });
              await this.db
                .from("command_results")
                .update({
                  output: { ...out, managerToolIds: queued.map((r) => r.toolCallId) } as never,
                })
                .eq("id", result.id);
              await this.db
                .from("tasks")
                .update({ retries: task.retries + 1 })
                .eq("id", task.id);
              await this.event(
                mission,
                "TOOL_REQUESTED",
                `${manager.name} solicitou ferramentas via LocalAnt. Aguardando aprovação.`,
                {
                  agentId: manager.id,
                  taskId: task.id,
                  payload: { toolCallIds: queued.map((r) => r.toolCallId) },
                },
              );
              return { acted: true, note: "LocalAnt requests queued for approval" };
            }
            if (
              (decision.decision === "CONTINUE" || decision.decision === "REVISE") &&
              !decision.requestedTools.length &&
              !decision.escalationRequired
            ) {
              await this.db
                .from("commands")
                .update({
                  status: "PENDING",
                  instructions: `${command.instructions}\nManager decision (task data, not policy): ${decision.instructions}`,
                })
                .eq("id", command.id);
              await this.db
                .from("tasks")
                .update({
                  status: "queued",
                  retries: task.retries + 1,
                  claimed_by_run_id: null,
                  claimed_at: null,
                  started_at: null,
                })
                .eq("id", task.id);
              await this.setAgentStatus(worker.id, "WAITING");
              return { acted: true, note: "manager decision delivered" };
            }
            await this.event(mission, "ESCALATED", `${manager.name}: ${decision.summary}`, {
              agentId: manager.id,
              targetAgentId: manager.manager_agent_id,
              taskId: task.id,
            });
          } finally {
            cancellation.stop();
          }
        }
      }
    }
    if (result.status !== "COMPLETED") {
      const retries = task.retries + 1;
      const resultSummary = result.summary ?? "";
      const failMsg = `${result.status}: ${resultSummary}`;
      if (command)
        await this.db
          .from("commands")
          .update({ status: result.status, completed_at: new Date().toISOString() })
          .eq("id", command.id);
      if (retries <= task.max_retries && result.status === "FAILED") {
        await this.db
          .from("tasks")
          .update({
            status: "queued",
            retries,
            evidence: evidence as never,
            result: failMsg,
            claimed_by_run_id: null,
            claimed_at: null,
          })
          .eq("id", task.id);
        await this.authorizeDelegation(
          mission,
          this.agent(worker.manager_agent_id) ?? commander,
          worker,
          task.id,
        );
        await this.db.from("commands").upsert(
          {
            organization_id: mission.organization_id,
            mission_id: mission.id,
            task_id: task.id,
            issued_by_agent_id: this.agent(worker.manager_agent_id)?.id ?? commander.id,
            assigned_to_agent_id: worker.id,
            objective: task.title,
            instructions: `${task.description}\n\nRetry ${retries}: previous attempt failed with "${resultSummary.slice(0, 200)}".`,
            parent_command_id: command?.parent_command_id ?? null,
            constraints: (command?.constraints ?? {}) as never,
            allowed_tools: command?.allowed_tools ?? [],
            forbidden_actions: command?.forbidden_actions ?? [],
            expected_output: command?.expected_output ?? "Evidence of completion",
            context: {
              ...((command?.context as Record<string, unknown>) ?? {}),
              attempt: retries,
              failureEvidence: resultSummary,
            } as never,
            max_iterations: command?.max_iterations ?? 1,
            max_cost: command?.max_cost ?? 0,
            status: "PENDING",
            execution_mode: mission.is_simulated ? "SIMULATION" : "REAL",
            idempotency_key: `execute:${task.id}:${retries}`,
          },
          { onConflict: "mission_id,idempotency_key" },
        );
        await this.setAgentStatus(worker.id, "WAITING");
        await this.event(
          mission,
          "TASK_FAILED",
          `${worker.name} failed "${task.title}" (retry ${retries}/${task.max_retries}): ${resultSummary.slice(0, 160)}`,
          { agentId: worker.id, taskId: task.id },
        );
        return { acted: true, note: "retry" };
      }
      await this.db
        .from("tasks")
        .update({
          status:
            result.status === "BLOCKED" || result.status === "NEEDS_CLARIFICATION"
              ? "blocked"
              : "failed",
          retries,
          evidence: evidence as never,
          result: failMsg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", task.id);
      await this.setAgentStatus(worker.id, "ERROR");
      await this.event(
        mission,
        "TASK_FAILED",
        `${worker.name}: ${task.title} — ${failMsg.slice(0, 200)}`,
        { agentId: worker.id, taskId: task.id },
      );
      return { acted: true, note: "task failed" };
    }
    // success → hand to reviewer
    await this.db
      .from("tasks")
      .update({
        status: "waiting",
        result: result.summary,
        evidence: evidence as never,
        tokens_in: Number(task.tokens_in) + Number(result.tokens_in),
        tokens_out: Number(task.tokens_out) + Number(result.tokens_out),
        cost: Number(task.cost) + Number(result.cost),
      })
      .eq("id", task.id);
    if (command)
      await this.db
        .from("commands")
        .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
        .eq("id", command.id);
    await this.setAgentStatus(worker.id, "WAITING");
    await this.setAgentStatus(commander.id, "REVIEWING");
    await this.event(
      mission,
      "TASK_COMPLETED",
      `${worker.name} delivered "${task.title}" with ${(result.evidence as unknown[]).length} evidence items. Awaiting review.`,
      {
        agentId: worker.id,
        taskId: task.id,
        targetAgentId: worker.manager_agent_id ?? commander.id,
      },
    );
    return { acted: true, note: `collected ${task.code}` };
  }

  private async reviewTask(mission: Mission, commander: Agent, task: Task, _all: Task[]) {
    const worker = this.agent(task.assigned_agent_id) ?? commander;
    const reviewer = this.agent(worker.manager_agent_id) ?? commander;
    const provider = this.providerFor(reviewer);
    const evidence = (task.evidence as unknown as Evidence[]) ?? [];
    const { data: reviewCommand } = await this.db
      .from("commands")
      .select("expected_output,context")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const reviewContext = (reviewCommand?.context as Record<string, unknown> | null) ?? {};
    const acceptanceCriteria = Array.isArray(reviewContext["acceptanceCriteria"])
      ? (reviewContext["acceptanceCriteria"] as string[])
      : [reviewCommand?.expected_output ?? "Evidence of completion"];
    let decision: "APPROVE" | "REVISE" | "REJECT" = "REJECT";
    let feedback = "";
    try {
      const r = await provider.review({
        context: { missionId: mission.id, taskId: task.id, agentRunId: crypto.randomUUID() },
        reviewer,
        systemPrompt: this.systemPrompt(reviewer),
        task: {
          code: task.code,
          title: task.title,
          description: task.description ?? "",
          expectedOutput: reviewCommand?.expected_output ?? "Evidence of completion",
          acceptanceCriteria,
          retries: task.retries,
        },
        result: { summary: task.result ?? "", evidence },
      });
      decision = r.decision;
      feedback = r.feedback;
      await this.recordUsage(mission, reviewer, r.usage, task.id, "review");
    } catch (e) {
      feedback = "Review failed: " + (e instanceof Error ? e.message : String(e));
      decision = "REJECT";
    }
    if (decision === "APPROVE") {
      await this.db
        .from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", task.id);
      await this.setAgentStatus(worker.id, "IDLE", { current_task_id: null });
      await this.setAgentStatus(commander.id, "DELEGATING");
      await this.event(
        mission,
        "REVIEW_APPROVED",
        `${reviewer.name} approved ${task.code}: ${feedback.slice(0, 200)}`,
        { agentId: reviewer.id, taskId: task.id, targetAgentId: worker.id },
      );
      await this.audit(mission, "task.approve", {
        agentId: reviewer.id,
        taskId: task.id,
        output: feedback.slice(0, 300),
      });
      return { acted: true, note: `approved ${task.code}` };
    }
    const retries = task.retries + 1;
    const newEvidence = [
      ...evidence,
      { type: "text", title: "Review feedback", content: feedback } as Evidence,
    ];
    if (decision === "REJECT" || retries > task.max_retries) {
      await this.db
        .from("tasks")
        .update({
          status: "failed",
          retries,
          evidence: newEvidence as never,
          result: `Rejected by ${reviewer.name}: ${feedback}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", task.id);
      await this.setAgentStatus(worker.id, "ERROR");
      await this.event(
        mission,
        "TASK_FAILED",
        `${reviewer.name} rejected ${task.code}: ${feedback.slice(0, 200)}`,
        { agentId: reviewer.id, taskId: task.id, targetAgentId: worker.id },
      );
      return { acted: true, note: "rejected" };
    }
    await this.db
      .from("tasks")
      .update({
        status: "queued",
        retries,
        evidence: newEvidence as never,
        started_at: null,
        claimed_by_run_id: null,
        claimed_at: null,
      })
      .eq("id", task.id);
    const { data: prev } = await this.db
      .from("commands")
      .select("*")
      .eq("task_id", task.id)
      .eq("assigned_to_agent_id", worker.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await this.authorizeDelegation(mission, reviewer, worker, task.id);
    await this.db.from("commands").upsert(
      {
        organization_id: mission.organization_id,
        mission_id: mission.id,
        task_id: task.id,
        parent_command_id: prev?.parent_command_id ?? null,
        issued_by_agent_id: reviewer.id,
        assigned_to_agent_id: worker.id,
        objective: task.title,
        instructions: `${task.description ?? ""}\n\nREVISION ${retries}: ${feedback}`,
        constraints: (prev?.constraints ?? {}) as never,
        allowed_tools: prev?.allowed_tools ?? [],
        forbidden_actions: prev?.forbidden_actions ?? [],
        expected_output: prev?.expected_output ?? null,
        context: {
          ...((prev?.context as Record<string, unknown>) ?? {}),
          approved: Boolean((prev?.context as Record<string, unknown> | undefined)?.["approved"]),
        } as never,
        max_iterations: prev?.max_iterations ?? 1,
        max_cost: prev?.max_cost ?? 0,
        status: "PENDING",
        execution_mode: mission.is_simulated ? "SIMULATION" : "REAL",
        idempotency_key: `execute:${task.id}:${retries}`,
      },
      { onConflict: "mission_id,idempotency_key" },
    );
    await this.setAgentStatus(worker.id, "WAITING");
    await this.setAgentStatus(commander.id, "DELEGATING");
    await this.event(
      mission,
      "REVISION_REQUESTED",
      `${reviewer.name} → ${worker.name}: revise ${task.code}. ${feedback.slice(0, 200)}`,
      { agentId: reviewer.id, taskId: task.id, targetAgentId: worker.id },
    );
    await this.audit(mission, "task.revise", {
      agentId: reviewer.id,
      taskId: task.id,
      output: feedback.slice(0, 300),
    });
    return { acted: true, note: `revision ${task.code}` };
  }

  private async stepFinalizing(mission: Mission) {
    const commander = this.agent(mission.commander_agent_id)!;
    const { data: tasks } = await this.db
      .from("tasks")
      .select("*")
      .eq("mission_id", mission.id)
      .order("order_index");
    const provider = this.providerFor(commander);
    let summary: string;
    try {
      const s = await provider.summarize({
        context: { missionId: mission.id, taskId: "summary", agentRunId: crypto.randomUUID() },
        goal: mission.goal,
        tasks: (tasks ?? []).map((t) => ({
          code: t.code,
          title: t.title,
          status: t.status,
          result: t.result,
        })),
        systemPrompt: this.systemPrompt(commander),
      });
      summary = s.summary;
      await this.recordUsage(mission, commander, s.usage, null, "summarize");
    } catch (e) {
      summary = `Report unavailable (${e instanceof Error ? e.message : String(e)}). All tasks completed with evidence.`;
    }
    const report = {
      goal: mission.goal,
      simulated: mission.is_simulated,
      tasks: (tasks ?? []).map((t) => ({
        code: t.code,
        title: t.title,
        status: t.status,
        agent: this.agent(t.assigned_agent_id)?.name ?? null,
        result: t.result,
        evidence: t.evidence,
        retries: t.retries,
      })),
      totals: {
        cost: mission.total_cost,
        tokensIn: mission.total_tokens_in,
        tokensOut: mission.total_tokens_out,
        steps: mission.current_step,
      },
    };
    await this.finish(mission, "COMPLETED", `Mission completed. ${summary.slice(0, 160)}`, {
      result: summary,
      summary: summary.slice(0, 600),
      report: report as never,
    });
    return { acted: true, note: "completed" };
  }
}
