import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, providersQuery } from "@/lib/queries";
import { saveProviderSecret, testProvider } from "@/orchestration/providers.functions";
import { PageHeader, EmptyState, timeAgo } from "@/components/shared/PageHeader";
import { StartupStatus } from "@/components/agents/StartupStatus";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { AgentProvider, ProviderType } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({
    meta: [
      { title: "Provedores — AI Pixel Office" },
      {
        name: "description",
        content:
          "Connect simulation, Lovable AI, OpenAI-compatible endpoints and external executors.",
      },
      { property: "og:title", content: "Providers — AI Pixel Office" },
      {
        property: "og:description",
        content:
          "Connect simulation, Lovable AI, OpenAI-compatible endpoints and external executors.",
      },
    ],
  }),
  component: ProvidersPage,
});

const TYPES: {
  value: ProviderType;
  label: string;
  hint: string;
  needsKey: boolean;
  needsUrl: boolean;
  defaultModel: string;
}[] = [
  {
    value: "simulation",
    label: "Simulation",
    hint: "Deterministic, free, offline. Perfect for testing hierarchy and policies.",
    needsKey: false,
    needsUrl: false,
    defaultModel: "sim-1",
  },
  {
    value: "lovable_ai",
    label: "Lovable AI",
    hint: "Built-in gateway. No key needed; billed to the workspace.",
    needsKey: false,
    needsUrl: false,
    defaultModel: "google/gemini-3.8-flash",
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "api.openai.com with your own key.",
    needsKey: true,
    needsUrl: false,
    defaultModel: "gpt-4.1-mini",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "OpenAI-compatible endpoint with your key.",
    needsKey: true,
    needsUrl: false,
    defaultModel: "claude-sonnet-4-5",
  },
  {
    value: "gemini",
    label: "Google Gemini",
    hint: "OpenAI-compatible Gemini endpoint.",
    needsKey: true,
    needsUrl: false,
    defaultModel: "gemini-2.5-flash",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    hint: "Any model through OpenRouter.",
    needsKey: true,
    needsUrl: false,
    defaultModel: "openai/gpt-4.1-mini",
  },
  {
    value: "ollama",
    label: "Ollama (local)",
    hint: "Self-hosted models. Provide the base URL.",
    needsKey: false,
    needsUrl: true,
    defaultModel: "llama3.1",
  },
  {
    value: "custom",
    label: "Agente externo / personalizado",
    hint: "Claudinho-style executor speaking the command protocol, or any OpenAI-compatible URL.",
    needsKey: false,
    needsUrl: true,
    defaultModel: "",
  },
];

