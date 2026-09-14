// Explicit diagnostic, never called at module import. Uses the same process adapter as startup.
const win = require("./windows.cjs");
(async () => {
  const project = await win.validateProject(process.argv[2]);
  const uv = await win.discoverUv();
  const basePython = await win.discoverBasePython(project);
  const owners = await win.portOwners(8082);
  const all = await win.processes();
  if (
    owners.some(
      (pid) => !win.ownsClaudinho(all.find((p) => p.pid === pid) ?? {}, project, uv, basePython),
    )
  )
    throw new Error("UNRELATED_PORT_OWNER");
  let pid = owners[0];
  if (!pid)
    pid = await win.launchIndependent(
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
    );
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8082/health", {
        signal: AbortSignal.timeout(1000),
        redirect: "error",
      });
      if (r.ok && (await r.json()).status === "healthy") {
        const current = await win.processes();
        const listening = await win.portOwners(8082);
        if (
          !listening.length ||
          listening.some(
            (id) =>
              !win.ownsClaudinho(current.find((p) => p.pid === id) ?? {}, project, uv, basePython),
          )
        )
          throw new Error("OWNER_MISMATCH");
        console.log(
          JSON.stringify({
            component: "claudinho",
            status: "RUNNING",
            pid,
            port: 8082,
            reused: owners.length > 0,
          }),
        );
        return;
      }
    } catch {
      /* bounded readiness probe */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("HEALTH_TIMEOUT");
})().catch((e) => {
  console.error(/^[A-Z_]+$/.test(e.message) ? e.message : "CLAUDINHO_PROBE_FAILED");
  process.exitCode = 1;
});
