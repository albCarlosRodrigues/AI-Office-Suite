import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { agentsQuery, costsQuery, missionsQuery, providersQuery } from "@/lib/queries";
import { PageHeader, StatCard, EmptyState, formatMoney } from "@/components/shared/PageHeader";
import { AgentAvatar } from "@/components/shared/AgentAvatar";

export const Route = createFileRoute("/_authenticated/costs")({
  head: () => ({
    meta: [
      { title: "Custos — AI Pixel Office" },
      {
        name: "description",
        content: "Token and dollar spend by mission, agent, provider and model.",
      },
      { property: "og:title", content: "Costs — AI Pixel Office" },
      {
        property: "og:description",
        content: "Token and dollar spend by mission, agent, provider and model.",
      },
    ],
  }),
  component: CostsPage,
});

function CostsPage() {
  const { org, settings } = useOrg();
  const costs = useQuery(costsQuery(org!.id));
  const agents = useQuery(agentsQuery(org!.id));
  const missions = useQuery(missionsQuery(org!.id));
  const providers = useQuery(providersQuery(org!.id));
  const rows = costs.data ?? [];
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + Number(r.estimated_cost), 0);
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const total = sum(rows);
  const daily = sum(rows.filter((r) => r.created_at.startsWith(today)));
  const monthly = sum(rows.filter((r) => r.created_at.startsWith(month)));
  const simulated = sum(rows.filter((r) => r.is_simulated));
  const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, { cost: number; tin: number; tout: number; n: number }>();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) ?? { cost: 0, tin: 0, tout: 0, n: 0 };
      g.cost += Number(r.estimated_cost);
      g.tin += Number(r.input_tokens);
      g.tout += Number(r.output_tokens);
      g.n += 1;
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  };
  const byAgent = group((r) => r.agent_id ?? "—");
  const byMission = group((r) => r.mission_id ?? "—");
  const byModel = group((r) => `${r.provider_type ?? "?"}/${r.model ?? "?"}`);
  const max = Math.max(1, ...byAgent.map(([, g]) => g.cost));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Governar"
        title="Custos"
        description="Cada chamada de provedor registra tokens e custo estimado. Execuções simuladas são identificadas separadamente."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Hoje"
          value={formatMoney(daily)}
          hint={
            settings?.daily_cost_limit
              ? `limite ${formatMoney(settings.daily_cost_limit)}`
              : "sem limite diário"
          }
          tone={
            settings?.daily_cost_limit && daily > Number(settings.daily_cost_limit) * 0.8
              ? "warning"
              : "primary"
          }
        />
        <StatCard
          label="Este mês"
          value={formatMoney(monthly)}
          hint={
            settings?.monthly_cost_limit
              ? `limite ${formatMoney(settings.monthly_cost_limit)}`
              : "sem limite mensal"
          }
        />
        <StatCard
          label="Total acumulado"
          value={formatMoney(total)}
          hint={`${rows.length} registros`}
        />
        <StatCard
          label="Simulado"
          value={formatMoney(simulated)}
          hint="não cobrado por provedores"
          tone="info"
        />
      </div>
      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nenhum custo ainda"
            description="Execute uma missão para visualizar os detalhes de custo."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <section className="panel p-4">
            <p className="eyebrow mb-3">Por agente</p>
            <ul className="space-y-2">
              {byAgent.map(([id, g]) => {
                const a = agents.data?.find((x) => x.id === id);
                return (
                  <li key={id}>
                    <div className="flex items-center gap-2 text-sm">
                      {a && <AgentAvatar agent={a} size={12} />}
                      <span className="flex-1 truncate">{a?.name ?? "—"}</span>
                      <span className="font-mono text-xs">{formatMoney(g.cost)}</span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(g.cost / max) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="panel p-4">
            <p className="eyebrow mb-3">Por missão</p>
            <ul className="space-y-2 text-sm">
              {byMission.map(([id, g]) => {
                const m = missions.data?.find((x) => x.id === id);
                return (
                  <li key={id} className="flex items-center gap-2">
                    {m ? (
                      <Link
                        to="/missions/$missionId"
                        params={{ missionId: m.id }}
                        className="flex-1 truncate text-primary hover:underline"
                      >
                        {m.title}
                      </Link>
                    ) : (
                      <span className="flex-1 text-muted-foreground">—</span>
                    )}
                    <span className="font-mono text-xs">{formatMoney(g.cost)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="panel p-4">
            <p className="eyebrow mb-3">Por modelo</p>
            <ul className="space-y-2 text-sm">
              {byModel.map(([k, g]) => (
                <li key={k}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-mono text-xs">{k}</span>
                    <span className="font-mono text-xs">{formatMoney(g.cost)}</span>
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {g.n} chamadas · {g.tin} entrada · {g.tout} saída
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-border pt-2 text-[11px] text-muted-foreground">
              {providers.data?.length ?? 0} provedores configurados.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
