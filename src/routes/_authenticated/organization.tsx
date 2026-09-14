import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { useAuth } from "@/lib/auth";
import { agentsQuery, departmentsQuery, officeMapQuery, providersQuery } from "@/lib/queries";
import { PageHeader, StatCard, KeyValue, formatTime } from "@/components/shared/PageHeader";
import { CreateOrganization } from "@/components/layout/CreateOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Enums } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/organization")({
  validateSearch: z.object({ create: z.boolean().optional() }),
  head: () => ({
    meta: [
      { title: "Organização — AI Pixel Office" },
      { name: "description", content: "Tenant overview, members and roles." },
      { property: "og:title", content: "Organization — AI Pixel Office" },
      { property: "og:description", content: "Tenant overview, members and roles." },
    ],
  }),
  component: OrganizationPage,
});

type Role = Enums<"app_role">;

function OrganizationPage() {
  const { org } = useOrg();
  const { user } = useAuth();
  const { create } = Route.useSearch();
  const qc = useQueryClient();
  const agents = useQuery(agentsQuery(org!.id));
  const departments = useQuery(departmentsQuery(org!.id));
  const providers = useQuery(providersQuery(org!.id));
  const map = useQuery(officeMapQuery(org!.id));
  const members = useQuery({
    queryKey: ["members", org!.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("*")
        .eq("organization_id", org!.id)
        .order("created_at");
      if (error) throw error;
      const ids = data.map((m) => m.user_id);
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", ids);
      return data.map((m) => ({
        ...m,
        profile: profiles?.find((p) => p.id === m.user_id) ?? null,
      }));
    },
  });
  const me = members.data?.find((m) => m.user_id === user?.id);
  const canManage = me?.role === "owner" || me?.role === "admin";
  const [name, setName] = useState(org!.name);
  const [createOpen, setCreateOpen] = useState(!!create);

  const rename = async () => {
    const { error } = await supabase
      .from("organizations")
      .update({ name: name.trim() })
      .eq("id", org!.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Renamed");
      qc.invalidateQueries({ queryKey: ["organizations"] });
    }
  };

  const setRole = async (memberId: string, role: Role) => {
    const { error } = await supabase
      .from("organization_members")
      .update({ role })
      .eq("id", memberId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["members", org!.id] });
  };

  const removeMember = async (memberId: string) => {
    const { error } = await supabase.from("organization_members").delete().eq("id", memberId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["members", org!.id] });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Organizar"
        title={org!.name}
        description="Uma organização reúne seus agentes, departamentos, políticas e escritório local."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Nova organização</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">Criar outra organização</DialogTitle>
              </DialogHeader>
              <CreateOrganization onDone={() => setCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Agentes" value={agents.data?.length ?? 0} />
        <StatCard label="Departamentos" value={departments.data?.length ?? 0} />
        <StatCard label="Provedores" value={providers.data?.length ?? 0} />
        <StatCard
          label="Escritório"
          value={map.data ? `${map.data.map.width}×${map.data.map.height}` : "—"}
          hint={
            map.data
              ? `${map.data.zones.length} cômodos · ${map.data.workstations.length} mesas`
              : "sem planta"
          }
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="panel p-4">
          <p className="eyebrow mb-3">Identidade</p>
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
              <Button
                variant="outline"
                onClick={rename}
                disabled={!canManage || name.trim() === org!.name}
              >
                Salvar
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <KeyValue label="Slug">
              <code className="font-mono text-xs">{org!.slug}</code>
            </KeyValue>
            <KeyValue label="Criada em">{formatTime(org!.created_at)}</KeyValue>
            <KeyValue label="Sua função">
              <span className="font-mono text-xs uppercase text-primary">{me?.role ?? "—"}</span>
            </KeyValue>
            <KeyValue label="Simulação">{org!.simulation_mode ? "ativada" : "desativada"}</KeyValue>
            <KeyValue label="Interrupção geral">
              {org!.kill_switch_active ? "ATIVA" : "liberada"}
            </KeyValue>
          </div>
        </section>

        <section className="panel p-4 lg:col-span-2">
          <p className="eyebrow mb-3">Membros · {members.data?.length ?? 0}</p>
          <ul className="divide-y divide-border/60">
            {(members.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary/15 font-mono text-xs text-primary">
                  {(m.profile?.display_name ?? m.profile?.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {m.profile?.display_name ?? m.profile?.email ?? m.user_id}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.profile?.email}</p>
                </div>
                {canManage && m.role !== "owner" ? (
                  <>
                    <Select value={m.role} onValueChange={(v) => setRole(m.id, v as Role)}>
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="member">member</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => removeMember(m.id)}
                    >
                      Remover
                    </Button>
                  </>
                ) : (
                  <span className="font-mono text-xs uppercase text-muted-foreground">
                    {m.role}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Este aplicativo funciona localmente e não utiliza convites, contas ou login.
          </p>
        </section>
      </div>
    </div>
  );
}
