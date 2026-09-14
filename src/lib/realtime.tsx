import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Keeps the UI synchronized with the single local file-backed process. */
export function useOrgRealtime(orgId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["agents", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["missions", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["tasks", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["approvals", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["events", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["mission"] });
    };
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [orgId, queryClient]);
}
