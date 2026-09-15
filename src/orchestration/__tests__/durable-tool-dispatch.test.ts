import { describe, expect, it } from "vitest";
import { inactiveDurableMissionIds } from "../durable-tool-worker.server";

describe("durable tool dispatcher", () => {
  it.each(["PLANNING", "RUNNING", "WAITING_APPROVAL", "REVIEWING"])(
    "keeps durable work for an active operational mission: %s",
    (status) => {
      expect(
        inactiveDurableMissionIds(
          [{ id: "mission-1", status: "RUNNING" }],
          [{ id: "mission-1", status }],
        ),
      ).toEqual([]);
    },
  );

  it.each(["COMPLETED", "FAILED", "STOPPED", "DRAFT"])(
    "marks durable work stale when operational mission is %s",
    (status) => {
      expect(
        inactiveDurableMissionIds(
          [{ id: "mission-1", status: "RUNNING" }],
          [{ id: "mission-1", status }],
        ),
      ).toEqual(["mission-1"]);
    },
  );

  it("marks durable work stale when operational mission no longer exists", () => {
    expect(inactiveDurableMissionIds([{ id: "mission-1", status: "RUNNING" }], [])).toEqual([
      "mission-1",
    ]);
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED"])(
    "does not re-cancel a terminal durable mission: %s",
    (status) => {
      expect(inactiveDurableMissionIds([{ id: "mission-1", status }], [])).toEqual([]);
    },
  );

  it("only returns stale durable missions", () => {
    expect(
      inactiveDurableMissionIds(
        [
          { id: "active", status: "RUNNING" },
          { id: "old", status: "RUNNING" },
          { id: "done", status: "COMPLETED" },
        ],
        [
          { id: "active", status: "RUNNING" },
          { id: "old", status: "FAILED" },
        ],
      ),
    ).toEqual(["old"]);
  });
});
