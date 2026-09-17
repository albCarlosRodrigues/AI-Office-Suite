import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useOrg } from "@/lib/org-context";
import {
  agentsQuery,
  departmentsQuery,
  eventsQuery,
  missionsQuery,
  officeMapQuery,
} from "@/lib/queries";
import { officeBus } from "@/office/eventBus";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { EmptyState, timeAgo } from "@/components/shared/PageHeader";
import { NewMissionDialog } from "@/components/missions/NewMissionDialog";
import { AnimationTestPanel } from "@/components/office/AnimationTestPanel";
import { Button } from "@/components/ui/button";
import { AGENT_STATUSES, type Agent, type AgentStatus } from "@/types/domain";
import { cn } from "@/lib/utils";

const OfficeCanvas = lazy(() => import("@/components/office/OfficeCanvas"));

export const Route = createFileRoute("/_authenticated/office")({
  head: () => ({
    meta: [
      { title: "Escritório — AI Pixel Office" },
      {
        name: "description",
        content: "Acompanhe sua organização de IA trabalhando em um escritório pixel art.",
      },
      { property: "og:title", content: "Escritório — AI Pixel Office" },
      {
        property: "og:description",
        content: "Acompanhe sua organização de IA trabalhando em um escritório pixel art.",
      },
    ],
  }),
  component: OfficePage,
});

