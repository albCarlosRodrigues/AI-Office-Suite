import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import {
  agentsQuery,
  approvalsQuery,
  costsQuery,
  eventsQuery,
  missionsQuery,
  providersQuery,
  tasksQuery,
} from "@/lib/queries";
import { PageHeader, StatCard, formatMoney, timeAgo } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { NewMissionDialog } from "@/components/missions/NewMissionDialog";
import { AGENT_STATUSES } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Painel — AI Pixel Office" },
      {
        name: "description",
        content: "Organization-wide view of missions, agents, approvals and spend.",
      },
      { property: "og:title", content: "Dashboard — AI Pixel Office" },
      {
        property: "og:description",
        content: "Organization-wide view of missions, agents, approvals and spend.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { org, settings } = useOrg();
  const id = org!.id;
  const missions = useQuery(missionsQuery(id));
  const agents = useQuery(agentsQuery(id));
  const approvals = useQuery(approvalsQuery(id));
  const costs = useQuery(costsQuery(id));
  const events = useQuery(eventsQuery(id));
  const tasks = useQuery(tasksQuery(id));
  const providers = useQuery(providersQuery(id));

  const live =
    missions.data?.filter((m) =>
      ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m.status),
    ) ?? [];
  const completed = missions.data?.filter((m) => m.status === "COMPLETED").length ?? 0;
  const failed = missions.data?.filter((m) => m.status === "FAILED").length ?? 0;
  const pending = approvals.data?.filter((a) => a.status === "PENDING").length ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const spentToday = (costs.data ?? [])
    .filter((c) => c.created_at.startsWith(today))
    .reduce((s, c) => s + Number(c.estimated_cost), 0);
  const spentTotal = (costs.data ?? []).reduce((s, c) => s + Number(c.estimated_cost), 0);
  const runningTasks = tasks.data?.filter((t) => t.status === "running").length ?? 0;
  const healthy = providers.data?.filter((p) => p.health === "CONNECTED").length ?? 0;
  const byStatus = AGENT_STATUSES.map((s) => ({
    s,
    n: agents.data?.filter((a) => a.status === s).length ?? 0,
  })).filter((x) => x.n > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Operar"
        title={org!.name}
        description="Tudo o que sua organização está fazendo agora e quanto está custando."
        actions={<NewMissionDialog />}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatCard
          label="Missões ativas"
          value={live.length}
          hint={`${completed} concluídas · ${failed} falharam`}
          tone="primary"
        />
        <StatCard
          label="Aprovações pendentes"
          value={pending}
          hint={pending ? "ação necessária" : "tudo certo"}
          tone={pending ? "warning" : "success"}
        />
        <StatCard
          label="Agentes"
          value={agents.data?.length ?? 0}
          hint={`${agents.data?.filter((a) => a.status === "WORKING").length ?? 0} trabalhando agora`}
        />
        <StatCard
          label="Tarefas em execução"
          value={runningTasks}
          hint={`${tasks.data?.length ?? 0} acompanhadas`}
        />
        <StatCard
          label="Gasto hoje"
          value={formatMoney(spentToday)}
          hint={
            settings?.daily_cost_limit
              ? `limite ${formatMoney(settings.daily_cost_limit)}`
              : "sem limite diário"
          }
          tone={
            settings?.daily_cost_limit && spentToday > Number(settings.daily_cost_limit) * 0.8
              ? "warning"
              : "default"
          }
        />
        <StatCard
          label="Provedores"
          value={`${healthy}/${providers.data?.length ?? 0}`}
          hint="conectados"
          tone={healthy ? "success" : "warning"}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="panel p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Missões ativas</p>
            <Link to="/missions" className="text-xs text-primary hover:underline">
              Todas as missões →
            </Link>
          </div>
          {live.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma missão em execução. O escritório está ocioso.
            </p>
          )}
          <ul className="space-y-2">
            {live.map((m) => {
              const c = agents.data?.find((a) => a.id === m.commander_agent_id);
              return (
                <li key={m.id}>
                  <Link
                    to="/missions/$missionId"
                    params={{ missionId: m.id }}
                    className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 hover:border-primary/40"
                  >
                    {c && <AgentAvatar agent={c} size={16} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {m.phase} · etapa {m.current_step}/{m.max_steps} ·{" "}
                        {formatMoney(m.total_cost)}
                      </p>
                    </div>
                    <StatusBadge status={m.status} pulse />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel p-4">
          <p className="eyebrow mb-3">Estados dos agentes</p>
          <ul className="space-y-1.5">
            {byStatus.map(({ s, n }) => (
              <li key={s} className="flex items-center justify-between">
                <StatusBadge status={s} />
                <span className="font-mono text-xs">{n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-border pt-3">
            <p className="eyebrow mb-1">Custo acumulado</p>
            <p className="font-display text-xl font-semibold">{formatMoney(spentTotal)}</p>
            <p className="text-xs text-muted-foreground">
              {(costs.data ?? []).filter((c) => c.is_simulated).length} registros simulados
            </p>
          </div>
        </section>

        <section className="panel p-4 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Atividade recente</p>
            <Link to="/logs" className="text-xs text-primary hover:underline">
              Registro de auditoria →
            </Link>
          </div>
          <ul className="divide-y divide-border/60">
            {(events.data ?? []).slice(0, 12).map((ev) => {
              const a = agents.data?.find((x) => x.id === ev.agent_id);
              return (
                <li key={ev.id} className="flex items-center gap-3 py-2">
                  {a ? (
                    <AgentAvatar agent={a} size={12} />
                  ) : (
                    <span className="h-[18px] w-3 rounded-sm bg-muted" />
                  )}
                  <p className="min-w-0 flex-1 truncate text-sm">{ev.message}</p>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {timeAgo(ev.created_at)}
                  </span>
                </li>
              );
            })}
            {(events.data ?? []).length === 0 && (
              <li className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma atividade ainda.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
