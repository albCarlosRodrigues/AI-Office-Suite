import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, departmentsQuery, providersQuery } from "@/lib/queries";
import { buildHierarchy, type AgentNode } from "@/agents/hierarchy";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import { Button } from "@/components/ui/button";
import type { Agent, Department } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/agents/")({
  head: () => ({
    meta: [
      { title: "Agentes — AI Pixel Office" },
      { name: "description", content: "Your AI workforce: hierarchy, roles, autonomy and status." },
      { property: "og:title", content: "Agents — AI Pixel Office" },
      {
        property: "og:description",
        content: "Your AI workforce: hierarchy, roles, autonomy and status.",
      },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { org } = useOrg();
  const agents = useQuery(agentsQuery(org!.id));
  const departments = useQuery(departmentsQuery(org!.id));
  const providers = useQuery(providersQuery(org!.id));
  const tree = useMemo(() => buildHierarchy(agents.data ?? []), [agents.data]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Organizar"
        title="Agentes"
        description="Agentes respondem a outros agentes. Ordens descem pela cadeia de comando e evidências retornam para revisão."
        actions={
          <AgentFormDialog
            agents={agents.data ?? []}
            departments={departments.data ?? []}
            providers={providers.data ?? []}
            trigger={<Button>Adicionar agente</Button>}
          />
        }
      />
      {(agents.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhum agente"
          description="Adicione primeiro um controlador e depois os agentes que responderão a ele."
        />
      ) : (
        <div className="panel p-4">
          <ul className="space-y-1">
            {tree.map((n) => (
              <TreeNode key={n.agent.id} node={n} depth={0} departments={departments.data ?? []} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  departments,
}: {
  node: AgentNode;
  depth: number;
  departments: Department[];
}) {
  const a: Agent = node.agent;
  const dept = departments.find((d) => d.id === a.department_id);
  return (
    <li>
      <Link
        to="/agents/$agentId"
        params={{ agentId: a.id }}
        className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
        style={{ marginLeft: depth * 28 }}
      >
        {depth > 0 && <span className="font-mono text-xs text-muted-foreground">└</span>}
        <AgentAvatar agent={a} size={20} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {a.name}
            {a.is_primary_controller && (
              <span className="rounded-sm border border-primary/40 px-1 font-mono text-[9px] uppercase text-primary">
                controller
              </span>
            )}
            {a.kind === "external" && (
              <span className="rounded-sm border border-info/40 px-1 font-mono text-[9px] uppercase text-info">
                external
              </span>
            )}
            {a.is_suspended && (
              <span className="rounded-sm border border-destructive/40 px-1 font-mono text-[9px] uppercase text-destructive">
                suspended
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {a.role} · {dept?.name ?? "sem departamento"} · autonomia L{a.autonomy_level}
          </p>
        </div>
        <span className="hidden font-mono text-[10px] text-muted-foreground md:inline">
          {a.model ?? (a.kind === "external" ? "executor externo" : "padrão do provedor")}
        </span>
        <StatusBadge status={a.status} pulse={a.status === "WORKING"} />
      </Link>
      {node.children.length > 0 && (
        <ul className="space-y-1">
          {node.children.map((c) => (
            <TreeNode key={c.agent.id} node={c} depth={depth + 1} departments={departments} />
          ))}
        </ul>
      )}
    </li>
  );
}
