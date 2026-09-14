import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import {
  agentPermissionsQuery,
  agentsQuery,
  agentToolsQuery,
  departmentsQuery,
  providersQuery,
  tasksQuery,
  costsQuery,
} from "@/lib/queries";
import { PERMISSIONS } from "@/permissions/catalog";
import { TOOL_CATALOG } from "@/orchestration/tools/catalog";
import { chainOfCommand, subordinatesOf } from "@/agents/hierarchy";
import { PageHeader, StatCard, KeyValue, formatMoney } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AUTONOMY_LEVELS } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/agents/$agentId")({
  head: () => ({
    meta: [
      { title: "Perfil do agente — AI Pixel Office" },
      {
        name: "description",
        content: "Configure a função, hierarquia, permissões, ferramentas e limites do agente.",
      },
      { property: "og:title", content: "Perfil do agente — AI Pixel Office" },
      {
        property: "og:description",
        content: "Configure a função, hierarquia, permissões, ferramentas e limites do agente.",
      },
    ],
  }),
  component: AgentDetailPage,
});

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  const { org } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const agents = useQuery(agentsQuery(org!.id));
  const departments = useQuery(departmentsQuery(org!.id));
  const providers = useQuery(providersQuery(org!.id));
  const perms = useQuery(agentPermissionsQuery(agentId));
  const tools = useQuery(agentToolsQuery(agentId));
  const tasks = useQuery({
    ...tasksQuery(org!.id),
    select: (rows) => rows.filter((t) => t.assigned_agent_id === agentId),
  });
  const costs = useQuery({
    ...costsQuery(org!.id),
    select: (rows) => rows.filter((c) => c.agent_id === agentId),
  });
  const [busy, setBusy] = useState<string | null>(null);

  const agent = agents.data?.find((a) => a.id === agentId);
  if (agents.isLoading)
    return (
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Carregando…
      </p>
    );
  if (!agent) return <p className="text-sm text-muted-foreground">Agente não encontrado.</p>;
  const all = agents.data ?? [];
  const dept = departments.data?.find((d) => d.id === agent.department_id);
  const provider = providers.data?.find((p) => p.id === agent.provider_id);
  const chain = chainOfCommand(agent.id, all);
  const reports = subordinatesOf(agent.id, all);
  const spent = (costs.data ?? []).reduce((s, c) => s + Number(c.estimated_cost), 0);
  const completed = (tasks.data ?? []).filter((t) => t.status === "completed").length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["agents", org!.id] });
    qc.invalidateQueries({ queryKey: ["agent-permissions", agentId] });
    qc.invalidateQueries({ queryKey: ["agent-tools", agentId] });
  };

  const togglePermission = async (permission: string, granted: boolean) => {
    setBusy(permission);
    try {
      const existing = perms.data?.find((p) => p.permission === permission);
      if (existing) {
        const { error } = await supabase
          .from("agent_permissions")
          .update({ granted, always_allow: granted ? existing.always_allow : false })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agent_permissions").insert({
          organization_id: org!.id,
          agent_id: agent.id,
          permission,
          granted,
          always_allow: false,
        });
        if (error) throw error;
      }
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "A alteração falhou");
    } finally {
      setBusy(null);
    }
  };

  const toggleAlways = async (permission: string, always: boolean) => {
    const existing = perms.data?.find((p) => p.permission === permission);
    if (!existing) return;
    const { error } = await supabase
      .from("agent_permissions")
      .update({ always_allow: always })
      .eq("id", existing.id);
    if (error) toast.error(error.message);
    else invalidate();
  };

  const toggleTool = async (toolId: string, enabled: boolean) => {
    setBusy(toolId);
    try {
      const existing = tools.data?.find((t) => t.tool_id === toolId);
      if (existing) {
        const { error } = await supabase
          .from("agent_tools")
          .update({ enabled })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agent_tools").insert({
          organization_id: org!.id,
          agent_id: agent.id,
          tool_id: toolId,
          enabled,
          config: {},
        });
        if (error) throw error;
      }
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "A alteração falhou");
    } finally {
      setBusy(null);
    }
  };

  const setFlag = async (
    patch: Partial<{ is_suspended: boolean; is_primary_controller: boolean }>,
  ) => {
    if (patch.is_primary_controller) {
      await supabase
        .from("agents")
        .update({ is_primary_controller: false })
        .eq("organization_id", org!.id)
        .neq("id", agent.id);
    }
    const { error } = await supabase.from("agents").update(patch).eq("id", agent.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Agente atualizado");
      invalidate();
    }
  };

  const remove = async () => {
    const { error } = await supabase.from("agents").delete().eq("id", agent.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${agent.name} foi removido`);
    invalidate();
    navigate({ to: "/agents" });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/agents" className="text-xs text-muted-foreground hover:text-foreground">
        ← Todos os agentes
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <AgentAvatar agent={agent} size={48} />
          <div>
            <p className="eyebrow">
              {agent.kind} · autonomia L{agent.autonomy_level}
            </p>
            <h1 className="font-display text-2xl font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {agent.role} · {dept?.name ?? "sem departamento"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBadge status={agent.status} pulse={agent.status === "WORKING"} />
              {agent.is_primary_controller && (
                <span className="rounded-sm border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
                  controlador principal
                </span>
              )}
              {agent.is_suspended && (
                <span className="rounded-sm border border-destructive/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-destructive">
                  suspenso
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <AgentFormDialog
            agent={agent}
            agents={all}
            departments={departments.data ?? []}
            providers={providers.data ?? []}
            trigger={<Button variant="outline">Editar</Button>}
          />
          <Button variant="outline" onClick={() => setFlag({ is_suspended: !agent.is_suspended })}>
            {agent.is_suspended ? "Reativar" : "Suspender"}
          </Button>
          {!agent.is_primary_controller && agent.kind !== "external" && (
            <Button variant="outline" onClick={() => setFlag({ is_primary_controller: true })}>
              Tornar controlador principal
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="text-destructive">
                Remover
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover {agent.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Os subordinados ficarão sem gestor e as missões anteriores manterão o histórico.
                  Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Manter</AlertDialogCancel>
                <AlertDialogAction
                  onClick={remove}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Tarefas concluídas"
          value={completed}
          hint={`${tasks.data?.length ?? 0} atribuídas`}
          tone="primary"
        />
        <StatCard
          label="Gasto"
          value={formatMoney(spent)}
          hint={`limite ${formatMoney(agent.max_cost)} / missão`}
        />
        <StatCard label="Subordinados" value={reports.length} hint="subordinados diretos" />
        <StatCard
          label="Provedor"
          value={<span className="text-base">{provider?.name ?? "padrão da organização"}</span>}
          hint={agent.model ?? "modelo padrão"}
        />
      </div>

      <Tabs defaultValue="permissions" className="mt-6">
        <TabsList>
          <TabsTrigger value="permissions">Permissões</TabsTrigger>
          <TabsTrigger value="tools">Ferramentas</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarquia</TabsTrigger>
          <TabsTrigger value="prompt">Instruções e limites</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="panel divide-y divide-border/60">
          <p className="px-4 py-3 text-xs text-muted-foreground">
            As permissões concedidas definem o que o agente pode fazer sem solicitar. “Sempre”
            ignora a aprovação dessa permissão; cada uso ainda será auditado.
          </p>
          {PERMISSIONS.map((p) => {
            const row = perms.data?.find((x) => x.permission === p.id);
            const granted = row?.granted ?? false;
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {p.label}{" "}
                    <span className="font-mono text-[10px] text-muted-foreground">{p.id}</span>
                  </p>
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">{p.group}</p>
                </div>
                <StatusBadge status={p.risk} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  sempre
                  <Switch
                    checked={row?.always_allow ?? false}
                    disabled={!granted}
                    onCheckedChange={(v) => toggleAlways(p.id, v)}
                  />
                </label>
                <Switch
                  checked={granted}
                  disabled={busy === p.id}
                  onCheckedChange={(v) => togglePermission(p.id, v)}
                />
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="tools" className="panel divide-y divide-border/60">
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Ferramentas que o agente pode solicitar. O uso ainda depende das permissões
            correspondentes e, conforme o risco e a política, de aprovação humana.
          </p>
          {TOOL_CATALOG.map((t) => {
            const row = tools.data?.find((x) => x.tool_id === t.id);
            const missing = t.requiredPermissions.filter(
              (rp) => !perms.data?.some((x) => x.permission === rp && x.granted),
            );
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {t.name}{" "}
                    <span className="font-mono text-[10px] text-muted-foreground">{t.id}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                  {missing.length > 0 && row?.enabled && (
                    <p className="font-mono text-[10px] text-warning">
                      permissões ausentes: {missing.join(", ")}
                    </p>
                  )}
                </div>
                <StatusBadge status={t.riskLevel} />
                <Switch
                  checked={row?.enabled ?? false}
                  disabled={busy === t.id}
                  onCheckedChange={(v) => toggleTool(t.id, v)}
                />
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="hierarchy" className="grid gap-4 md:grid-cols-2">
          <div className="panel p-4">
            <p className="eyebrow mb-2">Cadeia de comando</p>
            <ol className="space-y-1.5">
              <li className="flex items-center gap-2 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary/15 font-mono text-[10px] text-primary">
                  H
                </span>
                Operadores humanos
              </li>
              {[...chain].reverse().map((a) => (
                <li key={a.id}>
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: a.id }}
                    className="flex items-center gap-2 text-sm hover:text-primary"
                  >
                    <AgentAvatar agent={a} size={14} />
                    {a.name} <span className="text-xs text-muted-foreground">· {a.role}</span>
                  </Link>
                </li>
              ))}
              <li className="flex items-center gap-2 text-sm font-medium">
                <AgentAvatar agent={agent} size={14} />
                {agent.name} <span className="text-xs text-muted-foreground">(este agente)</span>
              </li>
            </ol>
          </div>
          <div className="panel p-4">
            <p className="eyebrow mb-2">Subordinados diretos · {reports.length}</p>
            {reports.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sem subordinados. Este agente executa tarefas, mas não delega.
              </p>
            )}
            <ul className="space-y-1.5">
              {reports.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: a.id }}
                    className="flex items-center gap-2 text-sm hover:text-primary"
                  >
                    <AgentAvatar agent={a} size={14} />
                    {a.name} <span className="text-xs text-muted-foreground">· {a.role}</span>
                    <StatusBadge status={a.status} className="ml-auto" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="prompt" className="grid gap-4 md:grid-cols-3">
          <div className="panel p-4 md:col-span-2">
            <p className="eyebrow">Instruções do sistema</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {agent.system_prompt ?? "—"}
            </pre>
            {agent.personality && (
              <>
                <p className="eyebrow mt-4">Personalidade</p>
                <p className="mt-1 text-sm">{agent.personality}</p>
              </>
            )}
            <p className="eyebrow mt-4">Capacidades</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {agent.capabilities.length === 0 && (
                <span className="text-xs text-muted-foreground">nenhuma declarada</span>
              )}
              {agent.capabilities.map((c) => (
                <span
                  key={c}
                  className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="panel p-4">
            <p className="eyebrow">Limites</p>
            <KeyValue label="Autonomia">
              {AUTONOMY_LEVELS[agent.autonomy_level]?.name ?? agent.autonomy_level}
            </KeyValue>
            <KeyValue label="Custo máximo / missão">{formatMoney(agent.max_cost)}</KeyValue>
            <KeyValue label="Máximo de iterações">{agent.max_iterations}</KeyValue>
            <KeyValue label="Limite de contexto">{agent.context_limit} tokens</KeyValue>
            <KeyValue label="Exige aprovação">
              {agent.require_approval ? "sempre" : "conforme a política"}
            </KeyValue>
            <KeyValue label="Memória">{agent.memory_enabled ? "ativada" : "desativada"}</KeyValue>
            {agent.kind === "external" && (
              <KeyValue label="Endereço">
                {((agent.external_config ?? {}) as { url?: string }).url ?? "não definido"}
              </KeyValue>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