function OfficePage() {
  const { org } = useOrg();
  const orgId = org!.id;
  const map = useQuery(officeMapQuery(orgId));
  const agents = useQuery({ ...agentsQuery(orgId), refetchInterval: 2000 });
  const departments = useQuery(departmentsQuery(orgId));
  const events = useQuery({ ...eventsQuery(orgId), refetchInterval: 6000 });
  const missions = useQuery({ ...missionsQuery(orgId), refetchInterval: 3000 });
  const seenEvents = useRef<Set<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"feed" | "roster">("feed");
  const [chatMission, setChatMission] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const conversation = (events.data ?? [])
    .filter((event) => !chatMission || event.mission_id === chatMission)
    .slice()
    .reverse();

  const selected = agents.data?.find((a) => a.id === selectedId) ?? null;
  const deptName = (id: string | null) => departments.data?.find((d) => d.id === id)?.name ?? "—";
  const counts = useMemo(() => {
    const c: Partial<Record<AgentStatus, number>> = {};
    for (const a of agents.data ?? []) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [agents.data]);
  const liveMissions =
    missions.data?.filter((m) =>
      ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m.status),
    ) ?? [];

  useEffect(() => {
    officeBus.emit({ type: "focus:agent", agentId: selectedId });
  }, [selectedId]);

  useEffect(() => {
    if (!events.data) return;
    if (!seenEvents.current) {
      seenEvents.current = new Set(events.data.map((event) => event.id));
      return;
    }
    const fresh = events.data.filter((event) => !seenEvents.current!.has(event.id)).reverse();
    for (const event of fresh) {
      seenEvents.current.add(event.id);
      officeBus.emit({ type: "mission:event", event });
    }
  }, [events.data]);

  if (map.isLoading || agents.isLoading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Carregando escritório…
      </div>
    );
  }
  if (!map.data) {
    return (
      <div className="p-6">
        <EmptyState
          title="Nenhuma planta de escritório"
          description="Esta organização ainda não possui um layout. Crie uma organização com os dados de demonstração."
          action={
            <Button asChild>
              <Link to="/organization">Abrir organização</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 bg-office">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Iniciando visualização…
            </div>
          }
        >
          <OfficeCanvas
            map={map.data.map}
            zones={map.data.zones}
            workstations={map.data.workstations}
            agents={agents.data ?? []}
            killSwitch={org!.kill_switch_active}
            onSelectAgent={setSelectedId}
          />
        </Suspense>

        <AnimationTestPanel
          agents={agents.data ?? []}
          selectedAgentId={selectedId}
          onSelectAgent={setSelectedId}
        />

        {/* HUD: status legend */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {AGENT_STATUSES.filter((s) => counts[s]).map((s) => (
            <span key={s} className="pointer-events-auto">
              <StatusBadge
                status={s}
                className="bg-background/80 backdrop-blur"
                pulse={["WORKING", "THINKING", "MEETING"].includes(s)}
              />
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{counts[s]}</span>
            </span>
          ))}
        </div>

        {/* HUD: live missions + launcher */}
        <div className="absolute bottom-3 left-3 flex max-w-[60%] flex-wrap items-center gap-2">
          <NewMissionDialog
            trigger={
              <Button size="sm" className="shadow-glow">
                ＋ Nova missão
              </Button>
            }
          />
          {liveMissions.slice(0, 3).map((m) => (
            <Link
              key={m.id}
              to="/missions/$missionId"
              params={{ missionId: m.id }}
              className="panel flex items-center gap-2 px-2.5 py-1.5 text-xs hover:border-primary/40"
            >
              <StatusBadge status={m.status} pulse />
              <span className="max-w-[180px] truncate">{m.title}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                etapa {m.current_step}/{m.max_steps}
              </span>
            </Link>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3 font-mono text-[10px] text-muted-foreground/70">
          arraste para mover · roda para ampliar · clique em um agente
        </div>
      </div>

      <button
        className="absolute right-3 top-2 z-20 rounded bg-card px-2 py-1 text-xs lg:hidden"
        onClick={() => setChatOpen(!chatOpen)}
      >
        Conversa
      </button>
      <aside
        className={cn(
          "z-10 w-80 shrink-0 flex-col border-l border-border bg-card max-lg:absolute max-lg:inset-y-0 max-lg:right-0 lg:flex",
          chatOpen ? "flex" : "hidden",
        )}
      >
        {selected ? (
          <AgentInspector
            agent={selected}
            deptName={deptName(selected.department_id)}
            manager={agents.data?.find((a) => a.id === selected.manager_agent_id) ?? null}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <>
            <div className="border-b border-border p-3">
              <p className="text-sm font-semibold">Equipe — {org!.name}</p>
              <div className="my-2 flex gap-2">
                {(agents.data ?? []).map((agent) => (
                  <span
                    key={agent.id}
                    title={`${agent.name}: ${agent.status}`}
                    className="flex items-center gap-1 text-xs"
                  >
                    <AgentAvatar agent={agent} size={14} />
                    {agent.name}
                  </span>
                ))}
              </div>
              <select
                aria-label="Grupo da missão"
                className="w-full rounded border border-border bg-background p-1 text-xs"
                value={chatMission}
                onChange={(e) => setChatMission(e.target.value)}
              >
                <option value="">Todas as missões</option>
                {(missions.data ?? []).map((mission) => (
                  <option key={mission.id} value={mission.id}>
                    {mission.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex border-b border-border">
              {(["feed", "roster"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex-1 py-2.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground",
                    tab === t && "border-b-2 border-primary text-primary",
                  )}
                >
                  {t === "feed" ? "Conversa" : `Equipe · ${agents.data?.length ?? 0}`}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "feed" ? (
                <ul className="divide-y divide-border/60">
                  {(events.data ?? []).length === 0 && (
                    <li className="p-4 text-xs text-muted-foreground">
                      Nenhuma atividade ainda. Inicie uma missão para movimentar o escritório.
                    </li>
                  )}
                  {conversation.map((ev) => {
                    const a = agents.data?.find((x) => x.id === ev.agent_id);
                    return (
                      <li
                        key={ev.id}
                        className="m-2 flex gap-2.5 rounded-lg border border-border/40 bg-muted/30 px-3 py-2"
                      >
                        {a ? (
                          <AgentAvatar agent={a} size={14} />
                        ) : (
                          <span className="h-[21px] w-[14px] shrink-0 rounded-sm bg-muted" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-baseline justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-foreground">
                              {a?.name ?? "Runtime"}
                              {a?.role && (
                                <span className="font-normal text-muted-foreground">
                                  {" "}
                                  · {a.role}
                                </span>
                              )}
                            </p>
                            <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                              {timeAgo(ev.created_at)}
                            </span>
                          </div>
                          <p className="text-xs leading-snug">{ev.message}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {ev.type.toLowerCase().replace(/_/g, " ")}
                          </p>
                          {ev.mission_id && (
                            <Link
                              to="/missions/$missionId"
                              params={{ missionId: ev.mission_id }}
                              className="text-[10px] text-primary"
                            >
                              Abrir missão e evidências →
                            </Link>
                          )}
                          {ev.task_id && (
                            <p
                              className="truncate text-[9px] text-muted-foreground"
                              title={ev.task_id}
                            >
                              Tarefa: {ev.task_id}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="divide-y divide-border/60">
                  {(agents.data ?? []).map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => setSelectedId(a.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/60"
                      >
                        <AgentAvatar agent={a} size={18} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {a.name}{" "}
                            <span className="text-xs text-muted-foreground">· {a.role}</span>
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {deptName(a.department_id)}
                          </p>
                        </div>
                        <StatusBadge status={a.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function AgentInspector({
  agent,
  deptName,
  manager,
  onClose,
}: {
  agent: Agent;
  deptName: string;
  manager: Agent | null;
  onClose: () => void;
}) {
  const { org } = useOrg();
  const events = useQuery({
    ...eventsQuery(org!.id),
    select: (rows) =>
      rows.filter((e) => e.agent_id === agent.id || e.target_agent_id === agent.id).slice(0, 30),
  });
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <AgentAvatar agent={agent} size={36} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold leading-tight">{agent.name}</p>
          <p className="text-xs text-muted-foreground">
            {agent.role} · {deptName}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <StatusBadge status={agent.status} pulse={agent.status === "WORKING"} />
            {agent.kind === "external" && (
              <span className="rounded-sm border border-info/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-info">
                externo
              </span>
            )}
            {agent.is_primary_controller && (
              <span className="rounded-sm border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
                controlador
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>
      <div className="space-y-1 border-b border-border p-4 text-sm">
        <Row k="Responde a" v={manager ? manager.name : "—"} />
        <Row k="Autonomia" v={`N${agent.autonomy_level}`} />
        <Row k="Modelo" v={agent.model ?? "padrão do provedor"} />
        <Row k="Custo máximo / missão" v={`$${Number(agent.max_cost ?? 0).toFixed(2)}`} />
        <Row k="Exige aprovação" v={agent.require_approval ? "sim" : "conforme política"} />
        {agent.description && (
          <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
        )}
      </div>
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="eyebrow">Atividade recente</p>
        <Link
          to="/agents/$agentId"
          params={{ agentId: agent.id }}
          className="text-xs text-primary hover:underline"
        >
          Abrir perfil →
        </Link>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-1 pb-2">
        {(events.data ?? []).length === 0 && (
          <li className="p-3 text-xs text-muted-foreground">Nenhuma atividade.</li>
        )}
        {(events.data ?? []).map((ev) => (
          <li key={ev.id} className="px-3 py-2">
            <p className="text-xs leading-snug">{ev.message}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {ev.type.toLowerCase().replace(/_/g, " ")} · {timeAgo(ev.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}
