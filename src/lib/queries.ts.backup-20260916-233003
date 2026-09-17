import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Result<T> = { data: T; error: { message: string } | null };

async function fetchAll<T>(q: PromiseLike<Result<T>>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

async function fetchMaybe<T>(q: PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export const agentsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["agents", orgId],
    queryFn: () =>
      fetchAll(supabase.from("agents").select("*").eq("organization_id", orgId).order("name")),
  });

export const departmentsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["departments", orgId],
    queryFn: () =>
      fetchAll(
        supabase.from("departments").select("*").eq("organization_id", orgId).order("sort_order"),
      ),
  });

export const providersQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["providers", orgId],
    queryFn: () =>
      fetchAll(
        supabase.from("agent_providers").select("*").eq("organization_id", orgId).order("name"),
      ),
  });

export const officeMapQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["office-map", orgId],
    queryFn: async () => {
      const map = await fetchMaybe(
        supabase
          .from("office_maps")
          .select("*")
          .eq("organization_id", orgId)
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (!map) return null;
      const [zones, workstations] = await Promise.all([
        fetchAll(supabase.from("office_zones").select("*").eq("office_map_id", map.id)),
        fetchAll(supabase.from("workstations").select("*").eq("office_map_id", map.id)),
      ]);
      const layers = map.layers && typeof map.layers === "object" ? map.layers : {};
      return {
        map: { ...map, layers },
        zones: Array.isArray(zones) ? zones : [],
        workstations: Array.isArray(workstations) ? workstations : [],
      };
    },
  });

export const missionsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["missions", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("missions")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
      ),
  });

export const missionDetailQuery = (missionId: string) =>
  queryOptions({
    queryKey: ["mission", missionId],
    queryFn: async () => {
      const [mission, tasks, events, commands, approvals, meetings, runs] = await Promise.all([
        fetchAll(supabase.from("missions").select("*").eq("id", missionId).single()),
        fetchAll(
          supabase.from("tasks").select("*").eq("mission_id", missionId).order("order_index"),
        ),
        fetchAll(
          supabase
            .from("mission_events")
            .select("*")
            .eq("mission_id", missionId)
            .order("created_at", { ascending: true })
            .limit(500),
        ),
        fetchAll(
          supabase.from("commands").select("*").eq("mission_id", missionId).order("created_at"),
        ),
        fetchAll(
          supabase
            .from("approval_requests")
            .select("*")
            .eq("mission_id", missionId)
            .order("created_at", { ascending: false }),
        ),
        fetchAll(
          supabase.from("meetings").select("*").eq("mission_id", missionId).order("created_at"),
        ),
        fetchAll(
          supabase
            .from("agent_runs")
            .select("*")
            .eq("mission_id", missionId)
            .order("started_at", { ascending: false }),
        ),
      ]);
      return { mission, tasks, events, commands, approvals, meetings, runs };
    },
  });

export const approvalsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["approvals", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("approval_requests")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
  });

export const auditQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["audit", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("audit_logs")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(300),
      ),
  });

export const eventsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["events", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("mission_events")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
  });

export const costsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["costs", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("cost_records")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
  });

export const tasksQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["tasks", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("tasks")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(300),
      ),
  });

export const agentPermissionsQuery = (agentId: string) =>
  queryOptions({
    queryKey: ["agent-permissions", agentId],
    queryFn: () => fetchAll(supabase.from("agent_permissions").select("*").eq("agent_id", agentId)),
  });

export const agentToolsQuery = (agentId: string) =>
  queryOptions({
    queryKey: ["agent-tools", agentId],
    queryFn: () => fetchAll(supabase.from("agent_tools").select("*").eq("agent_id", agentId)),
  });

export const meetingsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["meetings", orgId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("meetings")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(50),
      ),
  });

export const meetingMessagesQuery = (meetingId: string) =>
  queryOptions({
    queryKey: ["meeting-messages", meetingId],
    queryFn: () =>
      fetchAll(
        supabase
          .from("meeting_messages")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("created_at"),
      ),
  });
