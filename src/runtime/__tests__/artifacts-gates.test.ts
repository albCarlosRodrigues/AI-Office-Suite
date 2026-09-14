import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FileArtifactStore } from "../artifact-store.server";
import { commandExitGate, schemaGate } from "../gates";

describe("artifacts and deterministic gates", () => {
  it("stores content by reference and verifies its hash", async () => {
    const store = new FileArtifactStore(await mkdtemp(path.join(os.tmpdir(), "artifacts-")));
    const saved = await store.put("test output");
    const loaded = await store.get(saved.artifactRef);
    expect(new TextDecoder().decode(loaded.content)).toBe("test output");
    expect(loaded.metadata.sha256).toHaveLength(64);
  });
  it("accepts only runtime-verified exit evidence", () => {
    const result = {
      toolCallId: "c",
      toolId: "testing",
      status: "COMPLETED" as const,
      exitCode: 0,
      stdoutArtifactRef: "artifact:x",
      stderrArtifactRef: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executor: "local-runtime" as const,
      verified: true as const,
    };
    expect(commandExitGate(result).passed).toBe(true);
  });
  it("validates structured criteria without an LLM", () =>
    expect(schemaGate(z.object({ ok: z.literal(true) }), { ok: false }).passed).toBe(false));
});
