import { describe, expect, it, vi } from "vitest";
import { attachOfficeBridge } from "../OfficeEventBridge";
import { officeBus } from "../eventBus";
import type { OfficeScene } from "../OfficeScene";

describe("OfficeEventBridge", () => {
  it("turns real delivery and review events into reporting walks", () => {
    const scene = {
      say: vi.fn(),
      reportToManager: vi.fn(),
    } as unknown as OfficeScene;
    const detach = attachOfficeBridge(scene);
    officeBus.emit({
      type: "mission:event",
      event: {
        id: "event-1",
        organization_id: "org",
        mission_id: "mission",
        task_id: "task",
        agent_id: "claudinho",
        target_agent_id: "gpt",
        type: "TASK_COMPLETED",
        message: "Claudinho entregou o resultado.",
        payload: {},
        created_at: new Date().toISOString(),
      },
    });
    expect(scene.reportToManager).toHaveBeenCalledWith(
      "claudinho",
      "gpt",
      "Claudinho entregou o resultado.",
    );
    officeBus.emit({
      type: "mission:event",
      event: {
        id: "event-2",
        organization_id: "org",
        mission_id: "mission",
        task_id: "task",
        agent_id: "gpt",
        target_agent_id: "claudinho",
        type: "REVIEW_APPROVED",
        message: "GPT consolidou a entrega.",
        payload: {},
        created_at: new Date().toISOString(),
      },
    });
    expect(scene.reportToManager).toHaveBeenCalledWith("gpt", null, "GPT consolidou a entrega.");
    detach();
  });
});
