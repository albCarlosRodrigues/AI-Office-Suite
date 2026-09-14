import { describe, expect, it, vi } from "vitest";
import {
  BackendError,
  ExecutionBackendRegistry,
  type ExecutionBackend,
} from "../execution-backend";

const backend = (id: string, execute: ExecutionBackend["execute"]): ExecutionBackend => ({
  id,
  capabilities: { plan: false, execute: true, review: false, tools: [] },
  healthCheck: async () => ({ status: "HEALTHY", message: "ok" }),
  execute,
});
describe("execution backend registry", () => {
  it("registers and reports health", async () => {
    const registry = new ExecutionBackendRegistry();
    registry.register(backend("one", vi.fn()));
    expect(await registry.health()).toEqual([{ id: "one", status: "HEALTHY", message: "ok" }]);
  });
  it("falls back after a technical failure", async () => {
    const registry = new ExecutionBackendRegistry();
    registry.register(
      backend("primary", async () => {
        throw new BackendError("timeout", "timeout");
      }),
    );
    registry.register(
      backend("fallback", async () => ({
        status: "COMPLETED",
        result: "ok",
        backendId: "fallback",
        fallbackCount: 0,
      })),
    );
    expect(
      (await registry.execute("primary", ["fallback"], { taskId: "t", payload: null })).backendId,
    ).toBe("fallback");
  });
  it("never falls back after policy denial", async () => {
    const registry = new ExecutionBackendRegistry();
    const fallback = vi.fn();
    registry.register(
      backend("primary", async () => {
        throw new BackendError("policy_denied", "denied");
      }),
    );
    registry.register(backend("fallback", fallback));
    await expect(
      registry.execute("primary", ["fallback"], { taskId: "t", payload: null }),
    ).rejects.toThrow("denied");
    expect(fallback).not.toHaveBeenCalled();
  });
});
