import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DurableRuntimeStore } from "../durable/store.server";
import { DurableMissionRuntime } from "../durable/mission-runtime.server";
import { DurableToolQueue } from "../durable/tool-queue.server";
import { DurableApprovalService } from "../durable/approval-service.server";
import { DurableRateLimitService } from "../durable/rate-limit-service.server";
import { TransactionalOutbox } from "../durable/outbox.server";
import { IdempotencyService } from "../durable/idempotency.server";

const ids = { missionId: "m", taskId: "t", commandId: "c", agentRunId: "r", agentId: "a" };
const input = (logicalOperationId = "write-1") => ({
  ...ids,
  toolCallId: "call",
  toolId: "filesystem_write",
  arguments: { path: "x.txt", content: "value", password: "must-not-persist" },
  riskLevel: 2,
  approvalPolicy: "AUTO" as const,
  policyVersion: "v1",
  logicalOperationId,
  maxAttempts: 2,
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-office-durable-services-"));
  const store = new DurableRuntimeStore(path.join(root, "runtime.json"));
  await new DurableMissionRuntime(store).createMission("m", ["t"]);
  return { root, store };
}

describe("durable runtime services", () => {
  it("persists a redacted, canonical, idempotent tool request across instances", async () => {
    const { root, store } = await setup();
    const queue = new DurableToolQueue(store);
    const first = await queue.enqueue(input());
    const duplicate = await new DurableToolQueue(
      new DurableRuntimeStore(path.join(root, "runtime.json")),
    ).enqueue({ ...input(), toolCallId: "different-call" });
    expect(duplicate.toolCallId).toBe(first.toolCallId);
    expect(duplicate.arguments["password"]).toBe("[REDACTED]");
    expect((await store.snapshot()).toolRequests).toHaveLength(1);
  });

  it("allows one claim and one expired-lease reclaim winner across store instances", async () => {
    const { root, store } = await setup();
    await new DurableToolQueue(store).enqueue(input(), 100);
    const file = path.join(root, "runtime.json");
    const claims = await Promise.all([
      new DurableToolQueue(new DurableRuntimeStore(file)).claim("w1", 10, 100),
      new DurableToolQueue(new DurableRuntimeStore(file)).claim("w2", 10, 100),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const { RecoveryService } = await import("../durable/recovery.server");
    expect((await new RecoveryService(new DurableRuntimeStore(file)).run(111)).reclaimedTools).toBe(
      1,
    );
    const reclaims = await Promise.all([
      new DurableToolQueue(new DurableRuntimeStore(file)).claim("w3", 10, 112),
      new DurableToolQueue(new DurableRuntimeStore(file)).claim("w4", 10, 112),
    ]);
    expect(reclaims.filter(Boolean)).toHaveLength(1);
    expect(reclaims.find(Boolean)?.claimVersion).toBe(2);
  });

  it("renews a lease and rejects a stale fencing token", async () => {
    const { store } = await setup();
    const queue = new DurableToolQueue(store);
    await queue.enqueue(input(), 100);
    const claim = (await queue.claim("w", 10, 100))!;
    expect(await queue.heartbeat("call", claim.claimToken!, claim.claimVersion, 50, 105)).toBe(
      true,
    );
    expect(await queue.heartbeat("call", "stale", claim.claimVersion, 50, 105)).toBe(false);
    await expect(queue.markRunning("call", "stale", claim.claimVersion)).rejects.toThrow(
      "STALE_TOOL_LEASE",
    );
  });

  it("moves bounded retryable failures to the dead letter state", async () => {
    const { store } = await setup();
    const queue = new DurableToolQueue(store);
    await queue.enqueue(input(), 100);
    let claim = (await queue.claim("w", 10, 100))!;
    expect(
      (
        await queue.retry(
          "call",
          claim.claimToken!,
          claim.claimVersion,
          "timeout",
          "one",
          true,
          100,
        )
      ).status,
    ).toBe("READY");
    claim = (await queue.claim("w", 10, 10_000))!;
    expect(
      (
        await queue.retry(
          "call",
          claim.claimToken!,
          claim.claimVersion,
          "timeout",
          "two",
          true,
          10_000,
        )
      ).status,
    ).toBe("DEAD_LETTER");
    expect((await store.snapshot()).toolRequests[0]?.failureHistory).toHaveLength(2);
  });

  it("keeps approval pending across restart and binds it to the exact snapshot", async () => {
    const { root, store } = await setup();
    const request = await new DurableToolQueue(store).enqueue({
      ...input(),
      approvalPolicy: "REQUIRE_APPROVAL",
    });
    const approval = await new DurableApprovalService(store).request(
      {
        ...ids,
        toolCallId: request.toolCallId,
        requester: "a",
        riskLevel: 2,
        reason: "write",
        scope: "ONCE",
        toolId: request.toolId,
        inputHash: request.inputHash,
        policyVersion: request.policyVersion,
      },
      100,
    );
    const restarted = new DurableApprovalService(
      new DurableRuntimeStore(path.join(root, "runtime.json")),
    );
    await expect(
      restarted.resolve(
        approval.approvalId,
        "APPROVED",
        "human",
        {
          toolId: request.toolId,
          inputHash: "changed",
          riskLevel: 2,
          policyVersion: "v1",
        },
        101,
      ),
    ).rejects.toThrow("APPROVAL_SNAPSHOT_MISMATCH");
    await restarted.resolve(
      approval.approvalId,
      "APPROVED",
      "human",
      {
        toolId: request.toolId,
        inputHash: request.inputHash,
        riskLevel: 2,
        policyVersion: "v1",
      },
      102,
    );
    expect((await store.snapshot()).toolRequests[0]?.status).toBe("READY");
  });

  it("reuses only explicitly broad equivalent approvals", async () => {
    const { store } = await setup();
    const request = await new DurableToolQueue(store).enqueue({
      ...input(),
      approvalPolicy: "REQUIRE_APPROVAL",
    });
    const service = new DurableApprovalService(store);
    const approval = await service.request({
      ...ids,
      toolCallId: request.toolCallId,
      requester: "a",
      riskLevel: 2,
      reason: "write",
      scope: "MISSION",
      toolId: request.toolId,
      inputHash: request.inputHash,
      policyVersion: request.policyVersion,
    });
    await service.resolve(approval.approvalId, "APPROVED", "human", {
      toolId: request.toolId,
      inputHash: request.inputHash,
      riskLevel: 2,
      policyVersion: request.policyVersion,
    });
    expect(
      await service.findReusable("m", request.toolId, request.inputHash, request.policyVersion),
    ).toBeTruthy();
    expect(
      await service.findReusable(
        "other-mission",
        request.toolId,
        request.inputHash,
        request.policyVersion,
      ),
    ).toBeUndefined();
  });

  it("shares durable RPM/TPM and Retry-After state across instances", async () => {
    const { root } = await setup();
    const file = path.join(root, "runtime.json");
    const results = await Promise.all([
      new DurableRateLimitService(new DurableRuntimeStore(file)).consume(
        "p",
        "m",
        6,
        { rpm: 1, tpm: 10 },
        100,
      ),
      new DurableRateLimitService(new DurableRuntimeStore(file)).consume(
        "p",
        "m",
        6,
        { rpm: 1, tpm: 10 },
        100,
      ),
    ]);
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    const limiter = new DurableRateLimitService(new DurableRuntimeStore(file));
    await limiter.block("p", "m", 1_000, 200);
    expect((await limiter.consume("p", "m", 1, { rpm: 10, tpm: 10 }, 300)).reason).toBe(
      "RETRY_AFTER",
    );
  });

  it("deduplicates outbox delivery per consumer", async () => {
    const { store } = await setup();
    const handler = vi.fn(async () => undefined);
    const outbox = new TransactionalOutbox(store);
    await outbox.publish("scheduler", handler);
    await outbox.publish("scheduler", handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("centralizes idempotency lifecycle", async () => {
    const { store } = await setup();
    const service = new IdempotencyService(store);
    expect((await service.reserve("key", "write")).acquired).toBe(true);
    expect((await service.reserve("key", "write")).acquired).toBe(false);
    expect(await service.markRunning("key")).toBe(true);
    await service.complete("key", "result");
    expect(await service.markRunning("key")).toBe(false);
    expect((await service.get("key"))?.status).toBe("COMPLETED");
  });
});
