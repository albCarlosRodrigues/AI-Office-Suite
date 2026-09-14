const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test(
  "real Electron bootstrap acknowledges ownership but never restarts without commit",
  {
    skip: process.platform !== "win32" || process.env.AI_OFFICE_TEST_WINDOWS_BOOTSTRAP !== "1",
    timeout: 35000,
  },
  async () => {
    const { mkdir, writeFile } = require("node:fs/promises");
    const { randomUUID } = require("node:crypto");
    const { launchIndependent } = require("./windows.cjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "office-electron-handoff-"));
    const nonce = randomUUID();
    const runDir = path.join(root, nonce);
    await mkdir(runDir);
    const planFile = path.join(runDir, "plan.json");
    await writeFile(
      planFile,
      JSON.stringify({
        version: 1,
        nonce,
        attempts: 1,
        gpt: { port: 9223 },
        claudinho: { port: 8082, project: "unused-before-commit" },
      }),
    );
    const repo = path.resolve(__dirname, "../..");
    const pid = await launchIndependent(
      path.join(repo, "node_modules/electron/dist/electron.exe"),
      [repo, "--runtime-bootstrapper", planFile],
      repo,
    );
    let status;
    for (let i = 0; i < 250; i++) {
      try {
        status = JSON.parse(await readFile(path.join(root, "status.json"), "utf8"));
      } catch {
        /* bounded startup */
      }
      if (status?.system === "FAILED") break;
      await sleep(100);
    }
    const ready = JSON.parse(await readFile(path.join(runDir, "ready.json"), "utf8"));
    assert.equal(ready.pid, pid);
    assert.equal(ready.nonce, nonce);
    assert.equal(status?.error, "HANDOFF_TIMEOUT");
    const log = await readFile(path.join(root, "startup.log"), "utf8");
    assert.ok(!log.includes("STOPPING"));
    await sleep(300);
    await rm(root, { recursive: true, force: true });
  },
);
test(
  "Windows real handoff: CIM child survives termination of disposable parent",
  {
    skip: process.platform !== "win32" || process.env.AI_OFFICE_TEST_WINDOWS_BOOTSTRAP !== "1",
    timeout: 25000,
  },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "office-handoff-test-"));
    const done = path.join(temp, "done");
    const ready = path.join(temp, "ready");
    const parent = spawn(
      process.execPath,
      [path.join(__dirname, "fixtures", "parent.cjs"), done, ready],
      { windowsHide: true, stdio: "ignore" },
    );
    try {
      let pid;
      for (let i = 0; i < 150; i++) {
        try {
          pid = Number(await readFile(ready, "utf8"));
          break;
        } catch {
          await sleep(100);
        }
      }
      assert.ok(pid > 0, "Independent process must acknowledge before parent termination");
      const exited = new Promise((resolve) => parent.once("exit", resolve));
      parent.kill(); // Only this test-created parent, never an application or name-based kill.
      await exited;
      let childResult;
      for (let i = 0; i < 60; i++) {
        try {
          childResult = await readFile(done, "utf8");
          break;
        } catch {
          await sleep(100);
        }
      }
      assert.equal(Number(childResult), pid);
    } finally {
      if (parent.exitCode === null) parent.kill();
      // Child has a bounded 1.8-second lifetime even if an assertion fails.
      await sleep(2000);
      await rm(temp, { recursive: true, force: true });
    }
  },
);
