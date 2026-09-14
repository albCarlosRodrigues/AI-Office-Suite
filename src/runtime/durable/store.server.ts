import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { emptyDurableRuntimeState, type DurableRuntimeState } from "./types";

const TABLES = Object.keys(emptyDurableRuntimeState()).filter(
  (key) => !["version", "killSwitch"].includes(key),
) as Array<keyof DurableRuntimeState>;

export class DurableRuntimeStore {
  private readonly lockFile: string;
  constructor(
    readonly file: string,
    private readonly lockTimeoutMs = 5_000,
    private readonly staleLockMs = 30_000,
  ) {
    this.lockFile = `${file}.lock`;
  }

  private async load(): Promise<DurableRuntimeState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<DurableRuntimeState>;
      const state = { ...emptyDurableRuntimeState(), ...parsed } as DurableRuntimeState;
      for (const table of TABLES) if (!Array.isArray(state[table])) (state[table] as unknown) = [];
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDurableRuntimeState();
      throw error;
    }
  }

  private async save(state: DurableRuntimeState) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.file);
  }

  private async acquireLock(): Promise<FileHandle> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(this.lockFile, "wx");
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        return handle;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows may report EPERM instead of EEXIST while another process owns the lock file.
        if (code !== "EEXIST" && code !== "EPERM") throw error;
        try {
          if (Date.now() - (await stat(this.lockFile)).mtimeMs > this.staleLockMs)
            await rm(this.lockFile, { force: true });
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
        }
        if (Date.now() - started >= this.lockTimeoutMs)
          throw new Error("DURABLE_STORE_LOCK_TIMEOUT");
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 10)));
      }
    }
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const handle = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(this.lockFile, { force: true });
    }
  }

  transaction<T>(operation: (state: DurableRuntimeState) => T | Promise<T>): Promise<T> {
    return this.locked(async () => {
      const state = await this.load();
      const result = await operation(state);
      await this.save(state);
      return result;
    });
  }

  snapshot(): Promise<DurableRuntimeState> {
    return this.locked(async () => structuredClone(await this.load()));
  }
}

export function runtimeDurableStore() {
  const operational =
    process.env["AI_OFFICE_DATA_FILE"] ?? path.join(process.cwd(), "data", "ai-office.json");
  return new DurableRuntimeStore(
    process.env["AI_OFFICE_RUNTIME_FILE"] ??
      path.join(path.dirname(operational), "ai-office-runtime.json"),
  );
}
