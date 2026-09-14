import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, missionsQuery, tasksQuery } from "@/lib/queries";
import { PageHeader, EmptyState, formatMoney, timeAgo } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import type { TaskStatus } from "@/types/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tarefas — AI Pixel Office" },
      {
        name: "description",
        content: "Every task across all missions, with owner, status and cost.",
      },
      { property: "og:title", content: "Tasks — AI Pixel Office" },
      {
        property: "og:description",
        content: "Every task across all missions, with owner, status and cost.",
      },
    ],
  }),
  component: TasksPage,
});

const FILTERS: ("all" | TaskStatus)[] = [
  "all",
  "running",
  "waiting",
  "queued",
  "blocked",
  "completed",
  "failed",
];

function TasksPage() {
  const { org } = useOrg();
  const tasks = useQuery(tasksQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const missions = useQuery(missionsQuery(org!.id));
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const rows = (tasks.data ?? []).filter((t) => filter === "all" || t.status === filter);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Operar"
        title="Tarefas"
        description="Unidades de trabalho delegado. Cada tarefa pertence a uma missão, possui responsável, dependências e custo próprios."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-sm border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground",
              filter === f && "border-primary/50 text-primary",
            )}
          >
            {f}{" "}
            {f !== "all" && (
              <span className="opacity-60">
                {tasks.data?.filter((t) => t.status === f).length ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma tarefa"
          description="As tarefas aparecerão quando um comandante concluir o planejamento de uma missão."
        />
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Tarefa</th>
                <th className="px-3 py-2">Responsável</th>
                <th className="px-3 py-2">Missão</th>
                <th className="px-3 py-2 text-right">Custo</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((t) => {
                const a = agents.data?.find((x) => x.id === t.assigned_agent_id);
                const m = missions.data?.find((x) => x.id === t.mission_id);
                return (
                  <tr key={t.id} className="hover:bg-accent/30">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.code}</td>
                    <td className="max-w-xs px-3 py-2">
                      <p className="truncate font-medium">{t.title}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {timeAgo(t.created_at)}
                        {t.retries > 0 && ` · retries ${t.retries}`}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        {a && <AgentAvatar agent={a} size={12} />}
                        {a?.name ?? "—"}
                      </span>
                    </td>
                    <td className="max-w-[180px] px-3 py-2">
                      {m ? (
                        <Link
                          to="/missions/$missionId"
                          params={{ missionId: m.id }}
                          className="block truncate text-primary hover:underline"
                        >
                          {m.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatMoney(t.cost)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} pulse={t.status === "running"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
