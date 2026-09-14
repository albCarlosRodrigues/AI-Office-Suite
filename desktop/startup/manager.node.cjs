const { test } = require("node:test");
const assert = require("node:assert/strict");
const { converge } = require("./manager.cjs");
const { launchIndependent, ownsClaudinho } = require("./windows.cjs");
const path = require("node:path");
const plan = { attempts: 3, gpt: { port: 9223 }, claudinho: { port: 8082 } };
test("ownership handles quoted Windows args and rejects unrelated executable/workspace", () => {
  const root = path.resolve("fixture project");
  const exe = path.join(root, ".venv", "Scripts", "uvicorn.exe");
  const process = { exe, command: `"${exe}" "server:app" "--port" "8082"` };
  assert.equal(ownsClaudinho(process, root, "uv.exe"), true);
  assert.equal(
    ownsClaudinho({ ...process, exe: path.resolve("other/node.exe") }, root, "uv.exe"),
    false,
  );
  assert.equal(ownsClaudinho(process, path.resolve("other-project"), "uv.exe"), false);
});
test("venv redirector requires base interpreter, venv launcher, uvicorn path and exact app directory", () => {
  const root = path.resolve("fixture project");
  const base = path.resolve("Python/python.exe");
  const command = `"${path.join(root, ".venv/Scripts/python.exe")}" "${path.join(root, ".venv/Scripts/uvicorn.exe")}" server:app --app-dir "${root}" --port 8082`;
  assert.equal(ownsClaudinho({ exe: base, command }, root, "uv.exe", base), true);
  assert.equal(
    ownsClaudinho({ exe: base, command }, root, "uv.exe", path.resolve("Other/python.exe")),
    false,
  );
  assert.equal(
    ownsClaudinho(
      { exe: base, command: command.replace("--app-dir", "--other") },
      root,
      "uv.exe",
      base,
    ),
    false,
  );
});
function fixture(initial = {}) {
  const live = { ...initial },
    calls = [],
    records = [];
  const io = {
    ownsHandoff: async () => true,
    healthy: async (name) => Boolean(live[name]),
    conflicts: async () => [],
    start: async (name) => {
      calls.push(["start", name]);
      live[name] = true;
      return 12;
    },
    stop: async (p) => {
      calls.push(["stop", p.pid]);
    },
    record: async (s) => {
      records.push(s);
    },
    safeError: (e) => e.message,
    delay: async () => {},
  };
  return { io, calls, records };
}
test("TEST-1 healthy GPT is reused without restart", async () => {
  const f = fixture({ gpt: true, claudinho: true });
  assert.equal((await converge(plan, f.io)).system, "READY");
  assert.deepEqual(f.calls, []);
});
test("TEST-2 handoff precedes controlled GPT replacement and health validation", async () => {
  const f = fixture({ claudinho: true });
  f.io.conflicts = async (name) => (name === "gpt" ? [{ pid: 5, owned: true }] : []);
  await converge(plan, f.io);
  assert.deepEqual(f.calls, [
    ["stop", 5],
    ["start", "gpt"],
  ]);
  assert.equal(f.records.at(-1).system, "READY");
});
test("TEST-3 stopped Claudinho starts and is probed", async () => {
  const f = fixture({ gpt: true });
  await converge(plan, f.io);
  assert.deepEqual(f.calls, [["start", "claudinho"]]);
});
test("TEST-4 healthy Claudinho is never duplicated", async () => {
  const f = fixture({ claudinho: true });
  await converge(plan, f.io);
  assert.deepEqual(f.calls, [["start", "gpt"]]);
});
test("TEST-5 only identified Claudinho conflict is stopped", async () => {
  const f = fixture({ gpt: true });
  f.io.conflicts = async () => [{ pid: 77, owned: true }];
  await converge(plan, f.io);
  assert.deepEqual(f.calls, [
    ["stop", 77],
    ["start", "claudinho"],
  ]);
});
test("TEST-6 unrelated node owner fails closed", async () => {
  const f = fixture({ gpt: true });
  f.io.conflicts = async () => [{ pid: 99, owned: false }];
  assert.equal((await converge(plan, f.io)).system, "FAILED");
  assert.deepEqual(f.calls, []);
});
test("TEST-7 repeated startup converges without duplication", async () => {
  const f = fixture();
  await converge(plan, f.io);
  await converge(plan, f.io);
  assert.deepEqual(f.calls, [
    ["start", "claudinho"],
    ["start", "gpt"],
  ]);
});
for (const [number, name] of [
  [8, "gpt"],
  [9, "claudinho"],
]) {
  test(`TEST-${number} ${name} unavailable gives bounded timeout and FAILED log`, async () => {
    const f = fixture();
    let probes = 0;
    f.io.healthy = async (component) => {
      if (component !== name) return true;
      probes++;
      return false;
    };
    assert.equal((await converge(plan, f.io))[name], "FAILED");
    assert.equal(probes, 4);
    assert.ok(f.records.some((r) => r.error === "HEALTH_TIMEOUT"));
  });
}
test("TEST-10 no destructive operation before independent ownership commit", async () => {
  const f = fixture();
  f.io.ownsHandoff = async () => false;
  await assert.rejects(converge(plan, f.io), /HANDOFF_NOT_COMMITTED/);
  assert.deepEqual(f.calls, []);
});
test("TEST-11 detached Windows launch uses hidden CIM process, not parent pipes", async () => {
  let request;
  const pid = await launchIndependent(
    "C:\\App\\Office.exe",
    ["--runtime-bootstrapper", "C:\\Data\\plan.json"],
    "C:\\App",
    async (script, config) => {
      request = { script, config };
      return 22;
    },
  );
  assert.equal(pid, 22);
  assert.match(request.script, /ShowWindow=\[uint16\]0/);
  assert.match(request.script, /Win32_Process -MethodName Create/);
  assert.ok(!request.config.command.includes("powershell"));
});
test("independent launch rejects malformed PID and argument injection", async () => {
  await assert.rejects(
    launchIndependent("a", ['bad"argument'], "c", async () => 5),
    /INVALID_LAUNCH_ARGUMENT/,
  );
  await assert.rejects(
    launchIndependent("a", [], "c", async () => 0),
    /CREATE_FAILED/,
  );
});
