const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { launchIndependent, processes, validateProject } = require("./windows.cjs");
const { atomic } = require("./bootstrapper.cjs");

async function launch(app, dialog) {
  const root = path.join(app.getPath("userData"), "startup");
  await fs.mkdir(root, { recursive: true });
  const configFile = path.join(root, "config.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(configFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!config?.project) {
    const candidates = [
      path.resolve(app.getAppPath(), "..", "..", "free-claude-code"),
      path.resolve(app.getAppPath(), "..", "free-claude-code"),
    ];
    for (const candidate of candidates) {
      try {
        config = { project: await validateProject(candidate) };
        break;
      } catch {
        /* ask once if not found */
      }
    }
    if (!config) {
      const selection = await dialog.showOpenDialog({
        title: "Selecione a pasta do Free-Claude já configurado",
        properties: ["openDirectory"],
      });
      if (selection.canceled) throw new Error("FREE_CLAUDE_PATH_REQUIRED");
      config = { project: await validateProject(selection.filePaths[0]) };
    }
    await atomic(configFile, config);
  }
  const nonce = randomUUID();
  const runDir = path.join(root, nonce);
  await fs.mkdir(runDir);
  const planFile = path.join(runDir, "plan.json");
  await atomic(planFile, {
    version: 1,
    nonce,
    attempts: 20,
    gpt: { port: 9223 },
    claudinho: { port: 8082, project: config.project },
  });
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), "--runtime-bootstrapper", planFile];
  const pid = await launchIndependent(process.execPath, args, app.getAppPath());
  for (let i = 0; i < 100; i++) {
    let ready;
    try {
      ready = JSON.parse(await fs.readFile(path.join(runDir, "ready.json"), "utf8"));
    } catch {
      /* bounded handshake */
    }
    if (ready?.nonce === nonce && ready.pid === pid) {
      if (ready.busy) return; // existing owner is already converging
      if (!(await processes()).some((p) => p.pid === pid)) throw new Error("BOOTSTRAPPER_EXITED");
      await fs.writeFile(path.join(runDir, "commit"), nonce, { flag: "wx" });
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("BOOTSTRAPPER_HANDSHAKE_TIMEOUT");
}
module.exports = { launch };
