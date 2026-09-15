import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, providersQuery } from "@/lib/queries";
import { startMission } from "@/orchestration/mission.functions";
import { agentLevel } from "@/agents/hierarchy";
import { providerBillingMode } from "@/orchestration/providers/billing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AgentAvatar } from "@/components/shared/AgentAvatar";

const EXAMPLES = [
  {
    title: "Melhorar a conversão inicial",
    goal: "Pesquise por que novos usuários desistem na primeira sessão, proponha três melhorias concretas e prepare um plano de implementação para a equipe de engenharia.",
  },
  {
    title: "Reforçar o webhook de pagamentos",
    goal: "Audite o webhook de pagamentos, crie testes de regressão e documente uma implantação gradual. A produção exige aprovação humana.",
  },
  {
    title: "Análise da concorrência",
    goal: "Analise os três concorrentes mais próximos, identifique lacunas de posicionamento e prepare uma recomendação para a liderança.",
  },
];

export function NewMissionDialog({
  trigger,
  defaultOpen = false,
}: {
  trigger?: ReactNode;
  defaultOpen?: boolean;
}) {
  const { org, settings } = useOrg();
  const orgId = org?.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: agents = [] } = useQuery({ ...agentsQuery(orgId), enabled: !!orgId });
  const { data: providers = [] } = useQuery({ ...providersQuery(orgId), enabled: !!orgId });
  const start = useServerFn(startMission);

  const [open, setOpen] = useState(defaultOpen);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [repository, setRepository] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [commander, setCommander] = useState<string>("");
  const [budget, setBudget] = useState(String(settings?.max_mission_cost ?? 5));
  const [maxSteps, setMaxSteps] = useState(String(settings?.max_steps ?? 60));
  const [approvalPolicy, setApprovalPolicy] = useState("policy");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autostart, setAutostart] = useState(true);
  const [busy, setBusy] = useState(false);

  const commanders = useMemo(
    () =>
      agents
        .filter((a) => a.kind !== "external" && !a.is_suspended)
        .sort((a, b) => agentLevel(a, agents) - agentLevel(b, agents)),
    [agents],
  );
  const defaultCommander = commanders.find((a) => a.is_primary_controller) ?? commanders[0];
  const effectiveCommander = commander || defaultCommander?.id || "";

  const billing = useMemo(() => {
    if (org?.simulation_mode) {
      return {
        usesMoney: false,
        hasPlanQuota: false,
        description: "Execução simulada/local: sem cobrança monetária.",
      };
    }

    const relevantAgents = selected.size
      ? agents.filter((agent) => selected.has(agent.id) || agent.id === effectiveCommander)
      : agents.filter((agent) => !agent.is_suspended);

    if (!relevantAgents.length || !providers.length) {
      return {
        usesMoney: true,
        hasPlanQuota: false,
        description: "Orçamento monetário disponível para provedores medidos por uso.",
      };
    }

    const modes = relevantAgents.map((agent) =>
      providerBillingMode(providers.find((provider) => provider.id === agent.provider_id)),
    );
    const usesMoney = modes.includes("METERED");
    const hasPlanQuota = modes.includes("PLAN_QUOTA");

    return {
      usesMoney,
      hasPlanQuota,
      description: usesMoney
        ? "Há pelo menos um provedor com cobrança por uso/token nesta missão."
        : hasPlanQuota
          ? "Sem cobrança por token: o limite é do plano/tempo/cota semanal do provedor."
          : "Todos os provedores selecionados são gratuitos ou locais.",
    };
  }, [agents, effectiveCommander, org?.simulation_mode, providers, selected]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !effectiveCommander) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("missions")
        .insert({
          organization_id: org.id,
          title: title.trim(),
          goal: goal.trim(),
          mission_contract: {
            repository: repository.trim() || null,
            workspace: workspace.trim() || null,
          },
          commander_agent_id: effectiveCommander,
          budget: billing.usesMoney ? Number(budget) || 0 : 0,
          max_steps: Number(maxSteps) || 60,
          approval_policy: approvalPolicy,
          allowed_agent_ids: Array.from(selected),
          is_simulated: org.simulation_mode,
          status: "DRAFT",
        })
        .select("id")
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["missions", org.id] });
      if (autostart) {
        await start({ data: { missionId: data.id } });
        toast.success("Missão iniciada", {
          description: `${agents.find((a) => a.id === effectiveCommander)?.name ?? "Comandante"} está planejando.`,
        });
      } else {
        toast.success("Missão salva como rascunho");
      }
      setOpen(false);
      setTitle("");
      setGoal("");
      setRepository("");
      setWorkspace("");
      setSelected(new Set());
      navigate({ to: "/missions/$missionId", params: { missionId: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar a missão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Nova missão</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Criar nova missão</DialogTitle>
          <DialogDescription>
            Defina o objetivo e escolha um comandante. Ele planejará, delegará pela cadeia de
            comando, revisará as evidências e apresentará o resultado. Ações de risco aguardam sua
            aprovação.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.title}
                type="button"
                onClick={() => {
                  setTitle(ex.title);
                  setGoal(ex.goal);
                }}
                className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
              >
                {ex.title}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Título</Label>
            <Input
              id="m-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
              placeholder="O que a equipe deve alcançar?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-goal">Objetivo e restrições</Label>
            <Textarea
              id="m-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
              rows={4}
              placeholder="Descreva o resultado, os critérios de sucesso e os limites."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-repository">Repositório GitHub</Label>

              <Input
                id="m-repository"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder="owner/repository"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-workspace">Workspace local</Label>

              <Input
                id="m-workspace"
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
                placeholder="A:\Ambiente\Projeto"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label>Comandante</Label>
              <Select value={effectiveCommander} onValueChange={setCommander}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha um comandante" />
                </SelectTrigger>
                <SelectContent>
                  {commanders.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-budget">Orçamento (USD)</Label>
              <Input
                id="m-budget"
                type="number"
                step="0.5"
                min="0"
                value={billing.usesMoney ? budget : "0"}
                onChange={(e) => setBudget(e.target.value)}
                disabled={!billing.usesMoney}
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                {billing.description}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-steps">Máximo de etapas</Label>
              <Input
                id="m-steps"
                type="number"
                min="5"
                max="500"
                value={maxSteps}
                onChange={(e) => setMaxSteps(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Política de aprovação</Label>
            <Select value={approvalPolicy} onValueChange={setApprovalPolicy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="policy">Política da organização (recomendado)</SelectItem>
                <SelectItem value="always">Aprovar toda chamada de ferramenta</SelectItem>
                <SelectItem value="high_risk">Somente riscos ALTO e CRÍTICO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Restringir a agentes (opcional)</Label>
            <p className="text-xs text-muted-foreground">
              Deixe vazio para permitir toda a organização. Agentes externos indisponíveis serão
              ignorados.
            </p>
            <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {agents.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-accent"
                >
                  <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                  <AgentAvatar agent={a} size={14} />
                  <span className="truncate text-xs">
                    {a.name} <span className="text-muted-foreground">· {a.role}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={autostart} onCheckedChange={(v) => setAutostart(v === true)} />
              Iniciar imediatamente
            </label>
            <div className="flex items-center gap-2">
              {org?.simulation_mode && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-simulation">
                  execução simulada
                </span>
              )}
              <Button
                type="submit"
                disabled={busy || !effectiveCommander || org?.kill_switch_active}
              >
                {busy ? "Preparando…" : autostart ? "Iniciar missão" : "Salvar rascunho"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
