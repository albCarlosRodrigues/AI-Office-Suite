const fs = require("node:fs/promises");
const path = require("node:path");
const { converge } = require("./manager.cjs");
const win = require("./windows.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function atomic(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2));
  await fs.rename(temporary, file);
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "error" });
  if (!response.ok) throw new Error("HEALTH_HTTP_FAILED");
  return response.json();
}
async function run(planFile) {
  const plan = JSON.parse(await fs.readFile(planFile, "utf8"));
  if (
    plan.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(plan.nonce) ||
    plan.attempts < 1 ||
    plan.attempts > 30 ||
    plan.gpt.port !== 9223 ||
    plan.claudinho.port !== 8082
  )
    throw new Error("INVALID_STARTUP_PLAN");
  const runDir = path.dirname(planFile);
  const root = path.dirname(runDir);
  const lockFile = path.join(root, "startup.lock");
  const statusFile = path.join(root, "status.json");
  const logFile = path.join(root, "startup.log");
  const identity = (await win.processes()).find((p) => p.pid === process.pid);
  if (!identity) throw new Error("BOOTSTRAPPER_IDENTITY_MISSING");
  let lock;
  try {
    lock = await fs.open(lockFile, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Never reclaim a live or unreadable lock. PID recycling is checked with creation time.
    // Serialize stale-lock recovery; never unlink a lock another recovery just acquired.
    const recoveryFile = path.join(root, "recovery.lock");
    const recovery = await fs.open(recoveryFile, "wx");
    try {
      const previous = JSON.parse(await fs.readFile(lockFile, "utf8"));
      if (
        (await win.processes()).some(
          (p) => p.pid === previous.pid && p.created === previous.created,
        )
      ) {
        await atomic(path.join(runDir, "ready.json"), {
          nonce: plan.nonce,
          pid: process.pid,
          busy: true,
        });
        return;
      }
      await fs.unlink(lockFile);
      lock = await fs.open(lockFile, "wx");
      await lock.writeFile(JSON.stringify({ pid: identity.pid, created: identity.created }));
    } finally {
      await recovery.close();
      await fs.unlink(recoveryFile);
    }
  }
  await lock.truncate(0);
  await lock.write(JSON.stringify({ pid: identity.pid, created: identity.created }), 0, "utf8");
  await lock.close();
  const record = async (state) => {
    const row = { timestamp: new Date().toISOString(), bootstrapPid: process.pid, ...state };
    await atomic(statusFile, row);
    await fs.appendFile(logFile, JSON.stringify(row) + "\n");
  };
  try {
    await record({
      system: "STARTING",
      gpt: "STOPPED",
      claudinho: "STOPPED",
      prx: "STOPPED",
      component: "bootstrapper",
      action: "HANDOFF_READY",
    });
    await atomic(path.join(runDir, "ready.json"), { nonce: plan.nonce, pid: process.pid });
    let committed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        committed = (await fs.readFile(path.join(runDir, "commit"), "utf8")) === plan.nonce;
      } catch {
        /* parent has not acknowledged yet */
      }
      if (committed) break;
      await sleep(100);
    }
    if (!committed) throw new Error("HANDOFF_TIMEOUT");
    // All configuration was persisted BEFORE acknowledging the handoff. No parent access follows.
    const discovered = {};
    try {
      discovered.gpt = await win.discoverChatGpt();
    } catch (e) {
      discovered.gptError = e;
    }
    try {
      discovered.project = await win.validateProject(plan.claudinho.project);
      discovered.uv = await win.discoverUv();
      discovered.basePython = await win.discoverBasePython(discovered.project);
    } catch (e) {
      discovered.claudinhoError = e;
    }
    const gptExe = discovered.gpt;
    const project = discovered.project;
    const uv = discovered.uv;
    const ensure = (name) => {
      if (discovered[name + "Error"]) throw discovered[name + "Error"];
    };
    const owned = (name, p) =>
      name === "gpt"
        ? win.samePath(p.exe, gptExe)
        : win.ownsClaudinho(p, project, uv, discovered.basePython);
    await converge(plan, {
      ownsHandoff: async () => committed,
      safeError: (e) => (/^[A-Z_]+$/.test(e.message) ? e.message : "COMPONENT_START_FAILED"),
      record,
      healthy: async (name, spec) => {
        try {
          ensure(name);
          const owners = await win.portOwners(spec.port);
          const all = await win.processes();
          if (
            !owners.length ||
            owners.some((pid) => !owned(name, all.find((p) => p.pid === pid) ?? {}))
          )
            return false;
          if (name === "gpt") {
            const targets = await json("http://127.0.0.1:9223/json");
            return (
              Array.isArray(targets) &&
              targets.some((t) => t.type === "page" && t.url === "app://-/index.html")
            );
          }
          return (await json("http://127.0.0.1:8082/health")).status === "healthy";
        } catch {
          return false;
        }
      },
      conflicts: async (name, spec) => {
        ensure(name);
        const all = await win.processes();
        const owners = await win.portOwners(spec.port);
        if (owners.some((pid) => !owned(name, all.find((p) => p.pid === pid) ?? {})))
          throw new Error("UNRELATED_PORT_OWNER");
        return all.filter((p) => owned(name, p)).map((p) => ({ ...p, owned: true }));
      },
      stop: win.stopExact,
      start: (name) =>
        name === "gpt"
          ? win.launchChatGptPackage(gptExe, [
              "--remote-debugging-address=127.0.0.1",
              "--remote-debugging-port=9223",
            ])
          : win.launchIndependent(
              uv,
              [
                "run",
                "--frozen",
                "--no-sync",
                "uvicorn",
                "server:app",
                "--app-dir",
                project,
                "--host",
                "127.0.0.1",
                "--port",
                "8082",
                "--timeout-graceful-shutdown",
                "5",
              ],
              project,
            ),
    });
  } catch (error) {
    await record({
      system: "FAILED",
      component: "bootstrapper",
      error: /^[A-Z_]+$/.test(error.message) ? error.message : "STARTUP_FAILED",
    });
  } finally {
    await fs.unlink(lockFile);
  }
}
module.exports = { run, atomic };
