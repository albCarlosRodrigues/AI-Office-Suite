import { useQuery } from "@tanstack/react-query";
import { startupStatus } from "@/orchestration/startup.functions";

export function StartupStatus() {
  const { data } = useQuery({
    queryKey: ["desktop-startup"],
    queryFn: () => startupStatus(),
    refetchInterval: 3000,
  });
  if (!data) return null;
  return (
    <section className="rounded-lg border p-4 space-y-2" aria-label="Inicialização dos serviços">
      <h2>Inicialização dos serviços — {data.system}</h2>
      <p>
        GPT · CDP 9223: {data.gpt ?? "STOPPED"} | Claudinho · 8082: {data.claudinho ?? "STOPPED"} |
        PRX: {data.prx ?? "STOPPED"}
      </p>
      <p className="text-xs text-muted-foreground">
        Última verificação de startup: {new Date(data.timestamp).toLocaleString()}. Disponibilidade
        do serviço não comprova autenticação ou execução de uma missão.
      </p>
      {data.error && (
        <p role="alert">
          Falha: {data.error}. Consulte startup/startup.log na pasta de dados do aplicativo.
        </p>
      )}
    </section>
  );
}
