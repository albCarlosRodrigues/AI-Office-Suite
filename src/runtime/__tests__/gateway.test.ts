import { describe, expect, it, vi } from "vitest";
import { ToolExecutionGateway, ToolRegistry } from "../tools/gateway";

const request = {
  toolCallId: "call",
  missionId: "m",
  taskId: "t",
  agentId: "a",
  toolId: "test",
  arguments: {},
  idempotencyKey: "same",
};
describe("tool execution gateway", () => {
  it("is runtime verified and idempotent", async () => {
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok",
    }));
    const registry = new ToolRegistry();
    registry.register({ id: "test", risk: 1, execute });
    const gateway = new ToolExecutionGateway(
      registry,
      { evaluate: async () => "ALLOW" },
      { put: async () => ({ artifactRef: "artifact:1" }) },
    );
    expect((await gateway.execute(request)).verified).toBe(true);
    await gateway.execute(request);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not bypass a policy denial", async () => {
    const registry = new ToolRegistry();
    registry.register({ id: "test", risk: 4, execute: vi.fn() });
    await expect(
      new ToolExecutionGateway(
        registry,
        { evaluate: async () => "DENY" },
        { put: async () => ({ artifactRef: "artifact:1" }) },
      ).execute(request),
    ).rejects.toThrow("DENY");
  });
  it("redacts secrets before persisting tool output", async () => {
    let stored = "";
    const registry = new ToolRegistry();
    registry.register({
      id: "test",
      risk: 1,
      execute: async () => ({ exitCode: 0, stdout: "Authorization: Bearer private-token" }),
    });
    await new ToolExecutionGateway(
      registry,
      { evaluate: async () => "ALLOW" },
      {
        put: async (content) => {
          stored = String(content);
          return { artifactRef: "artifact:redacted" };
        },
      },
    ).execute(request);
    expect(stored).not.toContain("private-token");
  });
});
