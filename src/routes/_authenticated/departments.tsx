import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, departmentsQuery } from "@/lib/queries";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { DEPARTMENT_KINDS, type Department } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/departments")({
  head: () => ({
    meta: [
      { title: "Departamentos — AI Pixel Office" },
      {
        name: "description",
        content: "Group agents into departments with their own context, manager and office zone.",
      },
      { property: "og:title", content: "Departments — AI Pixel Office" },
      {
        property: "og:description",
        content: "Group agents into departments with their own context, manager and office zone.",
      },
    ],
  }),
  component: DepartmentsPage,
});

const NONE = "__none__";

function DepartmentsPage() {
  const { org } = useOrg();
  const departments = useQuery(departmentsQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Organizar"
        title="Departamentos"
        description="Um departamento reúne contexto, liderança e agentes que trabalham juntos no escritório."
        actions={<DepartmentDialog trigger={<Button>Novo departamento</Button>} />}
      />
      {(departments.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhum departamento"
          description="Crie Engenharia, Pesquisa, Qualidade e depois atribua os agentes."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(departments.data ?? []).map((d) => {
            const members = (agents.data ?? []).filter((a) => a.department_id === d.id);
            const manager = agents.data?.find((a) => a.id === d.manager_agent_id);
            return (
              <div key={d.id} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="pixelated h-4 w-4 rounded-sm"
                      style={{ backgroundColor: d.color }}
                    />
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {members.length} agent{members.length === 1 ? "" : "s"} · lead{" "}
                        {manager?.name ?? "—"}
                      </p>
                    </div>
                  </div>
                  <DepartmentDialog
                    department={d}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  />
                </div>
                {d.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>
                )}
                {d.context && (
                  <p className="mt-2 rounded-md bg-background/50 p-2 font-mono text-[11px] text-muted-foreground">
                    {d.context}
                  </p>
                )}
                <ul className="mt-3 flex flex-wrap gap-2">
                  {members.map((a) => (
                    <li key={a.id}>
                      <Link
                        to="/agents/$agentId"
                        params={{ agentId: a.id }}
                        className="flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-1 text-xs hover:border-primary/40"
                      >
                        <AgentAvatar agent={a} size={12} />
                        {a.name}
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DepartmentDialog({
  department,
  trigger,
}: {
  department?: Department;
  trigger: React.ReactNode;
}) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const agents = useQuery(agentsQuery(org!.id));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: department?.name ?? "",
    color: department?.color ?? "#5aa9e0",
    description: department?.description ?? "",
    context: department?.context ?? "",
    manager_agent_id: department?.manager_agent_id ?? NONE,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        organization_id: org!.id,
        name: form.name.trim(),
        slug: form.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
        color: form.color,
        description: form.description.trim() || null,
        context: form.context.trim() || null,
        manager_agent_id: form.manager_agent_id === NONE ? null : form.manager_agent_id,
      };
      const q = department
        ? supabase.from("departments").update(payload).eq("id", department.id)
        : supabase.from("departments").insert(payload);
      const { error } = await q;
      if (error) throw error;
      toast.success(department ? "Departamento atualizado" : "Departamento criado");
      qc.invalidateQueries({ queryKey: ["departments", org!.id] });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {department ? `Editar ${department.name}` : "Novo departamento"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                list="dept-kinds"
              />
              <datalist id="dept-kinds">
                {DEPARTMENT_KINDS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="h-9 w-12 rounded-md border border-input bg-transparent"
                />
                <Input
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Agente responsável</Label>
            <Select
              value={form.manager_agent_id}
              onValueChange={(v) => setForm({ ...form, manager_agent_id: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {(agents.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contexto compartilhado com todos os agentes</Label>
            <Textarea
              rows={3}
              value={form.context}
              onChange={(e) => setForm({ ...form, context: e.target.value })}
              placeholder="Tecnologias, convenções, critérios de conclusão…"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
