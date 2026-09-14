import { createFileRoute, Outlet } from "@tanstack/react-router";
import { OrgProvider } from "@/lib/org-context";
import { AppShell } from "@/components/layout/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: () => (
    <OrgProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </OrgProvider>
  ),
});
