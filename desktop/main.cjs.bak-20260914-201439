const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 4173;
let localServer;

function waitForServer(attempts = 100) {
  return new Promise((resolve, reject) => {
    const probe = (remaining) => {
      const request = http.get(`http://${HOST}:${PORT}/`, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (remaining <= 0) return reject(new Error("O servidor local não iniciou."));
        setTimeout(() => probe(remaining - 1), 150);
      });
      request.setTimeout(500, () => request.destroy());
    };
    probe(attempts);
  });
}

function startLocalServer() {
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    HOST,
    PORT: String(PORT),
    NITRO_HOST: HOST,
    NITRO_PORT: String(PORT),
    AI_OFFICE_DATA_FILE: path.join(app.getPath("userData"), "ai-office.json"),
  };
  const entry = app.isPackaged
    ? path.join(process.resourcesPath, "app-server", "server", "index.mjs")
    : path.join(app.getAppPath(), "node_modules", "vite", "bin", "vite.js");
  const args = app.isPackaged
    ? [entry]
    : [entry, "--host", HOST, "--port", String(PORT), "--strictPort"];
  localServer = spawn(process.execPath, args, {
    cwd: app.isPackaged ? path.join(process.resourcesPath, "app-server") : app.getAppPath(),
    env: environment,
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true,
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0b1017",
    title: "AI Pixel Office",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void window.loadURL(`http://${HOST}:${PORT}/`);
}

const bootstrapIndex = process.argv.indexOf("--runtime-bootstrapper");
if (bootstrapIndex !== -1) {
  // Separate Electron process: no UI, single-instance lock, IPC or parent pipes.
  app
    .whenReady()
    .then(() => require("./startup/bootstrapper.cjs").run(process.argv[bootstrapIndex + 1]))
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => app.quit());
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => {
    startLocalServer();
    try {
      await waitForServer();
      createWindow();
      if (process.platform === "win32" && !process.argv.includes("--skip-runtime-bootstrap")) {
        // Return only after independent ownership is acknowledged; completion is reported in status.json.
        void require("./startup/launch.cjs")
          .launch(app, dialog)
          .catch((error) => {
            dialog.showErrorBox(
              "Inicialização dos agentes incompleta",
              `${error.message}\nConsulte startup/startup.log na pasta de dados do aplicativo.`,
            );
          });
      }
    } catch (error) {
      console.error(error);
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => localServer?.kill());
}
