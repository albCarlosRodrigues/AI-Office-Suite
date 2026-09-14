import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WindowsDpapiProtector, WindowsSecretStore } from "../security/secret-store.server";
import { migrateLegacySecret } from "@/orchestration/provider-secret-service.server";

const protector = {
  protect: async (value: string) => Buffer.from(`protected:${value}`).toString("base64"),
  unprotect: async (value: string) =>
    Buffer.from(value, "base64")
      .toString()
      .replace(/^protected:/, ""),
};
describe("SecretStore", () => {
  it.runIf(process.platform === "win32")(
    "round-trips with the real Windows DPAPI backend",
    async () => {
      const file = path.join(await mkdtemp(path.join(os.tmpdir(), "vault-dpapi-")), "vault.json");
      const store = new WindowsSecretStore(file, new WindowsDpapiProtector("LocalMachine"));
      const ref = await store.set("provider:real", "dpapi-roundtrip-secret");
      expect(await store.get(ref)).toBe("dpapi-roundtrip-secret");
      expect(await readFile(file, "utf8")).not.toContain("dpapi-roundtrip-secret");
      await store.delete(ref);
    },
    15_000,
  );
  it("sets, gets, checks and deletes without plaintext in its file", async () => {
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "vault-")), "vault.json");
    const store = new WindowsSecretStore(file, protector);
    const ref = await store.set("provider:p", "super-secret-value");
    expect(await store.get(ref)).toBe("super-secret-value");
    expect(await store.exists(ref)).toBe(true);
    expect(await readFile(file, "utf8")).not.toContain("super-secret-value");
    await store.delete(ref);
    expect(await store.exists(ref)).toBe(false);
  });
  it("migrates inline legacy values idempotently and clears them only after vault success", async () => {
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "vault-")), "vault.json");
    const store = new WindowsSecretStore(file, protector);
    const persist = vi.fn(async () => undefined);
    const row = {
      provider_id: "p",
      secret_ref: null,
      api_key: "legacy",
      bearer_token: null,
      secret_headers: {},
    };
    const ref = await migrateLegacySecret(row, store, persist);
    expect(ref).toMatch(/^secret:/);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: null, secret_ref: ref }),
    );
    expect(await store.get({ value: ref! })).toContain("legacy");
  });
  it("does not clear legacy data if vault write fails", async () => {
    const persist = vi.fn();
    const failing = {
      set: vi.fn(async () => {
        throw new Error("vault unavailable");
      }),
      get: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
    };
    await expect(
      migrateLegacySecret(
        {
          provider_id: "p",
          secret_ref: null,
          api_key: "legacy",
          bearer_token: null,
          secret_headers: {},
        },
        failing,
        persist,
      ),
    ).rejects.toThrow("vault unavailable");
    expect(persist).not.toHaveBeenCalled();
  });
});
