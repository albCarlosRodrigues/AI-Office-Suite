import { describe, expect, it } from "vitest";
import { missionHasPendingRuntimeTools } from "../worker.server";

describe("mission runtime tool waiting", () => {
  it.each(["REQUESTED", "WAITING_APPROVAL", "READY", "CLAIMED", "RUNNING"])(
    "does not spend a mission step while a tool is %s",
    (status) => {
      expect(missionHasPendingRuntimeTools([{ missionId: "mission-1", status }], "mission-1")).toBe(
        true,
      );
    },
  );

  it.each(["COMPLETED", "FAILED", "CANCELLED", "DENIED", "DEAD_LETTER"])(
    "lets the engine resume after a terminal tool state %s",
    (status) => {
      expect(missionHasPendingRuntimeTools([{ missionId: "mission-1", status }], "mission-1")).toBe(
        false,
      );
    },
  );

  it("does not block another mission", () => {
    expect(
      missionHasPendingRuntimeTools([{ missionId: "mission-2", status: "READY" }], "mission-1"),
    ).toBe(false);
  });
});
