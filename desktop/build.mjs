import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  readFile,
  stat,
  cp,
  writeFile,
  readdir,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const temporaryOutput = await mkdtemp(path.join(os.tmpdir(), "ai-pixel-office-build-"));
const installerName = `${packageJson.productName} Setup ${packageJson.version}.exe`;
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const release = path.join(root, "release");
const versionOutput = path.join(release, packageJson.version);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(file)));
    else result.push(file);
  }
  return result;
}

try {
  for (const target of [versionOutput, path.join(release, installerName)]) {
    try {
      await stat(target);
      throw new Error(`Artefato existente preservado: ${target}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const cli = path.join(root, "node_modules", "electron-builder", "cli.js");
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "--win", "nsis", `--config.directories.output=${temporaryOutput}`],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`O empacotador terminou com código ${exitCode}.`);
  const installer = path.join(temporaryOutput, installerName);
  const bytes = await readFile(installer);
  const peOffset = bytes.length > 64 ? bytes.readUInt32LE(60) : 0;
  if (
    bytes.length < 1024 ||
    bytes.toString("ascii", 0, 2) !== "MZ" ||
    bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
  )
    throw new Error("INVALID_INSTALLER_PE");
  const resources = path.join(temporaryOutput, "win-unpacked", "resources");
  const archive = path.join(resources, "app.asar");
  const packed = JSON.parse(asar.extractFile(archive, "package.json").toString());
  if (packed.version !== packageJson.version) throw new Error("PACKAGED_VERSION_MISMATCH");
  const names = asar.listPackage(archive).map((name) => name.replaceAll("\\", "/"));
  for (const file of [
    "desktop/main.cjs",
    "desktop/startup/bootstrapper.cjs",
    "desktop/startup/launch.cjs",
    "desktop/startup/windows.cjs",
    "desktop/startup/manager.cjs",
  ]) {
    if (!names.includes(`/${file}`)) throw new Error(`MISSING_PACKAGED_FILE: ${file}`);
  }
  const serverFiles = await files(path.join(resources, "app-server"));
  await stat(path.join(resources, "app-server", "server", "index.mjs"));
  const assetCount = serverFiles.filter((file) => /\.(png|webp|jpg)$/i.test(file)).length;
  if (!assetCount) throw new Error("MISSING_OFFICE_ASSETS");
  const forbidden = (file) =>
    /(^|[\\/])(?:\.env(?:\.(?!example$|template$)[^\\/]+)?|ai-office\.json|ai-office-secrets[^\\/]*)$/i.test(
      file,
    );
  if (names.some(forbidden) || serverFiles.some(forbidden))
    throw new Error("PRIVATE_FILE_IN_PACKAGE");
  const secretPattern =
    /\b(?:sk-or-v1-[a-f0-9]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|ghp_[A-Za-z0-9]{30,})\b/;
  for (const file of serverFiles.filter((file) => /\.(?:js|mjs|cjs|json|html|txt)$/i.test(file))) {
    if (secretPattern.test(await readFile(file, "utf8")))
      throw new Error("CREDENTIAL_PATTERN_IN_PACKAGE");
  }
  const manifest = {
    version: packageJson.version,
    installer: installerName,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    officeAssetCount: assetCount,
    checks: {
      peHeader: true,
      packagedVersion: true,
      startupHelpers: true,
      privateFilesAbsent: true,
      credentialPatternScan: true,
    },
    installationExecuted: false,
    liveChatGptRestartTested: false,
  };
  await writeFile(path.join(temporaryOutput, "validation.json"), JSON.stringify(manifest, null, 2));
  await mkdir(release, { recursive: true });
  await cp(temporaryOutput, versionOutput, { recursive: true, force: false, errorOnExist: true });
  await copyFile(installer, path.join(release, installerName), constants.COPYFILE_EXCL);
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`\nInstalador criado em: ${path.join(release, installerName)}`);
} finally {
  await rm(temporaryOutput, { recursive: true, force: true });
}
