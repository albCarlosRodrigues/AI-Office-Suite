import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, approvalsQuery } from "@/lib/queries";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { ApprovalCard } from "@/components/approvals/ApprovalCard";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Aprovações — AI Pixel Office" },
      { name: "description", content: "Human-in-the-loop decisions for risky agent actions." },
      { property: "og:title", content: "Approvals — AI Pixel Office" },
      {
        property: "og:description",
        content: "Human-in-the-loop decisions for risky agent actions.",
      },
    ],
  }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { org } = useOrg();
  const approvals = useQuery(approvalsQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const rows = approvals.data ?? [];
  const pending = rows.filter((a) => a.status === "PENDING");
  const history = rows.filter((a) => a.status !== "PENDING");
  const byId = (id: string | null) => agents.data?.find((a) => a.id === id);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Governar"
        title="Aprovações"
        description="Os agentes não podem ultrapassar uma política sozinhos. Cada solicitação pausa a missão até sua decisão, que fica registrada na auditoria."
      />
      <section className="mb-8 space-y-3">
        <p className="eyebrow">Pendentes · {pending.length}</p>
        {pending.length === 0 ? (
          <EmptyState
            title="Nenhuma aprovação pendente"
            description="As missões estão sendo executadas dentro do escopo permitido."
          />
        ) : (
          pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} agent={byId(a.agent_id)} showMission />
          ))
        )}
      </section>
      {history.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">Resolvidas · {history.length}</p>
          {history.map((a) => (
            <ApprovalCard key={a.id} approval={a} agent={byId(a.agent_id)} showMission />
          ))}
        </section>
      )}
    </div>
  );
}
