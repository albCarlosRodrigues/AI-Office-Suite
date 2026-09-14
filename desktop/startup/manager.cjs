const { setTimeout: delay } = require("node:timers/promises");

// No OS calls here: all destructive operations belong to the independently owned adapter.
async function converge(plan, io) {
  if (!(await io.ownsHandoff())) throw new Error("HANDOFF_NOT_COMMITTED");
  const state = { system: "STARTING", gpt: "STOPPED", claudinho: "STOPPED", prx: "STOPPED" };
  const record = async (component, status, details = {}) => {
    state[component] = status;
    await io.record({ ...state, component, ...details });
  };
  async function component(name, spec) {
    try {
      await record(name, "STARTING", { port: spec.port });
      if (await io.healthy(name, spec)) {
        await record(name, "RUNNING", { reused: true, port: spec.port });
        return;
      }
      // Identification must fail closed on an unrelated owner, even if its health endpoint answers.
      const conflicts = await io.conflicts(name, spec);
      for (const identity of conflicts) {
        if (!identity.owned) throw new Error("UNRELATED_PORT_OWNER");
        await record(name, "STOPPING", { pid: identity.pid, port: spec.port });
        await io.stop(identity);
      }
      await record(name, "STARTING", { port: spec.port });
      const pid = await io.start(name, spec);
      await record(name, "STARTING", { pid, port: spec.port });
      for (let attempt = 0; attempt < plan.attempts; attempt++) {
        if (await io.healthy(name, spec)) {
          await record(name, "RUNNING", { pid, port: spec.port });
          return;
        }
        await (io.delay ?? delay)(Math.min(250 * (attempt + 1), 1500));
      }
      throw new Error("HEALTH_TIMEOUT");
    } catch (error) {
      await record(name, "FAILED", { error: io.safeError(error) });
      throw error;
    }
  }
  // Collect both outcomes so one broken component does not hide the other one's status.
  let failed = false;
  for (const [name, spec] of [
    ["claudinho", plan.claudinho],
    ["gpt", plan.gpt],
  ]) {
    try {
      await component(name, spec);
    } catch {
      failed = true;
    }
  }
  state.prx = state.gpt === "RUNNING" ? "RUNNING" : "FAILED";
  await record("system", failed ? "FAILED" : "READY");
  return state;
}
module.exports = { converge };
