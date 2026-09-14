import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { stepMission } from "@/orchestration/mission.functions";
import { missionsQuery } from "@/lib/queries";
import type { MissionStatus } from "@/types/domain";

const ACTIVE: MissionStatus[] = ["PLANNING", "RUNNING", "REVIEWING"];

/**
 * Client-side pacemaker for the persisted, step-driven orchestration engine.
 * Every tick asks the server to advance each active mission by one unit of work.
 * The engine is idempotent and lock-protected, so several open tabs are safe.
 */
export function useMissionRunner(orgId: string | null, enabled: boolean) {
  const qc = useQueryClient();
  const step = useServerFn(stepMission);
  const { data: missions } = useQuery({
    ...missionsQuery(orgId ?? ""),
    enabled: !!orgId,
    refetchInterval: 8000,
  });
  const inFlight = useRef(false);
  const missionsRef = useRef(missions);
  missionsRef.current = missions;

  useEffect(() => {
    if (!orgId || !enabled) return;
    const tick = async () => {
      if (inFlight.current) return;
      const active = (missionsRef.current ?? []).filter(
        (m) => ACTIVE.includes(m.status) && !m.stop_requested,
      );
      const stopping = (missionsRef.current ?? []).filter(
        (m) => m.stop_requested && !["COMPLETED", "FAILED", "STOPPED"].includes(m.status),
      );
      const targets = [...active, ...stopping];
      if (!targets.length) return;
      inFlight.current = true;
      try {
        for (const m of targets) {
          try {
            const res = await step({ data: { missionId: m.id } });
            if (res.acted) {
              qc.invalidateQueries({ queryKey: ["mission", m.id] });
              qc.invalidateQueries({ queryKey: ["missions", orgId] });
            }
          } catch (err) {
            console.warn("mission step failed", m.id, err);
          }
        }
      } finally {
        inFlight.current = false;
      }
    };
    const id = window.setInterval(tick, 2500);
    void tick();
    return () => window.clearInterval(id);
  }, [orgId, enabled, step, qc]);
}
