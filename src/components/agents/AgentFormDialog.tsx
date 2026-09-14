import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { AGENT_PRESETS } from "@/agents/presets";
import { MODERN_CHARACTERS } from "@/office/registries";
import { wouldCreateCycle } from "@/agents/hierarchy";
import { AUTONOMY_LEVELS, type Agent, type AgentProvider, type Department } from "@/types/domain";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/shared/AgentAvatar";

const NONE = "__none__";
const APPEARANCES = MODERN_CHARACTERS;

interface Props {
  agents: Agent[];
  departments: Department[];
  providers: AgentProvider[];
  agent?: Agent;
  trigger: ReactNode;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export function AgentFormDialog({ agents, departments, providers, agent, trigger }: Props) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState(agent ? "custom" : "developer");
  const p0 = AGENT_PRESETS.find((p) => p.id === "developer")!;
  const [form, setForm] = useState({
    name: agent?.name ?? "",
    role: agent?.role ?? p0.role,
    description: agent?.description ?? "",
    kind: agent?.kind ?? p0.kind,
    department_id: agent?.department_id ?? NONE,
    manager_agent_id: agent?.manager_agent_id ?? NONE,
    provider_id: agent?.provider_id ?? NONE,
    model: agent?.model ?? "",
    context_limit: agent?.context_limit ?? 32000,
    system_prompt: agent?.system_prompt ?? p0.systemPrompt,
    personality: agent?.personality ?? "",
    autonomy_level: agent?.autonomy_level ?? p0.autonomy,
    color: agent?.color ?? p0.color,
    capabilities: agent?.capabilities ?? p0.capabilities,
    require_approval: agent?.require_approval ?? p0.requireApproval,
    max_cost: Number(agent?.max_cost ?? 2),
    max_iterations: agent?.max_iterations ?? 10,
    memory_enabled: agent?.memory_enabled ?? true,
    external_url: ((agent?.external_config ?? {}) as { url?: string }).url ?? "",
    workspace: ((agent?.external_config ?? {}) as { workspace?: string }).workspace ?? "",
    character_sprite_id: agent?.character_sprite_id ?? p0.characterSpriteId,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = AGENT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    const dept = departments.find(
      (d) => d.slug === p.department || d.name.toLowerCase() === p.department,
    );
    setForm((f) => ({
      ...f,
      role: p.role,
      kind: p.kind,
      autonomy_level: p.autonomy,
      color: p.color,
      character_sprite_id: p.characterSpriteId,
      capabilities: p.capabilities,
      require_approval: p.requireApproval,
      system_prompt: p.systemPrompt,
      department_id: dept?.id ?? f.department_id,
    }));
  };

  const managers = agents.filter(
    (a) =>
      a.id !== agent?.id &&
      a.kind !== "external" &&
      !(agent && wouldCreateCycle(agent.id, a.id, agents)),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setBusy(true);
    try {
      const preset_ = AGENT_PRESETS.find((x) => x.id === preset);
      const payload = {
        organization_id: org.id,
        name: form.name.trim(),
        slug: slugify(form.name.trim()) || `agent-${Date.now()}`,
        role: form.role.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        department_id: form.department_id === NONE ? null : form.department_id,
        manager_agent_id: form.manager_agent_id === NONE ? null : form.manager_agent_id,
        provider_id: form.provider_id === NONE ? null : form.provider_id,
        model: form.model.trim() || null,
        context_limit: form.context_limit,
        system_prompt: form.system_prompt.trim() || null,
        personality: form.personality.trim() || null,
        autonomy_level: form.autonomy_level,
        color: form.color,
        capabilities: form.capabilities,
        require_approval: form.require_approval,
        max_cost: form.max_cost,
        max_iterations: form.max_iterations,
        memory_enabled: form.memory_enabled,
        external_config: {
          ...((agent?.external_config ?? {}) as Record<string, string>),
          workspace: form.workspace.trim(),
          ...(form.kind === "external" ? { url: form.external_url.trim() } : {}),
        },
        character_sprite_id: form.character_sprite_id,
      };
      if (agent) {
        const { error } = await supabase.from("agents").update(payload).eq("id", agent.id);
        if (error) throw error;
        toast.success(`${payload.name} foi atualizado`);
      } else {
        const { data, error } = await supabase.from("agents").insert(payload).select("id").single();
        if (error) throw error;
        // seed permissions + tools from the preset so the agent is usable immediately
        if (preset_) {
          if (preset_.permissions.length) {
            await supabase.from("agent_permissions").insert(
              preset_.permissions.map((perm) => ({
                organization_id: org.id,
                agent_id: data.id,
                permission: perm,
                granted: true,
                always_allow: false,
              })),
            );
          }
          if (preset_.tools.length) {
            await supabase.from("agent_tools").insert(
              preset_.tools.map((tool) => ({
                organization_id: org.id,
                agent_id: data.id,
                tool_id: tool,
                enabled: true,
                config: {},
              })),
            );
          }
        }
        toast.success(`${payload.name} foi adicionado`);
      }
      qc.invalidateQueries({ queryKey: ["agents", org.id] });
      qc.invalidateQueries({ queryKey: ["agent-permissions"] });
      qc.invalidateQueries({ queryKey: ["agent-tools"] });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o agente");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {agent ? `Editar ${agent.name}` : "Adicionar agente"}
          </DialogTitle>
          <DialogDescription>
            {agent
              ? "As alterações valem para as próximas missões. Missões em execução mantêm o contexto atual."
              : "Comece por um modelo. Permissões e ferramentas poderão ser ajustadas depois."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          {!agent && (
            <div className="flex flex-wrap gap-1.5">
              {AGENT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
                    preset === p.id && "border-primary/50 text-primary",
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Workspace autorizado (caminho local absoluto)</Label>
              <Input
                value={form.workspace}
                onChange={(e) => set("workspace", e.target.value)}
                placeholder="A:\\Projetos\\meu-projeto"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                placeholder="Nova"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Função</Label>
              <Input
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                required
                placeholder="Desenvolvedor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => set("kind", v as Agent["kind"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llm">Agente de IA</SelectItem>
                  <SelectItem value="controller">Controlador / gestor</SelectItem>
                  <SelectItem value="external">Executor externo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Autonomia</Label>
              <Select
                value={String(form.autonomy_level)}
                onValueChange={(v) => set("autonomy_level", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTONOMY_LEVELS.map((l) => (
                    <SelectItem key={l.level} value={String(l.level)}>
                      L{l.level} · {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {AUTONOMY_LEVELS[form.autonomy_level]?.description}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Departamento</Label>
              <Select value={form.department_id} onValueChange={(v) => set("department_id", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem departamento</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Responde a</Label>
              <Select
                value={form.manager_agent_id}
                onValueChange={(v) => set("manager_agent_id", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Ninguém (topo da hierarquia)</SelectItem>
                  {managers.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Provedor</Label>
              <p className="text-xs text-muted-foreground">
                Backend:{" "}
                {String(
                  (
                    providers.find((p) => p.id === form.provider_id)?.config as Record<
                      string,
                      unknown
                    >
                  )?.["backend"] ?? "padrão do provedor",
                )}
              </p>
              <Select value={form.provider_id} onValueChange={(v) => set("provider_id", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Padrão da organização</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Modelo específico</Label>
              <Input
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="deixe vazio para usar o padrão do provedor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Limite de contexto (tokens)</Label>
              <Input
                type="number"
                min={1000}
                value={form.context_limit}
                onChange={(e) => set("context_limit", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set("color", e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent"
                />
                <Input
                  value={form.color}
                  onChange={(e) => set("color", e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Aparência do personagem</Label>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                {APPEARANCES.map((appearance) => (
                  <button
                    key={appearance.id}
                    type="button"
                    title={appearance.name}
                    onClick={() => set("character_sprite_id", appearance.id)}
                    className={cn(
                      "flex h-14 items-center justify-center rounded-md border border-border bg-card hover:border-primary/60",
                      form.character_sprite_id === appearance.id &&
                        "border-primary bg-primary/10 ring-1 ring-primary/30",
                    )}
                  >
                    <AgentAvatar
                      agent={{
                        name: appearance.name,
                        color: form.color,
                        character_sprite_id: appearance.id,
                        kind: form.kind,
                      }}
                      size={18}
                    />
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Avatares Adam, Alex, Amelia e Bob do pacote Modern Interiors.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Custo máximo por missão (USD)</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={form.max_cost}
                onChange={(e) => set("max_cost", Number(e.target.value))}
              />
            </div>
            {form.kind === "external" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Endereço externo (HTTPS)</Label>
                <Input
                  value={form.external_url}
                  onChange={(e) => set("external_url", e.target.value)}
                  placeholder="https://claudinho.example.com/api"
                />
                <p className="text-[11px] text-muted-foreground">
                  Os comandos são enviados para <code>/commands</code>. A disponibilidade é
                  verificada em <code>/health</code>. As credenciais ficam no provedor.
                </p>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Instruções do sistema</Label>
            <Textarea
              rows={4}
              value={form.system_prompt}
              onChange={(e) => set("system_prompt", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Personalidade (opcional)</Label>
              <Input
                value={form.personality}
                onChange={(e) => set("personality", e.target.value)}
                placeholder="objetivo, prioriza evidências"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="exibida nos detalhes do escritório"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              Exigir aprovação humana para usar ferramentas
              <Switch
                checked={form.require_approval}
                onCheckedChange={(v) => set("require_approval", v)}
              />
            </label>
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              Memória de longo prazo
              <Switch
                checked={form.memory_enabled}
                onCheckedChange={(v) => set("memory_enabled", v)}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Salvando…" : agent ? "Salvar alterações" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
