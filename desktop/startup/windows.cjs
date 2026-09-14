const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { realpath, access, readFile } = require("node:fs/promises");
const path = require("node:path");
const execute = promisify(execFile);
async function ps(script, value = {}) {
  try {
    const { stdout } = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop';" + script],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, AI_OFFICE_STARTUP_INPUT: JSON.stringify(value) },
      },
    );
    return stdout.trim() ? JSON.parse(stdout.trim()) : null;
  } catch {
    throw new Error("WINDOWS_OPERATION_FAILED");
  }
}
const input = "$v=$env:AI_OFFICE_STARTUP_INPUT|ConvertFrom-Json;";
const snapshot = "$all=@(Get-CimInstance Win32_Process);";
async function processes() {
  return (
    (await ps(
      snapshot +
        "ConvertTo-Json -Compress -InputObject @($all|Select-Object @{n='pid';e={$_.ProcessId}},@{n='parent';e={$_.ParentProcessId}},@{n='exe';e={$_.ExecutablePath}},@{n='command';e={$_.CommandLine}},@{n='created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})",
    )) ?? []
  );
}
async function discoverChatGpt() {
  const packages = await ps(
    "ConvertTo-Json -Compress -InputObject @(Get-AppxPackage | Where-Object {$_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' -or $_.PackageFamilyName -eq 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0'} | Select-Object InstallLocation,Version)",
  );
  const candidates = [];
  for (const pkg of packages ?? []) {
    const exe = path.join(pkg.InstallLocation, "app", "ChatGPT.exe");
    try {
      candidates.push(await realpath(exe));
    } catch {
      /* not an executable installation */
    }
  }
  const unique = [...new Set(candidates)];
  const running = await processes();
  const active = unique.filter((exe) => running.some((p) => samePath(p.exe, exe)));
  if (active.length === 1) return active[0];
  if (active.length > 1 || unique.length !== 1)
    throw new Error("CHATGPT_INSTALLATION_AMBIGUOUS_OR_MISSING");
  return unique[0];
}
function samePath(a, b) {
  return Boolean(a && b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase());
}
function ownsClaudinho(p, project, uv, basePython) {
  if (!p.exe || !p.command || !project) return false;
  const args = (p.command.match(/"[^"]*"|[^\s"]+/g) ?? []).map((a) => a.replace(/^"|"$/g, ""));
  const port = args.indexOf("--port");
  const appDir = args.indexOf("--app-dir");
  const executableInProject = path
    .resolve(p.exe)
    .toLowerCase()
    .startsWith((path.join(project, ".venv") + path.sep).toLowerCase());
  const managedUv = samePath(p.exe, uv) && appDir >= 0 && samePath(args[appDir + 1], project);
  // Windows venv redirectors report the base interpreter as ExecutablePath.
  const redirectedPython =
    samePath(p.exe, basePython) &&
    samePath(args[0], path.join(project, ".venv", "Scripts", "python.exe")) &&
    samePath(args[1], path.join(project, ".venv", "Scripts", "uvicorn.exe")) &&
    appDir >= 0 &&
    samePath(args[appDir + 1], project);
  return (
    (executableInProject || managedUv || redirectedPython) &&
    args.includes("server:app") &&
    args.some((arg) => /^(uvicorn|uvicorn\.exe)$/i.test(path.basename(arg))) &&
    ((port >= 0 && args[port + 1] === "8082") || args.includes("--port=8082"))
  );
}
async function discoverBasePython(project) {
  const config = await readFile(path.join(project, ".venv", "pyvenv.cfg"), "utf8");
  const home = /^home\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
  if (!home || !path.isAbsolute(home)) throw new Error("PYTHON_ENVIRONMENT_MISSING");
  return realpath(path.join(home, "python.exe"));
}
async function discoverUv() {
  const exe = await ps(
    "$c=Get-Command uv.exe -ErrorAction SilentlyContinue; if($c){$c.Source|ConvertTo-Json}else{$p=Join-Path $env:USERPROFILE '.local\\bin\\uv.exe';if(Test-Path -LiteralPath $p){$p|ConvertTo-Json}}",
  );
  if (!exe) throw new Error("UV_NOT_INSTALLED");
  return realpath(exe);
}
async function validateProject(root) {
  if (!path.isAbsolute(root)) throw new Error("FREE_CLAUDE_PATH_REQUIRED");
  const resolved = await realpath(root);
  for (const file of [
    "server.py",
    "api/app.py",
    "api/routes.py",
    "pyproject.toml",
    "uv.lock",
    ".env",
  ])
    await access(path.join(resolved, file));
  return resolved;
}
// CIM creates a process outside the caller's console/job ownership. No shell window or pipe dependency.
async function launchIndependent(exe, args, cwd, invoke = ps) {
  const quote = (value) => {
    if (/["\r\n]/.test(value)) throw new Error("INVALID_LAUNCH_ARGUMENT");
    return '"' + value.replace(/\\$/, "\\\\") + '"';
  };
  const command = [exe, ...args].map(quote).join(" ");
  const result = await invoke(
    input +
      "$startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0};$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$v.command;CurrentDirectory=$v.cwd;ProcessStartupInformation=$startup};if($r.ReturnValue -ne 0){throw 'CREATE_FAILED'};[int]$r.ProcessId|ConvertTo-Json",
    { command, cwd },
  );
  if (!Number.isInteger(result) || result <= 0) throw new Error("CREATE_FAILED");
  return result;
}
async function stopExact(identity) {
  // Recheck PID + executable + creation time immediately before EACH stop, avoiding PID reuse.
  await ps(
    input +
      "$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$v.pid);if(!$p){return};if($p.ExecutablePath -ne $v.exe -or $p.CreationDate.ToUniversalTime().ToString('o') -ne $v.created){throw 'IDENTITY_CHANGED'};$g=Get-Process -Id $p.ProcessId -ErrorAction Stop;$null=$g.CloseMainWindow();",
    identity,
  );
  for (let i = 0; i < 10; i++) {
    if (!(await processes()).some((p) => p.pid === identity.pid && p.created === identity.created))
      return;
    await new Promise((r) => setTimeout(r, 300));
  }
  await ps(
    input +
      "$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$v.pid);if(!$p){return};if($p.ExecutablePath -ne $v.exe -or $p.CreationDate.ToUniversalTime().ToString('o') -ne $v.created){throw 'IDENTITY_CHANGED'};Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop;",
    identity,
  );
  for (let i = 0; i < 10; i++) {
    if (!(await processes()).some((p) => p.pid === identity.pid && p.created === identity.created))
      return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("PROCESS_STOP_TIMEOUT");
}
async function portOwners(port) {
  return (
    (await ps(
      input +
        "ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -LocalPort ([int]$v.port) -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)",
      { port },
    )) ?? []
  );
}
module.exports = {
  discoverBasePython,
  ownsClaudinho,
  ps,
  processes,
  discoverChatGpt,
  discoverUv,
  validateProject,
  samePath,
  launchIndependent,
  stopExact,
  portOwners,
};
