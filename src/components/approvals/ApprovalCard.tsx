import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { resolveApproval } from "@/orchestration/mission.functions";
import { PERMISSION_MAP } from "@/permissions/catalog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { timeAgo } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { Agent, ApprovalRequest, ApprovalScope } from "@/types/domain";

export function ApprovalCard({
  approval,
  agent,
  showMission = false,
}: {
  approval: ApprovalRequest;
  agent: Agent | undefined;
  showMission?: boolean;
}) {
  const qc = useQueryClient();
  const resolve = useServerFn(resolveApproval);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<ApprovalScope>("ONCE");
  const [confirmedPersistent, setConfirmedPersistent] = useState(false);
  const [busy, setBusy] = useState<"APPROVED" | "DENIED" | null>(null);
  const pending = approval.status === "PENDING";
  const requested = (approval.requested_action ?? {}) as Record<string, unknown>;

  const decide = async (decision: "APPROVED" | "DENIED") => {
    setBusy(decision);
    try {
      await resolve({
        data: {
          approvalId: approval.id,
          decision,
          note: note.trim() || null,
          scope: decision === "APPROVED" ? scope : "ONCE",
          confirmedPersistent:
            decision === "APPROVED" && scope === "PERSISTENT" ? confirmedPersistent : true,
        },
      });
      toast.success(
        decision === "APPROVED"
          ? "Aprovado — o agente continuará"
          : "Negado — o agente não poderá realizar esta ação",
      );
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["mission"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a decisão");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`panel p-4 ${pending ? "border-status-needs-approval/40 shadow-glow" : ""}`}>
      <div className="flex items-start gap-3">
        {agent ? (
          <AgentAvatar agent={agent} size={24} />
        ) : (
          <span className="h-9 w-6 rounded-sm bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{agent?.name ?? "Agente"}</p>
            <span className="text-xs text-muted-foreground">solicita</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">
              {approval.kind.replace(/_/g, " ")}
            </span>
            <StatusBadge status={approval.risk_level} />
            <StatusBadge status={approval.status} pulse={pending} />
          </div>
          <p className="mt-1 text-sm">{approval.action}</p>
          {approval.reason && (
            <p className="mt-1 text-xs text-muted-foreground">{approval.reason}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {approval.required_permissions.map((p) => (
              <span
                key={p}
                className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {PERMISSION_MAP[p]?.label ?? p}
              </span>
            ))}
            {approval.tool_id && (
              <span className="rounded-sm border border-info/30 px-1.5 py-0.5 font-mono text-[10px] text-info">
                tool:{approval.tool_id}
              </span>
            )}
          </div>
          {Object.keys(requested).length > 0 && (
            <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(requested, null, 2)}
            </pre>
          )}
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            {timeAgo(approval.created_at)}
            {approval.resolved_at && ` · resolvido ${timeAgo(approval.resolved_at)}`}
            {approval.resolution_note && ` · "${approval.resolution_note}"`}
            {approval.always_allow && " · sempre permitido"}
          </p>
          {showMission && approval.mission_id && (
            <Link
              to="/missions/$missionId"
              params={{ missionId: approval.mission_id }}
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              Abrir missão →
            </Link>
          )}
        </div>
      </div>
      {pending && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Observação opcional para a auditoria e para o agente"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">
                Alcance da aprovação
                <select
                  className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  value={scope}
                  onChange={(event) => {
                    setScope(event.target.value as ApprovalScope);
                    setConfirmedPersistent(false);
                  }}
                >
                  <option value="ONCE">Aprovar uma vez</option>
                  <option value="MISSION">Aprovar nesta missão</option>
                  <option value="PERSISTENT">Criar permissão permanente</option>
                </select>
              </label>
              {scope === "PERSISTENT" && (
                <label className="flex max-w-md items-start gap-2 text-xs text-warning">
                  <Checkbox
                    checked={confirmedPersistent}
                    onCheckedChange={(value) => setConfirmedPersistent(value === true)}
                  />
                  <span>
                    Confirmo a permissão permanente para {agent?.name ?? "este agente"}:{" "}
                    {approval.required_permissions.join(", ")} (risco {approval.risk_level}),
                    limitada exatamente a estas capacidades.
                  </span>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => decide("DENIED")}
              >
                {busy === "DENIED" ? "…" : "Negar"}
              </Button>
              <Button
                size="sm"
                disabled={busy !== null || (scope === "PERSISTENT" && !confirmedPersistent)}
                onClick={() => decide("APPROVED")}
              >
                {busy === "APPROVED" ? "…" : "Aprovar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
