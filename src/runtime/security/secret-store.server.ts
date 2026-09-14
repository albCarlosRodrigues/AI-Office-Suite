import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export interface SecretReference {
  readonly value: string;
}
export interface SecretStore {
  set(key: string, value: string): Promise<SecretReference>;
  get(ref: SecretReference): Promise<string | null>;
  delete(ref: SecretReference): Promise<void>;
  exists(ref: SecretReference): Promise<boolean>;
}
export interface SecretProtector {
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}
type Vault = {
  version: 1;
  entries: Record<string, { key: string; ciphertext: string; createdAt: string }>;
};

function runPowerShell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      shell: false,
      env: { ...process.env, AI_OFFICE_SECRET_INPUT: input },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(
            new Error(`SecretStore platform operation failed (${code}): ${stderr.slice(0, 200)}`),
          ),
    );
  });
}

export class WindowsDpapiProtector implements SecretProtector {
  constructor(private readonly scope: "CurrentUser" | "LocalMachine" = "CurrentUser") {}
  protect(value: string) {
    return runPowerShell(
      `[Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$b=[Text.Encoding]::UTF8.GetBytes($env:AI_OFFICE_SECRET_INPUT);$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::${this.scope});[Convert]::ToBase64String($p)`,
      value,
    );
  }
  unprotect(value: string) {
    return runPowerShell(
      `[Reflection.Assembly]::LoadWithPartialName('System.Security')|Out-Null;$p=[Convert]::FromBase64String($env:AI_OFFICE_SECRET_INPUT);$b=[System.Security.Cryptography.ProtectedData]::Unprotect($p,$null,[System.Security.Cryptography.DataProtectionScope]::${this.scope});[Text.Encoding]::UTF8.GetString($b)`,
      value,
    );
  }
}

export class WindowsSecretStore implements SecretStore {
  private queue = Promise.resolve();
  constructor(
    private readonly file: string,
    private readonly protector: SecretProtector = new WindowsDpapiProtector(),
  ) {}
  private async load(): Promise<Vault> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Vault;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} };
      throw error;
    }
  }
  private async save(vault: Vault) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(vault));
    await rename(temporary, this.file);
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async set(key: string, value: string): Promise<SecretReference> {
    return this.mutate(async () => {
      const vault = await this.load();
      const id = randomUUID();
      vault.entries[id] = {
        key,
        ciphertext: await this.protector.protect(value),
        createdAt: new Date().toISOString(),
      };
      await this.save(vault);
      return { value: `secret://windows-dpapi/${id}` };
    });
  }
  async get(ref: SecretReference): Promise<string | null> {
    const id = this.id(ref);
    const entry = (await this.load()).entries[id];
    return entry ? this.protector.unprotect(entry.ciphertext) : null;
  }
  async delete(ref: SecretReference): Promise<void> {
    await this.mutate(async () => {
      const vault = await this.load();
      delete vault.entries[this.id(ref)];
      await this.save(vault);
    });
  }
  async exists(ref: SecretReference): Promise<boolean> {
    return Boolean((await this.load()).entries[this.id(ref)]);
  }
  private id(ref: SecretReference) {
    const match = /^secret:\/\/windows-dpapi\/([0-9a-f-]{36})$/i.exec(ref.value);
    if (!match) throw new Error("INVALID_SECRET_REFERENCE");
    return match[1]!;
  }
}

let singleton: SecretStore | undefined;
export function runtimeSecretStore(): SecretStore {
  if (singleton) return singleton;
  if (process.platform !== "win32")
    throw new Error("SECURE_SECRET_STORE_UNAVAILABLE: configure a platform SecretStore");
  const dataFile = process.env["AI_OFFICE_DATA_FILE"] ?? `${process.cwd()}/data/ai-office.json`;
  const vaultFile =
    process.env["AI_OFFICE_SECRET_FILE"] ?? `${dirname(dataFile)}/ai-office-secrets.dpapi.json`;
  const scope =
    process.env["AI_OFFICE_DPAPI_SCOPE"] === "LocalMachine" ? "LocalMachine" : "CurrentUser";
  singleton = new WindowsSecretStore(vaultFile, new WindowsDpapiProtector(scope));
  return singleton;
}
