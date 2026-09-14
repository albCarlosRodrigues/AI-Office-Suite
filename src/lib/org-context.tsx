import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Organization, OrganizationSettings } from "@/types/domain";

const STORAGE_KEY = "aipo.activeOrg";

interface OrgState {
  organizations: Organization[];
  org: Organization | null;
  settings: OrganizationSettings | null;
  loading: boolean;
  setActiveOrg: (id: string) => void;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgState>({
  organizations: [],
  org: null,
  settings: null,
  loading: true,
  setActiveOrg: () => {},
  refresh: async () => {},
});

export function OrgProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setActiveId(window.localStorage.getItem(STORAGE_KEY));
  }, []);

  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const org = useMemo(() => {
    if (!organizations.length) return null;
    return organizations.find((o) => o.id === activeId) ?? organizations[0]!;
  }, [organizations, activeId]);

  const settingsQuery = useQuery({
    queryKey: ["org-settings", org?.id],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_settings")
        .select("*")
        .eq("organization_id", org!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const value: OrgState = {
    organizations,
    org,
    settings: settingsQuery.data ?? null,
    loading: orgsQuery.isLoading,
    setActiveOrg: (id) => {
      window.localStorage.setItem(STORAGE_KEY, id);
      setActiveId(id);
      qc.invalidateQueries();
    },
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  };

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}

/** Throws if no org is active; use inside org-scoped pages only. */
export function useOrgId(): string {
  const { org } = useOrg();
  if (!org) throw new Error("No active organization");
  return org.id;
}
