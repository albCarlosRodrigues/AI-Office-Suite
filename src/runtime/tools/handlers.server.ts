import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { guardCommand, guardPath } from "../security/guards";
import type { RegisteredTool, ToolHandlerOutput } from "./gateway";
import type { ToolRequest } from "./types";

const MAX_OUTPUT_BYTES = 1_000_000;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".output",
  "release",
  "dist",
  "coverage",
]);

const FileInput = z.object({ path: z.string().min(1) });
const WriteInput = FileInput.extend({ content: z.string() });

const RepositoryWriteInput = z
  .object({
    path: z.string().min(1).optional(),
    content: z.string().optional(),
    patch: z.string().max(2_000_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.patch) return;
    if (!value.path || value.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "repository_write requires patch or path + content",
      });
    }
  });

const ShellInput = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
});

const GithubIssueInput = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  issue: z.number().int().positive(),
});

const CodeAnalysisInput = z.object({
  target: z.string().min(1),
});

function resolveAgainstWorkspace(candidate: string, roots: readonly string[]) {
  if (path.isAbsolute(candidate)) return candidate;
  return path.resolve(roots[0] ?? process.cwd(), candidate);
}

async function canonicalForRead(candidate: string, roots: readonly string[]) {
  const canonical = await realpath(resolveAgainstWorkspace(candidate, roots));
  if (!guardPath(canonical, roots).allowed) throw new Error("PATH_DENIED");
  return canonical;
}

async function canonicalForWrite(candidate: string, roots: readonly string[]) {
  const absolute = resolveAgainstWorkspace(candidate, roots);
  const parent = await realpath(path.dirname(absolute));
  const canonical = path.join(parent, path.basename(absolute));
  if (!guardPath(canonical, roots).allowed) throw new Error("PATH_DENIED");
  return canonical;
}

const hash = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

async function directorySummary(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !IGNORED_DIRECTORY_NAMES.has(entry.name))
    .slice(0, 500)
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));
}
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

