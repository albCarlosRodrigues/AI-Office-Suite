import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { PERMISSIONS } from "@/permissions/catalog";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrgPolicy } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Configurações — AI Pixel Office" },
      {
        name: "description",
        content: "Policies, budgets, approval rules, simulation and asset mode.",
      },
      { property: "og:title", content: "Settings — AI Pixel Office" },
      {
        property: "og:description",
        content: "Policies, budgets, approval rules, simulation and asset mode.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { org, settings } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    simulation_mode: org!.simulation_mode,
    asset_mode: org!.asset_mode,
    max_mission_cost: Number(settings?.max_mission_cost ?? 5),
    max_steps: settings?.max_steps ?? 60,
    max_agent_calls: settings?.max_agent_calls ?? 200,
    max_delegation_depth: settings?.max_delegation_depth ?? 3,
    max_meeting_rounds: settings?.max_meeting_rounds ?? 3,
    default_timeout_seconds: settings?.default_timeout_seconds ?? 60,
    daily_cost_limit: settings?.daily_cost_limit == null ? "" : String(settings.daily_cost_limit),
    monthly_cost_limit:
      settings?.monthly_cost_limit == null ? "" : String(settings.monthly_cost_limit),
    require_approval_for: settings?.require_approval_for ?? [],
    policies: ((settings?.policies ?? []) as unknown as OrgPolicy[]).map((p) => ({ ...p })),
  });
  const [newRule, setNewRule] = useState("");

  useEffect(() => {
    if (!settings) return;
    setForm((f) => ({
      ...f,
      max_mission_cost: Number(settings.max_mission_cost),
      max_steps: settings.max_steps,
      max_agent_calls: settings.max_agent_calls,
      max_delegation_depth: settings.max_delegation_depth,
      max_meeting_rounds: settings.max_meeting_rounds,
      default_timeout_seconds: settings.default_timeout_seconds,
      daily_cost_limit: settings.daily_cost_limit == null ? "" : String(settings.daily_cost_limit),
      monthly_cost_limit:
        settings.monthly_cost_limit == null ? "" : String(settings.monthly_cost_limit),
      require_approval_for: settings.require_approval_for,
      policies: ((settings.policies ?? []) as unknown as OrgPolicy[]).map((p) => ({ ...p })),
    }));
  }, [settings]);

  const toggleApproval = (perm: string) =>
    setForm((f) => ({
      ...f,
      require_approval_for: f.require_approval_for.includes(perm)
        ? f.require_approval_for.filter((p) => p !== perm)
        : [...f.require_approval_for, perm],
    }));

  const save = async () => {
    setBusy(true);
    try {
      const { error: e1 } = await supabase
        .from("organizations")
        .update({ simulation_mode: form.simulation_mode, asset_mode: form.asset_mode })
        .eq("id", org!.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("organization_settings").upsert(
        {
          organization_id: org!.id,
          max_mission_cost: form.max_mission_cost,
          max_steps: form.max_steps,
          max_agent_calls: form.max_agent_calls,
          max_delegation_depth: form.max_delegation_depth,
          max_meeting_rounds: form.max_meeting_rounds,
          default_timeout_seconds: form.default_timeout_seconds,
          daily_cost_limit: form.daily_cost_limit === "" ? null : Number(form.daily_cost_limit),
          monthly_cost_limit:
            form.monthly_cost_limit === "" ? null : Number(form.monthly_cost_limit),
          require_approval_for: form.require_approval_for,
          policies: form.policies as never,
        },
        { onConflict: "organization_id" },
      );
      if (e2) throw e2;
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["org-settings", org!.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Organizar"
        title="Configurações e políticas"
        description="Limites aplicados a todas as missões e políticas incluídas no contexto de cada agente."
        actions={
          <Button onClick={save} disabled={busy}>
            {busy ? "Salvando…" : "Salvar alterações"}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <p className="eyebrow mb-3">Modo</p>
          <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <span>
              <span className="block text-sm font-medium">Modo de simulação</span>
              <span className="block text-xs text-muted-foreground">
                As missões usam o provedor determinístico local, sem chamadas externas ou cobrança.
                Os custos ficam identificados como simulados.
              </span>
            </span>
            <Switch
              checked={form.simulation_mode}
              onCheckedChange={(v) => setForm({ ...form, simulation_mode: v })}
            />
          </label>
          <div className="mt-3 space-y-1.5">
            <Label>Conjunto visual</Label>
            <Select
              value={form.asset_mode}
              onValueChange={(v) => setForm({ ...form, asset_mode: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="modern-office-revamped">
                  Modern Office Revamped 1.2 + personagens personalizados
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              O cenário utiliza o pacote fornecido. Os personagens são gerados localmente porque o
              ZIP não contém sprites humanos.
            </p>
          </div>
        </section>

        <section className="panel p-4">
          <p className="eyebrow mb-3">Limites operacionais</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Orçamento padrão por missão (USD)">
              <Input
                type="number"
                step="0.5"
                min="0"
                value={form.max_mission_cost}
                onChange={num("max_mission_cost")}
              />
            </Field>
            <Field label="Máximo de etapas por missão">
              <Input type="number" min="5" value={form.max_steps} onChange={num("max_steps")} />
            </Field>
            <Field label="Máximo de chamadas de agentes">
              <Input
                type="number"
                min="1"
                value={form.max_agent_calls}
                onChange={num("max_agent_calls")}
              />
            </Field>
            <Field label="Profundidade máxima de delegação">
              <Input
                type="number"
                min="1"
                max="6"
                value={form.max_delegation_depth}
                onChange={num("max_delegation_depth")}
              />
            </Field>
            <Field label="Máximo de rodadas de reunião">
              <Input
                type="number"
                min="1"
                max="10"
                value={form.max_meeting_rounds}
                onChange={num("max_meeting_rounds")}
              />
            </Field>
            <Field label="Tempo limite padrão (s)">
              <Input
                type="number"
                min="5"
                value={form.default_timeout_seconds}
                onChange={num("default_timeout_seconds")}
              />
            </Field>
            <Field label="Limite diário (USD, vazio = sem limite)">
              <Input
                type="number"
                step="1"
                min="0"
                value={form.daily_cost_limit}
                onChange={(e) => setForm({ ...form, daily_cost_limit: e.target.value })}
              />
            </Field>
            <Field label="Limite mensal (USD, vazio = sem limite)">
              <Input
                type="number"
                step="1"
                min="0"
                value={form.monthly_cost_limit}
                onChange={(e) => setForm({ ...form, monthly_cost_limit: e.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className="panel p-4">
          <p className="eyebrow mb-1">Sempre exigir aprovação humana para</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Regardless of the agent's own grants. CRITICAL permissions can never be auto-approved.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {PERMISSIONS.map((p) => {
              const locked = p.risk === "CRITICAL";
              const on = locked || form.require_approval_for.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {p.label}
                    <StatusBadge status={p.risk} />
                  </span>
                  <Switch
                    checked={on}
                    disabled={locked}
                    onCheckedChange={() => toggleApproval(p.id)}
                  />
                </label>
              );
            })}
          </div>
        </section>

        <section className="panel p-4">
          <p className="eyebrow mb-1">Políticas da organização</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Plain-language rules every agent receives. Enforced rules are also turned into forbidden
            actions on each command.
          </p>
          <ul className="space-y-1.5">
            {form.policies.map((p, i) => (
              <li
                key={p.id}
                className="flex items-start gap-2 rounded-md border border-border/60 p-2"
              >
                <Switch
                  checked={p.enforced}
                  onCheckedChange={(v) =>
                    setForm({
                      ...form,
                      policies: form.policies.map((x, j) => (j === i ? { ...x, enforced: v } : x)),
                    })
                  }
                />
                <p className="flex-1 text-sm">{p.rule}</p>
                <button
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    setForm({ ...form, policies: form.policies.filter((_, j) => j !== i) })
                  }
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="Ex.: Nunca entrar em contato direto com clientes."
            />
            <Button
              variant="outline"
              disabled={!newRule.trim()}
              onClick={() => {
                setForm({
                  ...form,
                  policies: [
                    ...form.policies,
                    { id: `pol-${Date.now()}`, rule: newRule.trim(), enforced: true },
                  ],
                });
                setNewRule("");
              }}
            >
              Add
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
