import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeMetricsStore } from "../metrics.server";

describe("runtime metrics", () => {
  it("persists queryable redacted metrics", async () => {
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "metrics-")), "metrics.jsonl");
    const store = new RuntimeMetricsStore(file);
    await store.record({
      name: "provider.latency",
      value: 12,
      unit: "ms",
      timestamp: new Date().toISOString(),
      missionId: "m",
      attributes: { Authorization: "Bearer private" },
    });
    expect(await store.query({ missionId: "m" })).toHaveLength(1);
    expect(await readFile(file, "utf8")).not.toContain("private");
  });
});
