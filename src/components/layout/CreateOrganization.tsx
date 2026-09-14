import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function CreateOrganization({
  firstRun = false,
  onDone,
}: {
  firstRun?: boolean;
  onDone?: () => void;
}) {
  const { setActiveOrg, refresh } = useOrg();
  const [name, setName] = useState(firstRun ? "Pixel Labs" : "");
  const [seed, setSeed] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_organization", {
        p_name: name.trim(),
        p_seed_demo: seed,
      });
      if (error) throw error;
      await refresh();
      setActiveOrg(data as string);
      toast.success(`Organização "${name.trim()}" criada`);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar a organização");
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={create} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="org-name">Nome da organização</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Robotics"
          required
        />
      </div>
      <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
        <span>
          <span className="block text-sm font-medium">Criar empresa de demonstração</span>
          <span className="block text-xs text-muted-foreground">
            Inclui seis agentes em uma hierarquia real, departamentos, escritório mobiliado e
            políticas seguras. Recomendado para começar.
          </span>
        </span>
        <Switch checked={seed} onCheckedChange={setSeed} />
      </label>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Criando…" : "Criar organização"}
      </Button>
    </form>
  );

  if (!firstRun) return form;

  return (
    <div className="grid-dots flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <p className="eyebrow">Bem-vindo, operador</p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Crie sua primeira organização</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cada organização possui seus próprios agentes, escritório, políticas, orçamentos e
          histórico. Você será o proprietário local.
        </p>
        <div className="panel mt-6 p-6">{form}</div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Seus dados ficam armazenados somente neste computador.
        </p>
      </div>
    </div>
  );
}