async function resolveGithubToken(signal?: AbortSignal): Promise<string | null> {
  const configured = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];

  if (configured?.trim()) {
    return configured.trim();
  }

  return new Promise((resolve) => {
    const child = spawn("gh", ["auth", "token"], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };

    const abort = () => {
      child.kill();
      finish(null);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 5_000);

    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.once("error", () => finish(null));

    child.once("close", (code) => {
      finish(code === 0 && stdout.trim() ? stdout.trim() : null);
    });
  });
}
export function createLocalToolHandlers(allowedRoots: readonly string[]): RegisteredTool[] {
  const workspace = allowedRoots[0] ?? process.cwd();

  const readTool = (id: string): RegisteredTool => ({
    id,
    risk: 1,
    async execute(request) {
      const input = FileInput.parse(request.arguments);
      const target = await canonicalForRead(input.path, allowedRoots);
      const info = await stat(target);

      if (info.isDirectory()) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              path: target,
              type: "directory",
              entries: await directorySummary(target),
            },
            null,
            2,
          ),
        };
      }

      const content = await readFile(target);
      return {
        exitCode: 0,
        stdout: content.subarray(0, MAX_OUTPUT_BYTES),
      };
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
        // new file
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

  const repositoryWrite: RegisteredTool = {
    id: "repository_write",
    risk: 2,
    async execute(request, signal) {
      const input = RepositoryWriteInput.parse(request.arguments);

      if (input.patch) {
        const cwd = await canonicalForRead(workspace, allowedRoots);

        return runProcess(
          ["git", "apply", "--whitespace=error-all", "-"],
          cwd,
          30_000,
          signal,
          input.patch,
        );
      }

      const file = await canonicalForWrite(input.path!, allowedRoots);

      let beforeHash: string | null = null;

      try {
        beforeHash = hash(await readFile(file));
      } catch {
        // new file
      }

      const bytes = Buffer.from(input.content!);
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
  };

  const codeAnalysis: RegisteredTool = {
    id: "code_analysis",
    risk: 1,
    async execute(request) {
      const input = CodeAnalysisInput.parse(request.arguments);
      const target = await canonicalForRead(input.target, allowedRoots);
      const info = await stat(target);

      if (info.isDirectory()) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            {
              target,
              type: "directory",
              entries: await directorySummary(target),
            },
            null,
            2,
          ),
        };
      }

      const content = await readFile(target);
      const text = content.toString("utf8");
      const preview = text.slice(0, 250_000);

      return {
        exitCode: 0,
        stdout: JSON.stringify(
          {
            target,
            type: "file",
            bytes: content.byteLength,
            lines: text.split(/\r?\n/).length,
            imports: (text.match(/\bimport\b/g) ?? []).length,
            exports: (text.match(/\bexport\b/g) ?? []).length,
            todoMarkers: (text.match(/\b(?:TODO|FIXME)\b/g) ?? []).length,
            sha256: hash(content),
            content: preview,
            truncated: preview.length < text.length,
          },
          null,
          2,
        ),
      };
    },
  };

  const githubIssueRead: RegisteredTool = {
    id: "github_issue_read",
    risk: 1,
    async execute(request, signal) {
      const input = GithubIssueInput.parse(request.arguments);
      const [owner, repository] = input.repository.split("/");

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "AI-Office-Suite",
        "X-GitHub-Api-Version": "2022-11-28",
      };

      const token = await resolveGithubToken(signal);

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const apiRoot =
        `https://api.github.com/repos/${encodeURIComponent(owner!)}/` +
        `${encodeURIComponent(repository!)}/issues/${input.issue}`;

      const issueResponse = await fetch(apiRoot, {
        headers,
        signal: signal ?? null,
      });

      if (!issueResponse.ok) {
        const body = (await issueResponse.text()).slice(0, 2_000);
        return {
          exitCode: 1,
          stderr:
            `GitHub issue request failed (${issueResponse.status}): ${body}` +
            (issueResponse.status === 404
              ? " The repository/issue may be private or unavailable to the current GitHub authentication."
              : ""),
        };
      }

      const issue = (await issueResponse.json()) as {
        number?: number;
        title?: string;
        body?: string | null;
        state?: string;
        html_url?: string;
        user?: { login?: string };
        labels?: Array<{ name?: string }>;
        assignees?: Array<{ login?: string }>;
        created_at?: string;
        updated_at?: string;
      };

      const commentsResponse = await fetch(`${apiRoot}/comments?per_page=100`, {
        headers,
        signal: signal ?? null,
      });

      if (!commentsResponse.ok) {
        return {
          exitCode: 1,
          stderr: `GitHub comments request failed (${commentsResponse.status})`,
        };
      }

      const comments = (await commentsResponse.json()) as Array<{
        id?: number;
        body?: string | null;
        html_url?: string;
        created_at?: string;
        updated_at?: string;
        user?: { login?: string };
      }>;

      const output = JSON.stringify(
        {
          repository: input.repository,
          issue: {
            number: issue.number,
            title: issue.title,
            state: issue.state,
            url: issue.html_url,
            author: issue.user?.login ?? null,
            labels: issue.labels?.map((label) => label.name) ?? [],
            assignees: issue.assignees?.map((assignee) => assignee.login) ?? [],
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            body: issue.body ?? "",
          },
          comments: comments.map((comment) => ({
            id: comment.id,
            author: comment.user?.login ?? null,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            url: comment.html_url,
            body: comment.body ?? "",
          })),
        },
        null,
        2,
      );

      return {
        exitCode: 0,
        stdout: output.slice(0, MAX_OUTPUT_BYTES),
      };
    },
  };

  const processTool = (
    id: string,
    risk: 1 | 2,
    argvFor: (request: ToolRequest) => string[],
  ): RegisteredTool => ({
    id,
    risk,
    async execute(request, signal) {
      const input = ShellInput.parse({
        ...request.arguments,
        argv: argvFor(request),
      });

      const cwd = await canonicalForRead(input.cwd ?? workspace, allowedRoots);

      return runProcess(input.argv, cwd, input.timeoutMs, signal);
    },
  });

  const packageCommand = (script: string) => (request: ToolRequest) => {
    const providedArgs = (request.arguments["args"] as string[] | undefined) ?? [];

    const args = ["run", script, "--", ...providedArgs];

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
          cwd: z.string().optional(),
          patch: z.string().max(2_000_000),
          timeoutMs: z.number().default(30_000),
        })
        .parse(request.arguments);

      const cwd = await canonicalForRead(input.cwd ?? workspace, allowedRoots);

      return runProcess(
        ["git", "apply", "--whitespace=error-all", "-"],
        cwd,
        input.timeoutMs,
        signal,
        input.patch,
      );
    },
  };

  const repositoryRead: RegisteredTool = {
    id: "repository_read",
    risk: 1,
    async execute(request) {
      const input = FileInput.parse(request.arguments);

      const root = allowedRoots[0] ?? process.cwd();

      const candidate = path.isAbsolute(input.path) ? input.path : path.resolve(root, input.path);

      let file: string;

      try {
        file = await canonicalForRead(candidate, allowedRoots);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              path: input.path,
              exists: false,
            }),
          };
        }

        throw error;
      }

      const content = await readFile(file);

      return {
        exitCode: 0,
        stdout: content,
      };
    },
  };
  return [
    readTool("filesystem_read"),
    repositoryRead,
    writeTool("filesystem_write"),
    repositoryWrite,
    codeAnalysis,
    githubIssueRead,
    processTool("shell", 2, (request) =>
      z.array(z.string()).min(1).parse(request.arguments["argv"]),
    ),
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
