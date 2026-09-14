import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete process.env["AI_OFFICE_DATA_FILE"];
  vi.resetModules();
});
describe("local mission leases", () => {
  it("returns a fenced lease and only its owner/version can release it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ai-office-lease-"));
    const file = path.join(dir, "store.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tables: {
          missions: [
            {
              id: "m1",
              current_step: 0,
              max_steps: 2,
              lease_version: 0,
              step_lock_id: null,
              step_locked_until: null,
            },
          ],
        },
      }),
    );
    process.env["AI_OFFICE_DATA_FILE"] = file;
    const { executeLocalDatabase } = await import("../database.server");
    const first = await executeLocalDatabase({
      rpc: {
        name: "claim_mission_step",
        args: { p_mission_id: "m1", p_worker_id: "worker-1", p_lease_seconds: 30 },
      },
    });
    expect(first.error).toBeNull();
    expect((first.data as { leaseVersion: number }).leaseVersion).toBe(1);
    expect((first.data as { mission: { current_step: number } }).mission.current_step).toBe(1);
    const raced = await executeLocalDatabase({
      rpc: { name: "claim_mission_step", args: { p_mission_id: "m1", p_worker_id: "worker-2" } },
    });
    expect(raced.data).toBeNull();
    const stale = await executeLocalDatabase({
      rpc: {
        name: "release_mission_step",
        args: { p_mission_id: "m1", p_worker_id: "worker-1", p_lease_version: 2 },
      },
    });
    expect(stale.data).toBe(false);
    const released = await executeLocalDatabase({
      rpc: {
        name: "release_mission_step",
        args: { p_mission_id: "m1", p_worker_id: "worker-1", p_lease_version: 1 },
      },
    });
    expect(released.data).toBe(true);
    const second = await executeLocalDatabase({
      rpc: {
        name: "claim_mission_step",
        args: { p_mission_id: "m1", p_worker_id: "worker-2" },
      },
    });
    expect((second.data as { mission: { current_step: number } }).mission.current_step).toBe(2);
    await executeLocalDatabase({
      rpc: {
        name: "release_mission_step",
        args: { p_mission_id: "m1", p_worker_id: "worker-2", p_lease_version: 2 },
      },
    });
    const exhausted = await executeLocalDatabase({
      rpc: {
        name: "claim_mission_step",
        args: { p_mission_id: "m1", p_worker_id: "worker-3" },
      },
    });
    expect(exhausted.data).toBeNull();
  });
  it("allows only one worker to claim the same queued task", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ai-office-task-claim-"));
    const file = path.join(dir, "store.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tables: { tasks: [{ id: "t1", status: "queued", claimed_by_run_id: null }] },
      }),
    );
    process.env["AI_OFFICE_DATA_FILE"] = file;
    const { executeLocalDatabase } = await import("../database.server");
    const claim = (worker: string) =>
      executeLocalDatabase({
        operation: {
          table: "tasks",
          action: "update",
          values: { status: "running", claimed_by_run_id: worker },
          filters: [
            { column: "id", op: "eq", value: "t1" },
            { column: "status", op: "eq", value: "queued" },
            { column: "claimed_by_run_id", op: "is", value: null },
          ],
          returning: true,
        },
      });
    const claims = await Promise.all([claim("worker-a"), claim("worker-b")]);
    expect(claims.flatMap((result) => result.data as unknown[])).toHaveLength(1);
  });
});
