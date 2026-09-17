import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, missionDetailQuery, meetingMessagesQuery } from "@/lib/queries";
import {
  startMission,
  stopMission,
  pauseMission,
  resumeMission,
  retryMission,
} from "@/orchestration/mission.functions";
import {
  PageHeader,
  StatCard,
  KeyValue,
  formatMoney,
  formatTime,
  timeAgo,
} from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Evidence, Task, Command, Agent, Meeting } from "@/types/domain";
import { cn } from "@/lib/utils";
import { taskAttemptCounter } from "@/runtime/attempt-counters";

export const Route = createFileRoute("/_authenticated/missions/$missionId")({
  head: () => ({
    meta: [
      { title: "Controle da missão — AI Pixel Office" },
      {
        name: "description",
        content: "Linha do tempo, tarefas, comandos, evidências e aprovações da missão.",
      },
      { property: "og:title", content: "Controle da missão — AI Pixel Office" },
      {
        property: "og:description",
        content: "Linha do tempo, tarefas, comandos, evidências e aprovações da missão.",
      },
    ],
  }),
  component: MissionDetailPage,
});

function MissionDetailPage() {
  const { missionId } = Route.useParams();
  const { org } = useOrg();
  const qc = useQueryClient();
  const detail = useQuery({ ...missionDetailQuery(missionId), refetchInterval: 4000 });
  const agents = useQuery(agentsQuery(org!.id));
  const start = useServerFn(startMission);
  const stop = useServerFn(stopMission);
  const pause = useServerFn(pauseMission);
  const resume = useServerFn(resumeMission);
  const retry = useServerFn(retryMission);
  const [busy, setBusy] = useState(false);

  if (detail.isLoading)
    return (
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Carregando missão…
      </p>
    );
  if (!detail.data) return <p className="text-sm text-muted-foreground">Missão não encontrada.</p>;
  const { mission, tasks, events, commands, approvals, meetings, runs } = detail.data;
  const byId = (id: string | null) => agents.data?.find((a) => a.id === id);
  const commander = byId(mission.commander_agent_id);
  const live = ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(mission.status);
  const paused = mission.status === "STOPPED" && mission.phase.startsWith("paused:");
  const pending = approvals.filter((a) => a.status === "PENDING");
  const done = tasks.filter((t) => t.status === "completed").length;
  const report = (mission.report ?? null) as null | {
    tasks?: {
      code: string;
      title: string;
      status: string;
      owner: string;
      cost: number;
      retries: number;
    }[];
    evidenceCount?: number;
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
      qc.invalidateQueries({ queryKey: ["missions", org!.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "A ação falhou");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/missions" className="text-xs text-muted-foreground hover:text-foreground">
        ← Todas as missões
      </Link>
      <PageHeader
        eyebrow={`Missão · ${mission.phase}`}
        title={mission.title}
        description={mission.goal}
        actions={
          <>
            <StatusBadge status={mission.status} pulse={live} className="text-xs" />
            <StatusBadge status={mission.execution_mode} className="text-xs" />
            {mission.status === "DRAFT" && (
              <Button
                disabled={busy || org!.kill_switch_active}
                onClick={() => act(() => start({ data: { missionId } }), "Missão iniciada")}
              >
                Iniciar missão
              </Button>
            )}
            {live && !mission.stop_requested && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act(() => pause({ data: { missionId } }), "Pausa solicitada")}
              >
                Pausar
              </Button>
            )}

            {live && !mission.stop_requested && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act(() => stop({ data: { missionId } }), "Interrupção solicitada")}
              >
                Parar
              </Button>
            )}

            {paused && (
              <Button
                disabled={busy || org!.kill_switch_active}
                onClick={() => act(() => resume({ data: { missionId } }), "Missão retomada")}
              >
                Continuar
              </Button>
            )}

            {mission.status === "FAILED" && (
              <Button
                disabled={busy || org!.kill_switch_active}
                onClick={() => act(() => retry({ data: { missionId } }), "Nova tentativa iniciada")}
              >
                Tentar novamente
              </Button>
            )}
            {mission.stop_requested && live && (
              <span className="font-mono text-[10px] uppercase text-warning">pausando…</span>
            )}
          </>
        }
      />

      {mission.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {mission.error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Progresso"
          value={`${done}/${tasks.length}`}
          hint="tarefas concluídas"
          tone="primary"
        />
        <StatCard
          label="Etapas"
          value={`${mission.current_step}/${mission.max_steps}`}
          hint="ciclos utilizados"
        />
        <StatCard
          label="Custo"
          value={formatMoney(mission.total_cost)}
          hint={`orçamento ${formatMoney(mission.budget)}`}
          tone={Number(mission.total_cost) > Number(mission.budget) * 0.8 ? "warning" : "default"}
        />
        <StatCard
          label="Tokens"
          value={`${Number(mission.total_tokens_in) + Number(mission.total_tokens_out)}`}
          hint={`${mission.total_tokens_in} entrada · ${mission.total_tokens_out} saída`}
        />
        <StatCard
          label="Aprovações"
          value={pending.length}
          hint={pending.length ? "aguardando você" : `${approvals.length} no total`}
          tone={pending.length ? "warning" : "default"}
        />
      </div>

      {pending.length > 0 && (
        <section className="mb-6 space-y-3">
          <p className="eyebrow">Decisão humana necessária</p>
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} agent={byId(a.agent_id)} />
          ))}
        </section>
      )}

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tarefas · {tasks.length}</TabsTrigger>
          <TabsTrigger value="timeline">Linha do tempo · {events.length}</TabsTrigger>
          <TabsTrigger value="commands">Comandos · {commands.length}</TabsTrigger>
          <TabsTrigger value="runs">Execuções · {runs.length}</TabsTrigger>
          <TabsTrigger value="meetings">Reuniões · {meetings.length}</TabsTrigger>
          <TabsTrigger value="report">Relatório</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-2">
          {tasks.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">
              {live ? "O comandante ainda está planejando." : "Nenhuma tarefa foi criada."}
            </p>
          )}
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              agent={byId(t.assigned_agent_id)}
              allTasks={tasks}
              commands={commands.filter((c) => c.task_id === t.id)}
              agents={agents.data ?? []}
            />
          ))}
        </TabsContent>

        <TabsContent value="timeline">
          <ol className="relative ml-2 border-l border-border pl-5">
            {events.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">Nenhum evento ainda.</p>
            )}
            {[...events].reverse().map((ev) => {
              const a = byId(ev.agent_id);
              return (
                <li key={ev.id} className="relative pb-4">
                  <span
                    className={cn(
                      "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background",
                      toneFor(ev.type),
                    )}
                  />
                  <div className="flex items-start gap-2">
                    {a && <AgentAvatar agent={a} size={12} />}
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{ev.message}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {ev.type} · {formatTime(ev.created_at)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </TabsContent>

        <TabsContent value="commands" className="space-y-2">
          {commands.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">Nenhum comando emitido ainda.</p>
          )}
          {commands.map((c) => (
            <CommandCard
              key={c.id}
              command={c}
              from={byId(c.issued_by_agent_id)}
              to={byId(c.assigned_to_agent_id)}
            />
          ))}
        </TabsContent>

        <TabsContent value="runs" className="space-y-2">
          {runs.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">Nenhuma execução de agente ainda.</p>
          )}
          {runs.map((run) => (
            <div key={run.id} className="panel flex flex-wrap items-center gap-3 p-3 text-xs">
              <StatusBadge status={run.execution_mode} />
              <StatusBadge status={run.status} />
              <span className="font-medium">{byId(run.agent_id)?.name ?? "Sistema"}</span>
              <span className="text-muted-foreground">{run.request_summary ?? "execução"}</span>
              <span className="ml-auto font-mono text-muted-foreground">
                {run.latency_ms ?? 0} ms · {formatMoney(run.cost)}
              </span>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="meetings" className="space-y-3">
          {meetings.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">Nenhuma reunião realizada.</p>
          )}
          {meetings.map((m) => (
            <MeetingCard key={m.id} meeting={m} agents={agents.data ?? []} />
          ))}
        </TabsContent>

        <TabsContent value="report">
          {!mission.summary && !mission.result ? (
            <p className="py-6 text-sm text-muted-foreground">
              O relatório será criado quando a missão terminar.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="panel p-4 md:col-span-2">
                <p className="eyebrow">Resumo executivo</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {mission.summary}
                </p>
                {mission.result && (
                  <>
                    <p className="eyebrow mt-5">Resultado</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                      {mission.result}
                    </p>
                  </>
                )}
              </div>
              <div className="panel p-4">
                <p className="eyebrow">Dados</p>
                <div className="mt-2">
                  <KeyValue label="Comandante">{commander?.name ?? "—"}</KeyValue>
                  <KeyValue label="Iniciada">{formatTime(mission.started_at)}</KeyValue>
                  <KeyValue label="Concluída">{formatTime(mission.completed_at)}</KeyValue>
                  <KeyValue label="Custo total">{formatMoney(mission.total_cost)}</KeyValue>
                  <KeyValue label="Evidências">{report?.evidenceCount ?? "—"}</KeyValue>
                  <KeyValue label="Simulada">{mission.is_simulated ? "sim" : "não"}</KeyValue>
                </div>
                {report?.tasks && (
                  <table className="mt-4 w-full text-xs">
                    <tbody>
                      {report.tasks.map((t) => (
                        <tr key={t.code} className="border-t border-border/60">
                          <td className="py-1 font-mono text-muted-foreground">{t.code}</td>
                          <td className="py-1">{t.owner}</td>
                          <td className="py-1 text-right">{formatMoney(t.cost)}</td>
                          <td className="py-1 text-right">
                            <StatusBadge status={t.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function toneFor(type: string) {
  if (type.includes("FAILED") || type.includes("ERROR") || type.includes("KILL"))
    return "bg-destructive";
  if (type.includes("APPROVAL")) return "bg-status-needs-approval";
  if (type.includes("COMPLETED") || type.includes("APPROVED")) return "bg-success";
  if (type.includes("MEETING")) return "bg-status-meeting";
  if (type.includes("COMMAND") || type.includes("DELEGAT")) return "bg-status-delegating";
  return "bg-primary";
}

function TaskCard({
  task,
  agent,
  allTasks,
  commands,
  agents,
}: {
  task: Task;
  agent: Agent | undefined;
  allTasks: Task[];
  commands: Command[];
  agents: Agent[];
}) {
  const [open, setOpen] = useState(false);
  const evidence = (task.evidence ?? []) as unknown as Evidence[];
  const deps = task.depends_on.map((id) => allTasks.find((t) => t.id === id)?.code ?? "?");
  const attempt = taskAttemptCounter(task.retries, task.max_retries);
  return (
    <div className="panel">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="w-8 font-mono text-xs text-muted-foreground">{task.code}</span>
        {agent ? (
          <AgentAvatar agent={agent} size={16} />
        ) : (
          <span className="h-6 w-4 rounded-sm bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent?.name ?? "sem responsável"}
            {deps.length > 0 && ` · após ${deps.join(", ")}`}
            {task.retries > 0 && ` · tentativa ${attempt.current}/${attempt.max}`}
            {evidence.length > 0 && ` · ${evidence.length} evidência(s)`}
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatMoney(task.cost)}
        </span>
        <StatusBadge status={task.status} pulse={task.status === "running"} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
          {task.description && <p className="text-muted-foreground">{task.description}</p>}
          {task.result && (
            <div>
              <p className="eyebrow">Resultado</p>
              <p className="mt-1 whitespace-pre-wrap">{task.result}</p>
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <p className="eyebrow">Evidências</p>
              <ul className="mt-1 space-y-1.5">
                {evidence.map((e, i) => (
                  <li key={i} className="rounded-md border border-border/60 bg-background/40 p-2">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-info">
                      {e.type}
                    </p>
                    <p className="text-xs font-medium">{e.title}</p>
                    {e.content && (
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                        {e.content}
                      </pre>
                    )}
                    {e.simulated && (
                      <p className="font-mono text-[10px] text-simulation">evidência simulada</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {commands.length > 0 && (
            <div>
              <p className="eyebrow">Comandos desta tarefa</p>
              <ul className="mt-1 space-y-1">
                {commands.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    <StatusBadge status={c.status} />
                    <span className="text-muted-foreground">
                      {agents.find((a) => a.id === c.issued_by_agent_id)?.name ?? "—"} →{" "}
                      {agents.find((a) => a.id === c.assigned_to_agent_id)?.name ?? "—"}
                    </span>
                    <span className="truncate">{c.objective}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommandCard({
  command,
  from,
  to,
}: {
  command: Command;
  from: Agent | undefined;
  to: Agent | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-1.5">
          {from && <AgentAvatar agent={from} size={14} />}
          <span className="text-xs text-muted-foreground">→</span>
          {to && <AgentAvatar agent={to} size={14} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{command.objective}</p>
          <p className="truncate text-xs text-muted-foreground">
            {from?.name ?? "—"} para {to?.name ?? "—"} · {timeAgo(command.created_at)} ·
            ferramentas:{" "}
            {command.allowed_tools.length ? command.allowed_tools.join(", ") : "nenhuma"}
          </p>
        </div>
        <StatusBadge status={command.status} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs">
          <p className="whitespace-pre-wrap">{command.instructions}</p>
          {command.expected_output && (
            <p>
              <span className="text-muted-foreground">Saída esperada: </span>
              {command.expected_output}
            </p>
          )}
          {command.forbidden_actions.length > 0 && (
            <p>
              <span className="text-muted-foreground">Proibido: </span>
              {command.forbidden_actions.join(", ")}
            </p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground">
            max_iterations={command.max_iterations} · max_cost={formatMoney(command.max_cost)}
          </p>
          <StatusBadge status={command.execution_mode} />
        </div>
      )}
    </div>
  );
}

function MeetingCard({ meeting, agents }: { meeting: Meeting; agents: Agent[] }) {
  const msgs = useQuery(meetingMessagesQuery(meeting.id));
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{meeting.title}</p>
          <p className="text-xs text-muted-foreground">
            {meeting.topic} · round {meeting.current_round}/{meeting.max_rounds}
          </p>
        </div>
        <StatusBadge status={meeting.status === "active" ? "MEETING" : meeting.status} />
      </div>
      <ul className="mt-3 space-y-2">
        {(msgs.data ?? []).map((m) => {
          const a = agents.find((x) => x.id === m.agent_id);
          return (
            <li key={m.id} className="flex gap-2">
              {a && <AgentAvatar agent={a} size={14} />}
              <div>
                <p className="text-xs font-medium">
                  {a?.name ?? "—"}{" "}
                  <span className="font-mono text-[10px] text-muted-foreground">r{m.round}</span>
                </p>
                <p className="text-sm">{m.content}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {meeting.summary && (
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
          {meeting.summary}
        </p>
      )}
    </div>
  );
}
