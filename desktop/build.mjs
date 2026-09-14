import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const temporaryOutput = await mkdtemp(path.join(os.tmpdir(), "ai-pixel-office-build-"));
const installerName = `${packageJson.productName} Setup ${packageJson.version}.exe`;

try {
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
  const release = path.join(root, "release");
  await mkdir(release, { recursive: true });
  await copyFile(path.join(temporaryOutput, installerName), path.join(release, installerName));
  console.log(`\nInstalador criado em: ${path.join(release, installerName)}`);
} finally {
  await rm(temporaryOutput, { recursive: true, force: true });
}
