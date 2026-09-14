import path from "node:path";

export interface GuardDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

const destructiveExecutables = new Set(["sudo", "diskpart", "format", "shutdown", "reboot", "dd"]);

function tokenize(command: string): string[] {
  return (
    command
      .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      ?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? []
  );
}

export function guardCommand(command: string): GuardDecision {
  const tokens = tokenize(command);
  const executable = (tokens[0] ?? "").toLowerCase();
  if (destructiveExecutables.has(executable))
    return { allowed: false, requiresApproval: false, reason: `BLOCKED_EXECUTABLE:${executable}` };
  const normalized = tokens.map((t) => t.toLowerCase());
  if (
    (executable === "rm" && normalized.includes("-rf")) ||
    (executable === "git" && normalized[1] === "reset" && normalized.includes("--hard")) ||
    (executable === "git" &&
      normalized[1] === "clean" &&
      normalized.some((t) => /^-[a-z]*f/i.test(t))) ||
    (executable === "git" && normalized.includes("--force"))
  )
    return { allowed: false, requiresApproval: false, reason: "BLOCKED_DESTRUCTIVE_COMMAND" };
  return { allowed: true, requiresApproval: true };
}

export function guardPath(candidate: string, allowedRoots: readonly string[]): GuardDecision {
  const resolved = path.resolve(candidate);
  const inside = allowedRoots.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return inside
    ? { allowed: true, requiresApproval: false }
    : { allowed: false, requiresApproval: false, reason: "PATH_OUTSIDE_ALLOWED_ROOTS" };
}
