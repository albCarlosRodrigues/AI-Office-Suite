export interface DagTask {
  code: string;
  dependsOn: readonly string[];
}

export type DagValidation = { valid: true; order: string[] } | { valid: false; errors: string[] };

export function validateTaskDag(tasks: readonly DagTask[]): DagValidation {
  const errors: string[] = [];
  const codes = new Set<string>();
  for (const task of tasks) {
    if (codes.has(task.code)) errors.push(`DUPLICATE_TASK_CODE:${task.code}`);
    codes.add(task.code);
  }
  for (const task of tasks) {
    if (task.dependsOn.includes(task.code)) errors.push(`SELF_DEPENDENCY:${task.code}`);
    for (const dep of task.dependsOn)
      if (!codes.has(dep)) errors.push(`UNKNOWN_DEPENDENCY:${task.code}:${dep}`);
  }
  if (tasks.length && !tasks.some((task) => task.dependsOn.length === 0))
    errors.push("NO_ROOT_TASK");
  if (errors.length) return { valid: false, errors };

  const indegree = new Map(tasks.map((task) => [task.code, task.dependsOn.length]));
  const children = new Map<string, string[]>();
  for (const task of tasks)
    for (const dep of task.dependsOn) children.set(dep, [...(children.get(dep) ?? []), task.code]);
  const ready = tasks.filter((task) => !task.dependsOn.length).map((task) => task.code);
  const order: string[] = [];
  while (ready.length) {
    const code = ready.shift()!;
    order.push(code);
    for (const child of children.get(code) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  if (order.length !== tasks.length) return { valid: false, errors: ["CYCLIC_DAG"] };
  return { valid: true, order };
}

export function detectDeadlock(
  tasks: readonly { code: string; status: string; dependsOn: readonly string[] }[],
): { deadlocked: false } | { deadlocked: true; reasons: string[] } {
  const remaining = tasks.filter(
    (task) => !["completed", "failed", "cancelled"].includes(task.status),
  );
  if (!remaining.length) return { deadlocked: false };
  const byCode = new Map(tasks.map((task) => [task.code, task]));
  const progressable = remaining.some(
    (task) =>
      task.status === "running" ||
      (task.status === "queued" &&
        task.dependsOn.every((dep) => byCode.get(dep)?.status === "completed")),
  );
  if (progressable) return { deadlocked: false };
  const reasons = remaining.map((task) => {
    const missing = task.dependsOn.find((dep) => !byCode.has(dep));
    if (missing) return `${task.code}:missing_dependency:${missing}`;
    const failed = task.dependsOn.find((dep) => byCode.get(dep)?.status === "failed");
    return failed ? `${task.code}:failed_parent:${failed}` : `${task.code}:blocked_dependency`;
  });
  return { deadlocked: true, reasons };
}
