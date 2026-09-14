import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, auditQuery } from "@/lib/queries";
import { PageHeader, EmptyState, formatTime } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Registro de auditoria — AI Pixel Office" },
      { name: "description", content: "Immutable record of every agent and human action." },
      { property: "og:title", content: "Audit log — AI Pixel Office" },
      { property: "og:description", content: "Immutable record of every agent and human action." },
    ],
  }),
  component: LogsPage,
});

function LogsPage() {
  const { org } = useOrg();
  const audit = useQuery(auditQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const [q, setQ] = useState("");
  const rows = (audit.data ?? []).filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      r.action.toLowerCase().includes(s) ||
      (r.tool ?? "").toLowerCase().includes(s) ||
      (r.input_summary ?? "").toLowerCase().includes(s) ||
      (r.output_summary ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Governar"
        title="Registro de auditoria"
        description="Histórico completo das ações realizadas por pessoas, agentes e ferramentas."
        actions={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar ações, ferramentas e resumos…"
            className="w-72"
          />
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum registro"
          description="Inícios de missão, comandos, ferramentas, aprovações e interrupções aparecerão aqui."
        />
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Responsável</th>
                <th className="px-3 py-2">Ação</th>
                <th className="px-3 py-2">Ferramenta</th>
                <th className="px-3 py-2">Resumo</th>
                <th className="px-3 py-2">Risco</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => {
                const a = agents.data?.find((x) => x.id === r.agent_id);
                return (
                  <tr key={r.id} className="align-top hover:bg-accent/30">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {formatTime(r.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      {a ? (
                        <span className="flex items-center gap-1.5">
                          <AgentAvatar agent={a} size={12} />
                          {a.name}
                        </span>
                      ) : r.actor_user_id ? (
                        <span className="font-mono text-xs text-primary">pessoa</span>
                      ) : (
                        <span className="text-muted-foreground">sistema</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                    <td className="px-3 py-2 font-mono text-xs text-info">{r.tool ?? "—"}</td>
                    <td className="max-w-md px-3 py-2 text-xs">
                      {r.input_summary && (
                        <p className="truncate text-muted-foreground">in: {r.input_summary}</p>
                      )}
                      {r.output_summary && <p className="truncate">out: {r.output_summary}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.risk_level} />
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
