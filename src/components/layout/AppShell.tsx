import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useOrgRealtime } from "@/lib/realtime";
import { useMissionRunner } from "@/lib/mission-runner";
import { approvalsQuery, missionsQuery } from "@/lib/queries";
import { setKillSwitch } from "@/orchestration/mission.functions";
import { BootScreen } from "./BootScreen";
import { CreateOrganization } from "./CreateOrganization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV: {
  to: string;
  label: string;
  glyph: string;
  group: "operate" | "organize" | "govern";
}[] = [
  { to: "/office", label: "Escritório", glyph: "▣", group: "operate" },
  { to: "/dashboard", label: "Painel", glyph: "◫", group: "operate" },
  { to: "/missions", label: "Missões", glyph: "◎", group: "operate" },
  { to: "/tasks", label: "Tarefas", glyph: "☰", group: "operate" },
  { to: "/approvals", label: "Aprovações", glyph: "✓", group: "govern" },
  { to: "/logs", label: "Registro de auditoria", glyph: "≡", group: "govern" },
  { to: "/costs", label: "Custos", glyph: "$", group: "govern" },
  { to: "/organization", label: "Organização", glyph: "⌂", group: "organize" },
  { to: "/agents", label: "Agentes", glyph: "☺", group: "organize" },
  { to: "/departments", label: "Departamentos", glyph: "▤", group: "organize" },
  { to: "/providers", label: "Provedores", glyph: "⚡", group: "organize" },
  { to: "/settings", label: "Configurações", glyph: "⚙", group: "organize" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { org, organizations, loading, setActiveOrg } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const orgId = org?.id ?? null;
  useOrgRealtime(orgId);
  useMissionRunner(orgId, !!org && !org.kill_switch_active);

  const approvals = useQuery({ ...approvalsQuery(orgId ?? ""), enabled: !!orgId });
  const missions = useQuery({ ...missionsQuery(orgId ?? ""), enabled: !!orgId });
  const pending = approvals.data?.filter((a) => a.status === "PENDING").length ?? 0;
  const activeMissions =
    missions.data?.filter((m) =>
      ["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"].includes(m.status),
    ).length ?? 0;

  const killFn = useServerFn(setKillSwitch);
  const [killOpen, setKillOpen] = useState(false);
  const toggleKill = async () => {
    if (!org) return;
    try {
      await killFn({ data: { orgId: org.id, active: !org.kill_switch_active } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["organizations"] }),
        qc.invalidateQueries({ queryKey: ["agents", org.id] }),
        qc.invalidateQueries({ queryKey: ["missions", org.id] }),
      ]);
      toast(
        org.kill_switch_active
          ? "Interrupção de emergência liberada"
          : "Interrupção de emergência ativada",
        {
          description: org.kill_switch_active
            ? "Os agentes podem retomar o trabalho."
            : "Todas as missões foram interrompidas e os agentes pausados.",
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a interrupção geral");
    } finally {
      setKillOpen(false);
    }
  };

  if (loading) return <BootScreen label="Carregando organização" />;
  if (!org) return <CreateOrganization firstRun />;

  const isOffice = pathname.startsWith("/office");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="pixelated grid h-8 w-8 grid-cols-2 gap-0.5 rounded-sm bg-primary/10 p-1">
            <i className="bg-primary" />
            <i className="bg-info" />
            <i className="bg-success" />
            <i className="bg-simulation" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold leading-tight">AI Pixel Office</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              v1.2 · local
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-left text-sm hover:bg-sidebar-accent">
              <span className="min-w-0">
                <span className="block truncate font-medium">{org.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  /{org.slug}
                </span>
              </span>
              <span className="text-muted-foreground">⌄</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Organizações</DropdownMenuLabel>
            {organizations.map((o) => (
              <DropdownMenuItem
                key={o.id}
                onClick={() => setActiveOrg(o.id)}
                className={cn(o.id === org.id && "text-primary")}
              >
                {o.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => navigate({ to: "/organization", search: { create: true } })}
            >
              + Nova organização
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {(["operate", "govern", "organize"] as const).map((group) => (
            <div key={group} className="mb-3">
              <p className="eyebrow px-2 pb-1 pt-2">
                {{ operate: "Operar", govern: "Governar", organize: "Organizar" }[group]}
              </p>
              {NAV.filter((n) => n.group === group).map((n) => {
                const active = pathname === n.to || pathname.startsWith(n.to + "/");
                const badge =
                  n.to === "/approvals" ? pending : n.to === "/missions" ? activeMissions : 0;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      active && "bg-sidebar-accent text-sidebar-primary",
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 text-center font-mono text-xs text-muted-foreground group-hover:text-foreground",
                        active && "text-primary",
                      )}
                    >
                      {n.glyph}
                    </span>
                    <span className="flex-1">{n.label}</span>
                    {badge > 0 && (
                      <span
                        className={cn(
                          "rounded-sm px-1.5 font-mono text-[10px] font-semibold",
                          n.to === "/approvals"
                            ? "bg-status-needs-approval/20 text-status-needs-approval"
                            : "bg-status-working/20 text-status-working",
                        )}
                      >
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Button
            variant={org.kill_switch_active ? "outline" : "destructive"}
            className="w-full font-mono text-xs uppercase tracking-wider"
            onClick={() => setKillOpen(true)}
          >
            {org.kill_switch_active ? "Liberar emergência" : "■ Interromper tudo"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/40 px-4">
          <div className="flex items-center gap-2">
            {org.kill_switch_active && (
              <Badge
                variant="destructive"
                className="animate-pulse-soft font-mono text-[10px] uppercase tracking-wider"
              >
                Emergência ativa
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider",
                org.simulation_mode
                  ? "border-simulation/40 text-simulation"
                  : "border-success/40 text-success",
              )}
            >
              {org.simulation_mode ? "Modo de simulação" : "Provedores ativos"}
            </Badge>
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              visual · modern office
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            {activeMissions > 0 && (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-status-working">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-status-working" />
                {activeMissions} {activeMissions > 1 ? "missões ativas" : "missão ativa"}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
                  <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary/15 font-mono text-[11px] font-semibold text-primary">
                    L
                  </span>
                  <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground md:block">
                    Operador local
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  Aplicativo local
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                  Configurações
                </DropdownMenuItem>
                <DropdownMenuItem disabled>Sem conta ou login</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main
          className={cn(
            "min-h-0 flex-1",
            isOffice ? "overflow-hidden" : "overflow-y-auto px-6 py-6",
          )}
        >
          {children}
        </main>
      </div>

      <AlertDialog open={killOpen} onOpenChange={setKillOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {org.kill_switch_active
                ? "Liberar a interrupção de emergência?"
                : "Interromper todas as operações?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {org.kill_switch_active
                ? "Os agentes poderão retomar. Missões já interrompidas continuarão paradas."
                : "Toda missão em execução será interrompida imediatamente, os agentes serão pausados e nenhum provedor será chamado até a liberação."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={toggleKill}
              className={cn(
                !org.kill_switch_active &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {org.kill_switch_active ? "Liberar" : "Interromper tudo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
