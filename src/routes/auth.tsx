import { createFileRoute, redirect } from "@tanstack/react-router";

/** Kept as a compatibility redirect for old bookmarks. Local mode has no login. */
export const Route = createFileRoute("/auth")({
  beforeLoad: () => {
    throw redirect({ to: "/office" });
  },
});
