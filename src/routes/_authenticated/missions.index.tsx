import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, missionsQuery } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState, formatMoney, timeAgo } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { NewMissionDialog } from "@/components/missions/NewMissionDialog";
import type { Mission } from "@/types/domain";

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

type MissionWithArchive = Mission & { archived_at?: string | null };

function MissionsPage() {
  const { org } = useOrg();
  const missions = useQuery(missionsQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [busyMissionId, setBusyMissionId] = useState<string | null>(null);

  const rows = (missions.data ?? []) as MissionWithArchive[];
  const activeRows = rows.filter((mission) => !mission.archived_at);
  const archived = rows.filter((mission) => Boolean(mission.archived_at));
  const live = activeRows.filter((m) =>
    ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m.status),
  );
  const past = activeRows.filter((m) => !live.includes(m));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["missions", org!.id] });
  };

  const archiveMission = async (missionId: string) => {
    setBusyMissionId(missionId);
    try {
      const { error } = await supabase
        .from("missions")
        .update({ archived_at: new Date().toISOString() } as never)
        .eq("id", missionId);
      if (error) throw error;
      await refresh();
      toast.success("Missão arquivada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível arquivar a missão");
    } finally {
      setBusyMissionId(null);
    }
  };

  const restoreMission = async (missionId: string) => {
    setBusyMissionId(missionId);
    try {
      const { error } = await supabase
        .from("missions")
        .update({ archived_at: null } as never)
        .eq("id", missionId);
      if (error) throw error;
      await refresh();
      toast.success("Missão restaurada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível restaurar a missão");
    } finally {
      setBusyMissionId(null);
    }
  };

  const deleteMissionPermanently = async (missionId: string) => {
    if (
      !window.confirm(
        "Excluir permanentemente esta missão e seus registros? Esta ação não pode ser desfeita.",
      )
    )
      return;

    setBusyMissionId(missionId);
    try {
      const [{ data: commands, error: commandsError }, { data: meetings, error: meetingsError }] =
        await Promise.all([
          supabase.from("commands").select("id").eq("mission_id", missionId),
          supabase.from("meetings").select("id").eq("mission_id", missionId),
        ]);
      if (commandsError) throw commandsError;
      if (meetingsError) throw meetingsError;

      const commandIds = (commands ?? []).map((row) => row.id);
      const meetingIds = (meetings ?? []).map((row) => row.id);

      if (commandIds.length) {
        const { error } = await supabase
          .from("command_results")
          .delete()
          .in("command_id", commandIds);
        if (error) throw error;
      }

      if (meetingIds.length) {
        const [{ error: participantError }, { error: messageError }] = await Promise.all([
          supabase.from("meeting_participants").delete().in("meeting_id", meetingIds),
          supabase.from("meeting_messages").delete().in("meeting_id", meetingIds),
        ]);
        if (participantError) throw participantError;
        if (messageError) throw messageError;
      }

      const cleanupResults = await Promise.all([
        supabase.from("mission_agents").delete().eq("mission_id", missionId),
        supabase.from("mission_events").delete().eq("mission_id", missionId),
        supabase.from("tool_calls").delete().eq("mission_id", missionId),
        supabase.from("agent_runs").delete().eq("mission_id", missionId),
        supabase.from("approval_requests").delete().eq("mission_id", missionId),
        supabase.from("mission_permissions").delete().eq("mission_id", missionId),
        supabase.from("cost_records").delete().eq("mission_id", missionId),
        supabase.from("tasks").delete().eq("mission_id", missionId),
        supabase.from("commands").delete().eq("mission_id", missionId),
        supabase.from("meetings").delete().eq("mission_id", missionId),
      ]);
      const cleanupError = cleanupResults.find((result) => result.error)?.error;
      if (cleanupError) throw cleanupError;

      const { error: missionError } = await supabase.from("missions").delete().eq("id", missionId);
      if (missionError) throw missionError;

      await refresh();
      toast.success("Missão excluída permanentemente");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir a missão");
    } finally {
      setBusyMissionId(null);
    }
  };

  const Row = ({ m, archivedView = false }: { m: MissionWithArchive; archivedView?: boolean }) => {
    const commander = agents.data?.find((a) => a.id === m.commander_agent_id);
    const isLive = ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m.status);
    const busy = busyMissionId === m.id;

    return (
      <div className="panel flex items-center gap-3 px-3 py-2">
        <Link
          to="/missions/$missionId"
          params={{ missionId: m.id }}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-sm px-1 py-1 transition-colors hover:bg-accent/30"
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
              {Number(m.budget) > 0
                ? `step ${m.current_step}/${m.max_steps} · ${formatMoney(m.total_cost)} of ${formatMoney(m.budget)}`
                : `step ${m.current_step}/${m.max_steps} · sem cobrança por token`}
            </p>
          </div>
          {m.is_simulated && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-simulation">
              sim
            </span>
          )}
          <StatusBadge status={m.status} pulse={isLive} />
        </Link>

        {!archivedView && !isLive && (
          <button
            type="button"
            disabled={busy}
            onClick={() => archiveMission(m.id)}
            className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          >
            Arquivar
          </button>
        )}

        {archivedView && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => restoreMission(m.id)}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              Restaurar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => deleteMissionPermanently(m.id)}
              className="rounded-sm border border-destructive/50 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Excluir
            </button>
          </div>
        )}
      </div>
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

      {activeRows.length === 0 && !showArchived && (
        <EmptyState
          title={archived.length ? "Nenhuma missão visível" : "Nenhuma missão"}
          description={
            archived.length
              ? "As missões existentes estão arquivadas. Use Mostrar arquivadas para restaurá-las."
              : "Crie sua primeira missão e acompanhe a hierarquia planejar, delegar e entregar."
          }
          action={archived.length ? undefined : <NewMissionDialog />}
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

      {(past.length > 0 || archived.length > 0) && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="eyebrow">Histórico · {past.length}</p>
            {archived.length > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((value) => !value)}
                className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:border-primary/50 hover:text-foreground"
              >
                {showArchived ? "Ocultar arquivadas" : `Mostrar arquivadas · ${archived.length}`}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {past.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}

      {showArchived && archived.length > 0 && (
        <section className="mt-8">
          <p className="eyebrow mb-2">Arquivadas · {archived.length}</p>
          <div className="space-y-2">
            {archived.map((m) => (
              <Row key={m.id} m={m} archivedView />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
