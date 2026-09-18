const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 4173;
let localServer;
let serverRestartTimer = null;
let serverRestartCount = 0;
let serverRestartWindowStartedAt = Date.now();
let shuttingDown = false;

function waitForServer(attempts = 400) {
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

function scheduleLocalServerRestart(reason) {
  if (shuttingDown || serverRestartTimer) return;

  const now = Date.now();

  if (now - serverRestartWindowStartedAt > 60_000) {
    serverRestartWindowStartedAt = now;
    serverRestartCount = 0;
  }

  if (serverRestartCount >= 5) {
    console.error("[desktop] local server restart limit reached:", reason);

    dialog.showErrorBox(
      "Servidor local indisponível",
      "O servidor interno do AI Pixel Office caiu repetidamente. Consulte o terminal/log antes de continuar a missão.",
    );

    return;
  }

  serverRestartCount += 1;

  console.error(
    `[desktop] local server stopped (${reason}). Restart ${serverRestartCount}/5 in 1s.`,
  );

  serverRestartTimer = setTimeout(async () => {
    serverRestartTimer = null;

    if (shuttingDown) return;

    startLocalServer();

    try {
      await waitForServer(100);

      console.log("[desktop] local server recovered on http://127.0.0.1:4173");
    } catch (error) {
      console.error("[desktop] local server restart failed:", error);

      const child = localServer;
      localServer = undefined;

      if (child && !child.killed) {
        child.kill();
      }

      scheduleLocalServerRestart("health check failed after restart");
    }
  }, 1_000);
}

function startLocalServer() {
  if (localServer && !localServer.killed) {
    return localServer;
  }

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

  const child = spawn(process.execPath, args, {
    cwd: app.isPackaged ? path.join(process.resourcesPath, "app-server") : app.getAppPath(),

    env: environment,

    // Never allow the internal server to depend on
    // the lifetime of stdin/PowerShell.
    stdio: app.isPackaged ? ["ignore", "ignore", "ignore"] : ["ignore", "inherit", "inherit"],

    windowsHide: true,
  });

  localServer = child;

  child.once("error", (error) => {
    if (localServer === child) {
      localServer = undefined;
    }

    if (!shuttingDown) {
      scheduleLocalServerRestart(`spawn error: ${error.message}`);
    }
  });

  child.once("exit", (code, signal) => {
    if (localServer === child) {
      localServer = undefined;
    }

    if (!shuttingDown) {
      scheduleLocalServerRestart(`exit code=${String(code)} signal=${String(signal)}`);
    }
  });

  return child;
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
  app.on("before-quit", () => {
    shuttingDown = true;

    if (serverRestartTimer) {
      clearTimeout(serverRestartTimer);
      serverRestartTimer = null;
    }

    localServer?.kill();
  });
}
