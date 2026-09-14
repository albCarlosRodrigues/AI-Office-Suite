import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import pkg from "../package.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const release = path.join(root, "release", pkg.version);
const manifest = JSON.parse(await readFile(path.join(release, "validation.json"), "utf8"));
const installer = await readFile(path.join(release, manifest.installer));
if (createHash("sha256").update(installer).digest("hex").toUpperCase() !== manifest.sha256)
  throw new Error("INSTALLER_HASH_MISMATCH");
const temp = await mkdtemp(path.join(os.tmpdir(), "office-release-smoke-"));
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const unpacked = path.join(release, "win-unpacked");
const serverRoot = path.join(unpacked, "resources", "app-server");
// Run only the bundled server through Electron's Node runtime. main.cjs and bootstrapper never run.
const child = spawn(
  path.join(unpacked, `${pkg.productName}.exe`),
  [path.join(serverRoot, "server", "index.mjs")],
  {
    cwd: serverRoot,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_PORT: String(port),
      AI_OFFICE_DATA_FILE: path.join(temp, "ai-office.json"),
    },
  },
);
const exit = once(child, "exit");
try {
  let response;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) throw new Error("BUNDLED_SERVER_EXITED");
    try {
      response = await fetch(`http://127.0.0.1:${port}/office`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
    } catch {
      /* bounded startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response?.ok) throw new Error("OFFICE_ROUTE_FAILED");
  const html = await response.text();
  if (!html.includes("<html")) throw new Error("INVALID_OFFICE_HTML");
  const assets = await readdir(path.join(serverRoot, "public", "assets"));
  const js = assets.find((file) => file.endsWith(".js"));
  if (!js || !(await fetch(`http://127.0.0.1:${port}/assets/${js}`)).ok)
    throw new Error("ASSET_HTTP_FAILED");
  console.log(
    JSON.stringify({
      packagedElectronRuntime: "PASS",
      officeRouteHttp: response.status,
      assetHttp: "PASS",
      installerHash: "PASS",
      isolatedUserData: true,
      bootstrapperExecuted: false,
      installerExecuted: false,
    }),
  );
} finally {
  child.kill();
  await exit;
  await rm(temp, { recursive: true, force: true });
}
