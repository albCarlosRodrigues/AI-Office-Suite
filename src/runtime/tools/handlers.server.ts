import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { guardCommand, guardPath } from "../security/guards";
import type { RegisteredTool, ToolHandlerOutput } from "./gateway";
import type { ToolRequest } from "./types";

const MAX_OUTPUT_BYTES = 1_000_000;
const FileInput = z.object({ path: z.string().min(1) });
const WriteInput = FileInput.extend({ content: z.string() });
const ShellInput = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.string(),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
});

async function canonicalForRead(candidate: string, roots: readonly string[]) {
  const canonical = await realpath(candidate);
  if (!guardPath(canonical, roots).allowed) throw new Error("PATH_DENIED");
  return canonical;
}
async function canonicalForWrite(candidate: string, roots: readonly string[]) {
  const absolute = path.resolve(candidate);
  const parent = await realpath(path.dirname(absolute));
  const canonical = path.join(parent, path.basename(absolute));
  if (!guardPath(canonical, roots).allowed) throw new Error("PATH_DENIED");
  return canonical;
}
const hash = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

export async function runProcess(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  stdin?: string,
): Promise<ToolHandlerOutput> {
  if (!guardCommand(argv.join(" ")).allowed) throw new Error("COMMAND_DENIED");
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    const append = (current: Buffer, chunk: Buffer) =>
      Buffer.concat([current, chunk]).subarray(0, MAX_OUTPUT_BYTES);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.stdin.end(stdin);
    const terminate = () => child.kill();
    signal?.addEventListener("abort", terminate, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", terminate);
      resolve({
        exitCode: timedOut || signal?.aborted ? null : code,
        stdout,
        stderr: timedOut ? Buffer.concat([stderr, Buffer.from("\nPROCESS_TIMEOUT")]) : stderr,
        ...(timedOut
          ? { termination: "timeout" as const }
          : signal?.aborted
            ? { termination: "cancelled" as const }
            : {}),
      });
    });
  });
}

export function createLocalToolHandlers(allowedRoots: readonly string[]): RegisteredTool[] {
  const readTool = (id: string): RegisteredTool => ({
    id,
    risk: 1,
    async execute(request) {
      const input = FileInput.parse(request.arguments);
      const file = await canonicalForRead(input.path, allowedRoots);
      const content = await readFile(file);
      return { exitCode: 0, stdout: content };
    },
  });
  const writeTool = (id: string): RegisteredTool => ({
    id,
    risk: 2,
    async execute(request) {
      const input = WriteInput.parse(request.arguments);
      const file = await canonicalForWrite(input.path, allowedRoots);
      let beforeHash: string | null = null;
      try {
        beforeHash = hash(await readFile(file));
      } catch {
        /* new file */
      }
      const bytes = Buffer.from(input.content);
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, file);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          path: file,
          operation: "write",
          beforeHash,
          afterHash: hash(bytes),
          timestamp: new Date().toISOString(),
        }),
      };
    },
  });
  const processTool = (
    id: string,
    risk: 1 | 2,
    argvFor: (request: ToolRequest) => string[],
  ): RegisteredTool => ({
    id,
    risk,
    async execute(request, signal) {
      const input = ShellInput.parse({ ...request.arguments, argv: argvFor(request) });
      const cwd = await canonicalForRead(input.cwd, allowedRoots);
      return runProcess(input.argv, cwd, input.timeoutMs, signal);
    },
  });
  const packageCommand = (script: string) => (request: ToolRequest) => {
    const args = ["run", script, ...((request.arguments["args"] as string[] | undefined) ?? [])];
    return process.platform === "win32"
      ? [
          process.execPath,
          path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
          ...args,
        ]
      : ["npm", ...args];
  };
  const gitApply: RegisteredTool = {
    id: "git_apply",
    risk: 2,
    async execute(request, signal) {
      const input = z
        .object({
          cwd: z.string(),
          patch: z.string().max(2_000_000),
          timeoutMs: z.number().default(30_000),
        })
        .parse(request.arguments);
      const cwd = await canonicalForRead(input.cwd, allowedRoots);
      return runProcess(
        ["git", "apply", "--whitespace=error-all", "-"],
        cwd,
        input.timeoutMs,
        signal,
        input.patch,
      );
    },
  };
  return [
    readTool("filesystem_read"),
    readTool("repository_read"),
    writeTool("filesystem_write"),
    writeTool("repository_write"),
    processTool("shell", 2, (request) => ShellInput.parse(request.arguments).argv),
    processTool("git_status", 1, () => ["git", "status", "--short", "--branch"]),
    processTool("git_diff", 1, () => ["git", "diff", "--"]),
    processTool("git_diff_check", 1, () => ["git", "diff", "--check"]),
    gitApply,
    processTool("testing", 1, packageCommand("test")),
    processTool("typecheck", 1, packageCommand("typecheck")),
    processTool("lint", 1, packageCommand("lint")),
    processTool("build", 1, packageCommand("build")),
  ];
}
