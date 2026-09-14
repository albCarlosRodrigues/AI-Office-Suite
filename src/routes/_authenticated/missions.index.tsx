import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, missionsQuery } from "@/lib/queries";
import { PageHeader, EmptyState, formatMoney, timeAgo } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { NewMissionDialog } from "@/components/missions/NewMissionDialog";

export const Route = createFileRoute("/_authenticated/missions/")({
  head: () => ({
    meta: [
      { title: "Missões — AI Pixel Office" },
      {
        name: "description",
        content: "Brief, run and audit missions executed by your AI organization.",
      },
      { property: "og:title", content: "Missions — AI Pixel Office" },
      {
        property: "og:description",
        content: "Brief, run and audit missions executed by your AI organization.",
      },
    ],
  }),
  component: MissionsPage,
});

function MissionsPage() {
  const { org } = useOrg();
  const missions = useQuery(missionsQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const rows = missions.data ?? [];
  const live = rows.filter((m) =>
    ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m.status),
  );
  const past = rows.filter((m) => !live.includes(m));

  const Row = ({ m }: { m: (typeof rows)[number] }) => {
    const commander = agents.data?.find((a) => a.id === m.commander_agent_id);
    return (
      <Link
        to="/missions/$missionId"
        params={{ missionId: m.id }}
        className="panel flex items-center gap-4 px-4 py-3 transition-colors hover:border-primary/40"
      >
        {commander ? (
          <AgentAvatar agent={commander} size={20} />
        ) : (
          <span className="h-[30px] w-[20px] rounded-sm bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{m.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {commander?.name ?? "—"} · {m.phase} · {timeAgo(m.created_at)}
          </p>
        </div>
        <div className="hidden w-40 md:block">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{
                width: `${Math.min(100, (m.current_step / Math.max(1, m.max_steps)) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            step {m.current_step}/{m.max_steps} · {formatMoney(m.total_cost)} of{" "}
            {formatMoney(m.budget)}
          </p>
        </div>
        {m.is_simulated && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-simulation">
            sim
          </span>
        )}
        <StatusBadge status={m.status} pulse={live.includes(m)} />
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Operar"
        title="Missões"
        description="Uma missão é um objetivo entregue a um comandante. Etapas, comandos, evidências e custos ficam registrados."
        actions={<NewMissionDialog />}
      />
      {rows.length === 0 && (
        <EmptyState
          title="Nenhuma missão"
          description="Crie sua primeira missão e acompanhe a hierarquia planejar, delegar e entregar."
          action={<NewMissionDialog />}
        />
      )}
      {live.length > 0 && (
        <section className="mb-8">
          <p className="eyebrow mb-2">Ativas · {live.length}</p>
          <div className="space-y-2">
            {live.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <p className="eyebrow mb-2">Histórico · {past.length}</p>
          <div className="space-y-2">
            {past.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