function ProvidersPage() {
  const { org } = useOrg();
  const providers = useQuery(providersQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const qc = useQueryClient();
  const test = useServerFn(testProvider);
  const [testing, setTesting] = useState<string | null>(null);

  const runTest = async (p: AgentProvider) => {
    setTesting(p.id);
    try {
      const r = await test({ data: { providerId: p.id } });
      (r.health === "CONNECTED" ? toast.success : toast.warning)(`${p.name}: ${r.health}`, {
        description: `${r.message} (${r.latencyMs} ms)`,
      });
      qc.invalidateQueries({ queryKey: ["providers", org!.id] });
      qc.invalidateQueries({ queryKey: ["agents", org!.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Health check failed");
    } finally {
      setTesting(null);
    }
  };

  const toggle = async (p: AgentProvider, enabled: boolean) => {
    const { error } = await supabase
      .from("agent_providers")
      .update({ is_enabled: enabled, health: enabled ? "UNKNOWN" : "DISABLED" })
      .eq("id", p.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["providers", org!.id] });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <StartupStatus />
      <PageHeader
        eyebrow="Organizar"
        title="Provedores"
        description="Serviços opcionais que fornecem inteligência aos agentes. Credenciais ficam somente neste computador."
        actions={<ProviderDialog trigger={<Button>Adicionar provedor</Button>} />}
      />
      {(providers.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhum provedor"
          description="Adicione o provedor de simulação para testar localmente ou conecte um modelo externo."
        />
      ) : (
        <div className="space-y-3">
          {(providers.data ?? []).map((p) => {
            const used = (agents.data ?? []).filter((a) => a.provider_id === p.id);
            const meta = TYPES.find((t) => t.value === p.type);
            return (
              <div key={p.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{p.name}</p>
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">
                        {meta?.label ?? p.type}
                      </span>
                      <StatusBadge status={p.health} pulse={p.health === "CONNECTED"} />
                      {!p.is_enabled && (
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          disabled
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {p.model ?? "no default model"}
                      {p.base_url && ` · ${p.base_url}`}
                      {` · key ${p.has_api_key ? "set" : "none"}`}
                      {` · timeout ${p.timeout_ms / 1000}s`}
                      {p.last_health_check_at && ` · checked ${timeAgo(p.last_health_check_at)}`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Used by {used.length} agent{used.length === 1 ? "" : "s"}
                      {used.length > 0 && `: ${used.map((a) => a.name).join(", ")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={p.is_enabled} onCheckedChange={(v) => toggle(p, v)} />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testing === p.id}
                      onClick={() => runTest(p)}
                    >
                      {testing === p.id ? "Testing…" : "Test connection"}
                    </Button>
                    <ProviderDialog
                      provider={p}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderDialog({ provider, trigger }: { provider?: AgentProvider; trigger: ReactNode }) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const save = useServerFn(saveProviderSecret);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cfg = (provider?.config ?? {}) as {
    kind?: string;
    backend?: string;
    sessionId?: string;
    conversationId?: string;
    composerLabel?: string;
  };
  const [form, setForm] = useState({
    name: provider?.name ?? "",
    type: (provider?.type ?? "lovable_ai") as ProviderType,
    base_url: provider?.base_url ?? "",
    model: provider?.model ?? TYPES.find((t) => t.value === "lovable_ai")!.defaultModel,
    temperature: Number(provider?.temperature ?? 0.2),
    max_tokens: provider?.max_tokens ?? 4096,
    timeout_ms: provider?.timeout_ms ?? 60000,
    external_agent: cfg.kind === "external_agent",
    backend: cfg.backend ?? "default",
    sessionId: cfg.sessionId ?? "",
    conversationId: cfg.conversationId ?? "",
    composerLabel: cfg.composerLabel ?? "",
    api_key: "",
    bearer_token: "",
  });
  const meta = TYPES.find((t) => t.value === form.type)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        organization_id: org!.id,
        name: form.name.trim(),
        type: form.type,
        base_url: form.base_url.trim() || null,
        model: form.model.trim() || null,
        temperature: form.temperature,
        max_tokens: form.max_tokens,
        timeout_ms: form.timeout_ms,
        config: {
          ...((provider?.config ?? {}) as Record<string, string>),
          backend: form.backend,
          sessionId: form.sessionId,
          conversationId: form.conversationId,
          composerLabel: form.composerLabel,
          ...(form.type === "custom" && form.external_agent ? { kind: "external_agent" } : {}),
        },
      };
      let id = provider?.id;
      if (provider) {
        const { error } = await supabase
          .from("agent_providers")
          .update(payload)
          .eq("id", provider.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("agent_providers")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }
      if (id && (form.api_key || form.bearer_token)) {
        await save({
          data: {
            providerId: id,
            apiKey: form.api_key || null,
            bearerToken: form.bearer_token || null,
          },
        });
      }
      toast.success(provider ? "Provider updated" : "Provider added");
      qc.invalidateQueries({ queryKey: ["providers", org!.id] });
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {provider ? `Editar ${provider.name}` : "Adicionar provedor"}
          </DialogTitle>
          <DialogDescription>{meta.hint}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Backend de execução</Label>
            <Select
              value={form.backend}
              onValueChange={(backend) =>
                setForm({
                  ...form,
                  backend,
                  ...(backend === "prx-localant"
                    ? {
                        type: "custom",
                        base_url: "http://127.0.0.1:9223",
                        model: "chatgpt-session",
                        external_agent: false,
                      }
                    : backend === "free-claude"
                      ? {
                          type: "openrouter",
                          base_url: "https://openrouter.ai/api/v1",
                          model: "",
                          external_agent: false,
                        }
                      : {}),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Padrão do provedor</SelectItem>
                <SelectItem value="prx-localant">GPT — PRX + LocalAnt</SelectItem>
                <SelectItem value="free-claude">Claudinho — FreeClaude / OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.backend === "prx-localant" && (
            <div className="space-y-2">
              <Label>ID da sessão PRX (target)</Label>
              <Input
                required
                value={form.sessionId}
                onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
              />
              <Label>URL exata da conversa</Label>
              <Input
                required
                value={form.conversationId}
                onChange={(e) => setForm({ ...form, conversationId: e.target.value })}
              />
              <Label>Nome acessível do campo de mensagem</Label>
              <Input
                required
                value={form.composerLabel}
                onChange={(e) => setForm({ ...form, composerLabel: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Usa uma sessão ChatGPT autenticada. Sujeita aos limites do seu plano. LocalAnt
                encaminha pedidos de ferramentas às políticas do AI Office.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="Modelo principal"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    type: v as ProviderType,
                    model: TYPES.find((t) => t.value === v)?.defaultModel ?? "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(meta.needsUrl || form.type === "custom") && (
            <div className="space-y-1.5">
              <Label>URL base</Label>
              <Input
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder={
                  form.type === "ollama"
                    ? "http://localhost:11434/v1"
                    : "https://claudinho.example.com/api"
                }
                required
              />
            </div>
          )}
          {form.type === "custom" && (
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>
                External agent protocol
                <span className="block text-xs text-muted-foreground">
                  POST /commands with the formal command payload; GET /health.
                </span>
              </span>
              <Switch
                checked={form.external_agent}
                onCheckedChange={(v) => setForm({ ...form, external_agent: v })}
              />
            </label>
          )}
          {form.type !== "simulation" && !(form.type === "custom" && form.external_agent) && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Modelo</Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Temperatura</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Máximo de tokens</Label>
                <Input
                  type="number"
                  min="256"
                  value={form.max_tokens}
                  onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Tempo limite (ms)</Label>
            <Input
              type="number"
              min="1000"
              step="1000"
              value={form.timeout_ms}
              onChange={(e) => setForm({ ...form, timeout_ms: Number(e.target.value) })}
            />
          </div>
          {form.type !== "simulation" && form.type !== "lovable_ai" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{form.type === "custom" ? "API key (optional)" : "API key"}</Label>
                <Input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={provider?.has_api_key ? "•••••• (keep current)" : "sk-…"}
                  autoComplete="off"
                />
              </div>
              {form.type === "custom" && (
                <div className="space-y-1.5">
                  <Label>Token de acesso (opcional)</Label>
                  <Input
                    type="password"
                    value={form.bearer_token}
                    onChange={(e) => setForm({ ...form, bearer_token: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Credentials are written to a server-only vault table. The browser never reads them back.
          </p>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar provedor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
